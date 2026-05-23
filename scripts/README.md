# scripts/orchestrate.py

Parallel Claude Code agent orchestrator (Issue #30).

Runs N independent subtasks in isolated git worktrees, each driven by `claude -p`,
with checkpoint-based resume, supervisor restart, max-concurrency cap, and
topological PR opening when all workers finish. Designed for tasks like
"review 5 dependabot major-bump PRs in parallel" or "scaffold 5 sibling
features that share no state."

## Why a separate Python script in a TypeScript monorepo

The orchestrator is **dev tooling**, not part of the testworker runtime. It
shells out to `claude`, `git`, `gh`, and `pnpm` — Python's stdlib + PyYAML is
the right tool. Keeping it in `scripts/` (with its own `pyproject.toml`)
isolates dependencies and lint config from the workspace `package.json`.

## Install

```bash
cd scripts
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## Usage

```bash
# Dry-run (no claude, no PRs created — just simulates the loop)
python scripts/orchestrate.py run scripts/orchestrate.example.yaml --dry-run

# Real run (requires `claude` CLI on PATH with API key configured)
python scripts/orchestrate.py run scripts/orchestrate.example.yaml \
    --max-concurrent 2 --max-attempts 2

# Inspect what happened
python scripts/orchestrate.py status

# Clean up worktrees and state
python scripts/orchestrate.py cleanup
```

## Plan format

```yaml
plan:
  - id: review-types-node # unique
    branch: chore/orch/types # worktree branch
    depends_on: [] # other task ids; PR opens after deps PASSED_TESTS
    target_pr: 7 # optional reference (for prompts)
    prompt: | # passed to `claude -p` via stdin
      ...
    tests: # shell commands, all must exit 0
      - pnpm -r run typecheck
    pr_title: '...' # optional; used by `gh pr create`
    pr_body: '...'
    labels: ['chore'] # appended to --label
```

## State, logs, worktrees

| Path                           | Purpose                                       |
| ------------------------------ | --------------------------------------------- |
| `.orchestrate/state/<id>.json` | Checkpoint per task (atomic write)            |
| `.orchestrate/logs/<id>.log`   | Combined stdout/stderr of claude + tests + PR |
| `.orchestrate/worktrees/<id>/` | Isolated git worktree, removed by `cleanup`   |

All of `.orchestrate/` is gitignored.

## State machine

```
pending → running → passed_tests → pr_opened
              ↘
               failed → (retry up to --max-attempts, with backoff on rate-limit)
```

Rate-limit detection scans the tail of the log for `rate limit | 429 | Too Many Requests`.
On detection, the supervisor schedules a backoff (30s → 60s → 120s) before retrying.

## Safety

- Worktrees are isolated so workers can't step on each other's git state
- `--dry-run` exercises the loop without invoking claude or `gh pr create`
- Max concurrency defaults to 2 (raise carefully — API rate limits hit hard at 5+)
- The PR phase runs **sequentially** in topological order, not in parallel
- The orchestrator never `git push --force` and never modifies `main`

## Demo

`scripts/orchestrate.example.yaml` reviews 5 dependabot major-version bumps
(`@types/node`, `better-sqlite3`, `zod`, `tailwindcss`, `eslint`) in parallel,
each producing a `docs/orchestrate-reports/<dep>.md` report that humans use to
decide whether to merge the bump.

## Tests

```bash
cd scripts
pytest                  # ~10 unit tests for plan / topo / state
ruff check .
mypy orchestrate.py
```
