#!/usr/bin/env bash
# auto-resolve-one.sh — invoked by .github/workflows/auto-resolve.yml.
#
# Resolves a single GitHub issue end-to-end:
#   1. Create a feature branch
#   2. Invoke `claude -p` with the issue body + repo CLAUDE.md
#   3. Validate against denylist + test-required gates
#   4. Push, open PR with `Closes #N`
#   5. Wait for CI; on failure, hand logs back to Claude for one fix pass
#   6. Auto-merge when CI green
#   7. Post a summary comment on the issue
#
# Required env vars (from the workflow):
#   GH_TOKEN, DRY_RUN, ANTHROPIC_API_KEY (unless DRY_RUN=true)
#
# Usage: scripts/auto-resolve-one.sh <issue-number>

set -euo pipefail

ISSUE="${1:?usage: $0 <issue-number>}"
DRY_RUN="${DRY_RUN:-false}"
REPO="${GITHUB_REPOSITORY:-kauja/testworker}"
MAX_FIX_PASSES="${MAX_FIX_PASSES:-1}"
CI_TIMEOUT_SECONDS="${CI_TIMEOUT_SECONDS:-1500}"
CI_POLL_INTERVAL="${CI_POLL_INTERVAL:-30}"

# Files Claude is never allowed to modify. Regex, alternation form for `grep -E`.
DENYLIST_REGEX='^(auth/|payments/|.*migration.*|\.env(\.|$)|\.github/workflows/)'

# ---- helpers ----------------------------------------------------------------

log() { printf '%s [auto-resolve] %s\n' "$(date -u +%FT%TZ)" "$*"; }

issue_body() {
  gh issue view "$ISSUE" --repo "$REPO" --json title,body,labels \
    --jq '"# \(.title)\n\n" + .body + "\n\nLabels: " + ([.labels[].name] | join(", "))'
}

slugify_title() {
  gh issue view "$ISSUE" --repo "$REPO" --json title --jq .title \
    | tr '[:upper:]' '[:lower:]' \
    | tr -c 'a-z0-9' '-' \
    | sed -E 's/-+/-/g; s/^-//; s/-$//' \
    | cut -c1-40
}

denylist_violations() {
  # Echoes matching files; exit 0 if none, 1 if any.
  if git diff --name-only main..HEAD | grep -E "${DENYLIST_REGEX}" || git status --porcelain | awk '{print $2}' | grep -E "${DENYLIST_REGEX}"; then
    return 1
  fi
  return 0
}

requires_tests() {
  # If new TS/Python source files are added but no test files are added/modified, return 1.
  local src tests
  src=$(git diff --name-only main..HEAD | grep -E '\.(ts|tsx|py)$' | grep -vE '\.(test|spec)\.' || true)
  tests=$(git diff --name-only main..HEAD | grep -E '\.(test|spec)\.(ts|tsx|py)$' || true)
  if [ -n "$src" ] && [ -z "$tests" ]; then
    return 1
  fi
  return 0
}

invoke_claude() {
  # $1 = prompt file. stdout/stderr captured by caller.
  if [ "$DRY_RUN" = "true" ]; then
    log "[dry-run] would invoke: claude -p < $1"
    # Touch a marker so subsequent steps see "work happened"
    mkdir -p .auto-resolve
    cp "$1" ".auto-resolve/last-prompt.txt"
    return 0
  fi
  claude -p --output-format text < "$1"
}

await_ci() {
  local pr="$1"
  local deadline=$((SECONDS + CI_TIMEOUT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    local state
    state=$(gh pr view "$pr" --repo "$REPO" --json statusCheckRollup \
      --jq '[.statusCheckRollup[] | select(.name != "CodeRabbit") | .conclusion] | unique')
    case "$state" in
      *FAILURE*|*CANCELLED*|*TIMED_OUT*)
        echo "failed"
        return 0
        ;;
      *)
        # all SUCCESS / SKIPPED → done
        if echo "$state" | grep -qv 'IN_PROGRESS\|QUEUED\|null\|PENDING'; then
          if ! echo "$state" | grep -qE 'FAILURE|CANCELLED|TIMED_OUT'; then
            if echo "$state" | grep -qE 'SUCCESS|SKIPPED'; then
              echo "success"
              return 0
            fi
          fi
        fi
        ;;
    esac
    sleep "$CI_POLL_INTERVAL"
  done
  echo "timeout"
}

# ---- main -------------------------------------------------------------------

log "fetching issue #$ISSUE"
TITLE_SLUG=$(slugify_title)
BRANCH="feat/issue-${ISSUE}-${TITLE_SLUG}"
WORK=".auto-resolve/issue-${ISSUE}"
mkdir -p "$WORK"

log "preparing branch ${BRANCH}"
git fetch origin main
git checkout -B "$BRANCH" origin/main

PROMPT_FILE="${WORK}/prompt.md"
{
  echo "# Repository conventions"
  echo
  cat CLAUDE.md
  echo
  echo "# Issue to resolve"
  echo
  issue_body
  echo
  echo "# Instructions"
  echo
  cat <<'EOM'
Implement this issue from scratch on the current branch.

Rules:
- Add tests for any new behavior; tests must live in the appropriate package's tests directory.
- Do NOT modify files matching: auth/, payments/, *migration*, .env*, .github/workflows/*
- Run `pnpm -r run typecheck` and `pnpm exec prettier --check .` and fix any failures before stopping.
- Make small, well-scoped commits with conventional-commit messages.
- Do NOT push or open a PR; the orchestrator handles that.
- When done, exit cleanly (no further changes pending).
EOM
} > "$PROMPT_FILE"

log "invoking claude (dry_run=$DRY_RUN)"
invoke_claude "$PROMPT_FILE" 2>&1 | tee "${WORK}/claude.log"

if [ "$DRY_RUN" = "true" ]; then
  log "dry-run: would commit, push, open PR — stopping here"
  exit 0
fi

log "checking denylist"
if ! denylist_violations; then
  log "DENYLIST VIOLATION detected; aborting (no push)"
  gh issue comment "$ISSUE" --repo "$REPO" \
    --body "auto-resolve: aborted — denylist files were touched ($(git diff --name-only main..HEAD | grep -E "${DENYLIST_REGEX}" | head -5 | paste -sd, -)). Human review required."
  exit 2
fi

log "checking test-required"
if ! requires_tests; then
  log "TEST-REQUIRED gate failed (new source without tests); will open PR as draft"
  DRAFT_FLAG="--draft"
  DRAFT_NOTE=$'\n\n> **auto-resolve note**: no test files were added/modified alongside new source. Marked as draft for human review.'
else
  DRAFT_FLAG=""
  DRAFT_NOTE=""
fi

if [ -z "$(git status --porcelain)" ] && [ "$(git rev-list --count origin/main..HEAD)" = "0" ]; then
  log "no changes produced by claude; commenting and exiting"
  gh issue comment "$ISSUE" --repo "$REPO" \
    --body "auto-resolve: claude produced no changes. The issue may need clearer requirements."
  exit 0
fi

log "pushing branch ${BRANCH}"
git push -u origin "$BRANCH"

log "opening PR"
PR_URL=$(gh pr create --repo "$REPO" \
  --base main --head "$BRANCH" \
  --title "auto-resolve: $(gh issue view "$ISSUE" --repo "$REPO" --json title --jq .title)" \
  --body "Auto-resolved by [auto-resolve workflow](${GITHUB_SERVER_URL:-https://github.com}/${REPO}/actions/runs/${GITHUB_RUN_ID:-}).${DRAFT_NOTE}\n\nCloses #${ISSUE}" \
  --label "auto-merge" \
  $DRAFT_FLAG)
PR_NUM=$(basename "$PR_URL")
log "opened PR ${PR_URL}"

log "waiting for CI on PR #${PR_NUM} (timeout ${CI_TIMEOUT_SECONDS}s)"
RESULT=$(await_ci "$PR_NUM")
log "ci result: ${RESULT}"

if [ "$RESULT" = "failed" ] && [ "$MAX_FIX_PASSES" -ge 1 ]; then
  log "attempting one fix pass with claude"
  FAIL_LOG="${WORK}/ci-failure.txt"
  gh run list --branch "$BRANCH" --limit 1 --json databaseId --jq '.[0].databaseId' \
    | xargs -I{} gh run view {} --log-failed > "$FAIL_LOG" 2>&1 || true
  FIX_PROMPT="${WORK}/fix-prompt.md"
  {
    echo "# CI failure on PR #${PR_NUM}"
    echo
    echo "Below is the failure log. Fix the root cause — no skips, no test deletions, no noqa unless documented in the commit body."
    echo
    echo '```'
    tail -200 "$FAIL_LOG"
    echo '```'
  } > "$FIX_PROMPT"
  claude -p --output-format text < "$FIX_PROMPT" 2>&1 | tee "${WORK}/claude-fix.log"
  if [ -n "$(git status --porcelain)" ]; then
    git add -- $(git status --porcelain | awk '{print $2}')
    git commit -m "fix: address CI failure on PR #${PR_NUM} (auto-resolve)"
    git push origin "$BRANCH"
    RESULT=$(await_ci "$PR_NUM")
    log "ci result after fix: ${RESULT}"
  else
    log "claude produced no changes in fix pass"
  fi
fi

case "$RESULT" in
  success)
    log "CI green; auto-merge label already applied — GitHub will squash-merge"
    gh issue comment "$ISSUE" --repo "$REPO" \
      --body "auto-resolve: PR ${PR_URL} opened and CI green. Waiting for CODEOWNERS approval before auto-merge."
    ;;
  failed)
    log "CI still failing after fix attempt; converting to draft for human review"
    gh pr ready "$PR_NUM" --undo --repo "$REPO" || true
    gh pr edit "$PR_NUM" --repo "$REPO" --remove-label "auto-merge" --add-label "needs:human"
    gh issue comment "$ISSUE" --repo "$REPO" \
      --body "auto-resolve: PR ${PR_URL} CI failing after fix pass. Converted to draft and tagged \`needs:human\`."
    exit 1
    ;;
  timeout)
    log "CI did not finish within ${CI_TIMEOUT_SECONDS}s"
    gh issue comment "$ISSUE" --repo "$REPO" \
      --body "auto-resolve: PR ${PR_URL} CI timed out after ${CI_TIMEOUT_SECONDS}s. Human attention required."
    exit 1
    ;;
esac
