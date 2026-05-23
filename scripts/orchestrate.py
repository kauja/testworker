#!/usr/bin/env python3
"""Parallel Claude Code agent orchestrator.

Issue #30: Run N independent subtasks in isolated git worktrees, each driven by
`claude -p`, with checkpoint-based resume, supervisor restart, max-concurrency,
and topological PR opening when all workers finish.

Usage:
    python scripts/orchestrate.py run plan.yaml
    python scripts/orchestrate.py run plan.yaml --dry-run --max-concurrent 2
    python scripts/orchestrate.py status
    python scripts/orchestrate.py cleanup
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import logging
import os
import shlex
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from collections import defaultdict, deque
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from typing import Any

import yaml

# -- constants ----------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
ORCH_DIR = REPO_ROOT / ".orchestrate"
STATE_DIR = ORCH_DIR / "state"
LOG_DIR = ORCH_DIR / "logs"
WORKTREE_DIR = ORCH_DIR / "worktrees"
DEFAULT_MAX_CONCURRENT = 2
DEFAULT_MAX_ATTEMPTS = 2
POLL_INTERVAL_SECONDS = 5
BACKOFF_SCHEDULE_SECONDS = (30, 60, 120)
RATE_LIMIT_MARKERS = ("rate limit", "rate-limit", "429", "Too Many Requests")

log = logging.getLogger("orchestrate")


# -- data model ---------------------------------------------------------------


class Status(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PASSED_TESTS = "passed_tests"
    PR_OPENED = "pr_opened"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass(frozen=True)
class Task:
    id: str
    branch: str
    prompt: str
    tests: list[str] = field(default_factory=list)
    depends_on: list[str] = field(default_factory=list)
    pr_title: str = ""
    pr_body: str = ""
    target_pr: int | None = None
    labels: list[str] = field(default_factory=list)


@dataclass
class State:
    id: str
    status: Status = Status.PENDING
    attempts: int = 0
    started_at: str | None = None
    finished_at: str | None = None
    last_step: str = ""
    log_path: str = ""
    pr_url: str = ""
    session_id: str = ""
    next_attempt_after: str | None = None  # ISO timestamp for backoff
    error: str = ""


# -- plan loading -------------------------------------------------------------


def load_plan(path: Path) -> list[Task]:
    """Read YAML, validate, return a list of Task. Raises on duplicate ids or
    unknown depends_on references."""
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or "plan" not in raw:
        raise ValueError(f"{path} must be a mapping with a top-level `plan:` list")
    items = raw["plan"]
    if not isinstance(items, list) or not items:
        raise ValueError("`plan` must be a non-empty list")

    tasks: list[Task] = []
    seen_ids: set[str] = set()
    for entry in items:
        if not isinstance(entry, dict):
            raise ValueError(f"Each plan entry must be a mapping, got {type(entry).__name__}")
        task = Task(
            id=str(entry["id"]),
            branch=str(entry["branch"]),
            prompt=str(entry["prompt"]),
            tests=list(entry.get("tests") or []),
            depends_on=list(entry.get("depends_on") or []),
            pr_title=str(entry.get("pr_title") or ""),
            pr_body=str(entry.get("pr_body") or ""),
            target_pr=entry.get("target_pr"),
            labels=list(entry.get("labels") or []),
        )
        if task.id in seen_ids:
            raise ValueError(f"Duplicate task id: {task.id}")
        seen_ids.add(task.id)
        tasks.append(task)

    ids = {t.id for t in tasks}
    for t in tasks:
        for dep in t.depends_on:
            if dep not in ids:
                raise ValueError(f"Task {t.id!r} depends on unknown task {dep!r}")
    return tasks


def topological_order(tasks: list[Task]) -> list[Task]:
    """Kahn-style topo sort. Raises ValueError on cycles."""
    by_id = {t.id: t for t in tasks}
    indeg: dict[str, int] = {t.id: len(t.depends_on) for t in tasks}
    reverse: dict[str, list[str]] = defaultdict(list)
    for t in tasks:
        for dep in t.depends_on:
            reverse[dep].append(t.id)
    queue = deque(tid for tid, n in indeg.items() if n == 0)
    out: list[Task] = []
    while queue:
        tid = queue.popleft()
        out.append(by_id[tid])
        for child in reverse[tid]:
            indeg[child] -= 1
            if indeg[child] == 0:
                queue.append(child)
    if len(out) != len(tasks):
        raise ValueError("Cycle detected in plan dependencies")
    return out


# -- state ---------------------------------------------------------------------


def state_path(task_id: str) -> Path:
    return STATE_DIR / f"{task_id}.json"


def load_state(task_id: str) -> State:
    p = state_path(task_id)
    if not p.exists():
        return State(id=task_id)
    data = json.loads(p.read_text(encoding="utf-8"))
    data["status"] = Status(data["status"])
    # Forward-compat: 新版で追加された field を持つ checkpoint を旧版で読むと
    # State(**data) が TypeError で死ぬ。 known fields だけ取り出して再構築する。
    known = {f.name for f in dataclasses.fields(State)}
    filtered = {k: v for k, v in data.items() if k in known}
    return State(**filtered)


def save_state(state: State) -> None:
    """Atomic write so a crash mid-flight doesn't truncate the checkpoint."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    final = state_path(state.id)
    tmp = final.with_suffix(".json.tmp")
    payload = asdict(state)
    payload["status"] = state.status.value
    tmp.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, final)


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


# -- worktree -----------------------------------------------------------------


def ensure_worktree(task: Task, base_branch: str = "main") -> Path:
    """Create (or reuse) `.orchestrate/worktrees/<id>` checked out to task.branch.

    If the branch doesn't exist locally, create it from origin/<base_branch>."""
    WORKTREE_DIR.mkdir(parents=True, exist_ok=True)
    wt = WORKTREE_DIR / task.id
    if wt.exists():
        return wt
    # check if branch exists
    res = subprocess.run(
        ["git", "rev-parse", "--verify", task.branch],
        cwd=REPO_ROOT,
        capture_output=True,
        check=False,
    )
    branch_exists = res.returncode == 0
    if branch_exists:
        cmd = ["git", "worktree", "add", str(wt), task.branch]
    else:
        cmd = [
            "git",
            "worktree",
            "add",
            "-b",
            task.branch,
            str(wt),
            f"origin/{base_branch}",
        ]
    subprocess.run(cmd, cwd=REPO_ROOT, check=True)
    return wt


def remove_worktree(task_id: str) -> None:
    wt = WORKTREE_DIR / task_id
    if wt.exists():
        subprocess.run(
            ["git", "worktree", "remove", "--force", str(wt)],
            cwd=REPO_ROOT,
            check=False,
        )


# -- worker -------------------------------------------------------------------


def spawn_claude(task: Task, worktree: Path, log_path: Path, dry_run: bool) -> subprocess.Popen[bytes]:
    """Spawn `claude -p` (or a fake sleep in dry-run) with stdout/stderr → log_path.

    親プロセスでは fh を Popen に渡したあと即 close する（child は自分の fd を
    保持しているので問題ない）。 これで supervisor が長期稼働しても fd が累積
    しない。 stdin への prompt 書き込みは別スレッドに逃がし、 大きな prompt が
    パイプバッファを埋めても supervisor 本体がブロックされないようにする。
    """
    log_path.parent.mkdir(parents=True, exist_ok=True)
    fh = log_path.open("ab")
    try:
        if dry_run:
            msg = (
                f"[dry-run {task.id}] would run: claude -p {shlex.quote(task.prompt[:60])}...\n"
                f"[dry-run {task.id}] worktree={worktree}\n"
                f"[dry-run {task.id}] simulating work for 3s\n"
            )
            fh.write(msg.encode("utf-8"))
            fh.flush()
            proc = subprocess.Popen(
                ["sh", "-c", "sleep 3 && echo '[dry-run] done'"],
                cwd=worktree,
                stdout=fh,
                stderr=subprocess.STDOUT,
            )
        else:
            proc = subprocess.Popen(
                ["claude", "-p", "--output-format", "stream-json"],
                cwd=worktree,
                stdin=subprocess.PIPE,
                stdout=fh,
                stderr=subprocess.STDOUT,
            )
            stdin = proc.stdin
            if stdin is not None:
                prompt_bytes = task.prompt.encode("utf-8")

                def _feed_prompt() -> None:
                    try:
                        stdin.write(prompt_bytes)
                    except (BrokenPipeError, OSError) as exc:
                        log.warning("[%s] stdin write failed: %s", task.id, exc)
                    finally:
                        try:
                            stdin.close()
                        except OSError:
                            pass

                threading.Thread(target=_feed_prompt, daemon=True, name=f"stdin-{task.id}").start()
    finally:
        # Child は dup された fd を保持するので、 親側はすぐ close して fd leak を防ぐ。
        fh.close()
    return proc


# && や | などの shell 演算子。これらを含む test cmd は shell=False の argv 実行では
# 意図通りに動かないため、明示的に sh -c 経由で動かす。
_SHELL_METACHARS = ("&&", "||", "|", ">", "<", ";", "$(", "`", "*", "?")


def _needs_shell(cmd: str) -> bool:
    return any(m in cmd for m in _SHELL_METACHARS)


def run_tests(worktree: Path, tests: list[str], log_path: Path, dry_run: bool = False) -> bool:
    """Run each test command in the worktree. Returns True if all pass.
    In dry_run mode, log the commands without executing and return True.

    `&&` / `|` / `>` / `;` などの shell 演算子を含む文字列は `sh -c` 経由で実行する
    （shell=True を回避しつつ、既存 plan の互換を保つ）。それ以外は shlex.split()
    で argv に分解して shell=False で実行する。
    """
    if not tests:
        return True
    with log_path.open("ab") as fh:
        fh.write(b"\n[tests] start\n")
        for cmd in tests:
            if dry_run:
                fh.write(f"[tests] (dry-run) $ {cmd}\n".encode())
                continue
            fh.write(f"[tests] $ {cmd}\n".encode())
            if _needs_shell(cmd):
                fh.write(b"[tests] (using sh -c due to shell metachar)\n")
                argv: list[str] = ["sh", "-c", cmd]
            else:
                try:
                    argv = shlex.split(cmd)
                except ValueError as exc:
                    fh.write(f"[tests] PARSE ERROR: {exc}\n".encode())
                    return False
                if not argv:
                    fh.write(b"[tests] empty command, skipping\n")
                    continue
            res = subprocess.run(
                argv,
                cwd=worktree,
                stdout=fh,
                stderr=subprocess.STDOUT,
                check=False,
            )
            if res.returncode != 0:
                fh.write(f"[tests] FAILED exit={res.returncode}\n".encode())
                return False
        fh.write(b"[tests] all pass\n")
    return True


def open_pr(task: Task, worktree: Path, log_path: Path, dry_run: bool) -> str:
    """Run `gh pr create` in the worktree. Returns the PR URL or ''."""
    title = task.pr_title or f"feat({task.id}): orchestrator task"
    body = task.pr_body or f"Automated by scripts/orchestrate.py for task {task.id}."
    labels = ",".join(task.labels) if task.labels else ""
    with log_path.open("ab") as fh:
        if dry_run:
            fh.write(f"[pr] (dry-run) would open PR: {title}\n".encode())
            return f"https://example.invalid/pr/{task.id}"
        cmd = ["gh", "pr", "create", "--base", "main", "--head", task.branch, "--title", title, "--body", body]
        if labels:
            cmd += ["--label", labels]
        fh.write(f"[pr] $ {' '.join(shlex.quote(c) for c in cmd)}\n".encode())
        res = subprocess.run(cmd, cwd=worktree, capture_output=True, text=True, check=False)
        fh.write(res.stdout.encode("utf-8"))
        fh.write(res.stderr.encode("utf-8"))
        if res.returncode != 0:
            return ""
        # gh prints the URL on stdout
        for line in res.stdout.splitlines():
            if line.startswith("https://"):
                return line.strip()
    return ""


# -- supervisor ---------------------------------------------------------------


def detect_rate_limit(log_path: Path) -> bool:
    if not log_path.exists():
        return False
    try:
        tail = log_path.read_bytes()[-4096:].decode("utf-8", errors="replace")
    except OSError:
        return False
    return any(marker.lower() in tail.lower() for marker in RATE_LIMIT_MARKERS)


def schedule_backoff(state: State) -> None:
    idx = min(state.attempts - 1, len(BACKOFF_SCHEDULE_SECONDS) - 1)
    delta = BACKOFF_SCHEDULE_SECONDS[idx]
    next_at = datetime.now(UTC).timestamp() + delta
    state.next_attempt_after = datetime.fromtimestamp(next_at, UTC).isoformat()
    log.warning("[%s] rate-limit detected, backing off for %ds", state.id, delta)


def is_ready(state: State) -> bool:
    if state.next_attempt_after is None:
        return True
    return now_iso() >= state.next_attempt_after


def all_deps_done(task: Task, states: dict[str, State]) -> bool:
    return all(
        states[d].status in (Status.PASSED_TESTS, Status.PR_OPENED, Status.SKIPPED)
        for d in task.depends_on
    )


def reconcile_orphans(states: dict[str, State]) -> None:
    """前回のクラッシュで RUNNING のまま残った state を FAILED に倒す。

    これをしないと supervise() の running カウンタが永続的に max_concurrent を超え、
    新規 spawn できず terminal 判定も成立せず無限ループに陥る。

    Orphan は「試行が完了しなかった」ので attempts を 1 つ戻し、backoff も解除する。
    残った worktree も remove して、ensure_worktree が clean に作り直せるようにする。
    """
    for st in states.values():
        if st.status == Status.RUNNING:
            log.warning("[%s] orphan RUNNING state from previous run, resetting to FAILED", st.id)
            st.status = Status.FAILED
            st.error = "orphan RUNNING from previous orchestrator run"
            # 試行は途中で中断されたので 1 attempt 分は消費していない扱いに戻す。
            # max_attempts に達して permanent failed になるのを防ぐ。
            if st.attempts > 0:
                st.attempts -= 1
            # 古い backoff スケジュールを引きずらない。
            st.next_attempt_after = None
            # 半端な worktree を片付けて、再 spawn 時に clean に作り直せるようにする。
            remove_worktree(st.id)
            save_state(st)


def supervise(
    tasks: list[Task],
    *,
    max_concurrent: int,
    max_attempts: int,
    dry_run: bool,
) -> dict[str, State]:
    states: dict[str, State] = {t.id: load_state(t.id) for t in tasks}
    reconcile_orphans(states)
    procs: dict[str, subprocess.Popen[bytes]] = {}
    log_paths: dict[str, Path] = {t.id: LOG_DIR / f"{t.id}.log" for t in tasks}

    def terminal(s: Status) -> bool:
        return s in (Status.PASSED_TESTS, Status.PR_OPENED, Status.FAILED, Status.SKIPPED)

    while True:
        # check finished processes
        for tid, proc in list(procs.items()):
            ret = proc.poll()
            if ret is None:
                continue
            state = states[tid]
            task = next(t for t in tasks if t.id == tid)
            state.finished_at = now_iso()
            log.info("[%s] worker exit code=%s", tid, ret)
            if ret != 0:
                state.status = Status.FAILED
                state.error = f"claude exited with {ret}"
                if detect_rate_limit(log_paths[tid]):
                    schedule_backoff(state)
            else:
                state.last_step = "claude done, running tests"
                save_state(state)
                wt = WORKTREE_DIR / tid
                try:
                    tests_passed = run_tests(wt, task.tests, log_paths[tid], dry_run=dry_run)
                except Exception as exc:  # noqa: BLE001 — supervisor は決して死なせない
                    log.exception("[%s] run_tests raised", tid)
                    state.status = Status.FAILED
                    state.error = f"run_tests raised: {exc}"
                else:
                    if tests_passed:
                        state.status = Status.PASSED_TESTS
                        state.last_step = "tests passed"
                    else:
                        state.status = Status.FAILED
                        state.error = "tests failed"
            save_state(state)
            del procs[tid]

        # start new workers
        running = sum(1 for s in states.values() if s.status == Status.RUNNING)
        for task in tasks:
            if running >= max_concurrent:
                break
            state = states[task.id]
            if terminal(state.status) and state.status != Status.FAILED:
                continue
            if state.status == Status.FAILED:
                if state.attempts >= max_attempts:
                    continue
                if not is_ready(state):
                    continue
                # ready to retry — fall through
            if state.status == Status.RUNNING:
                continue
            if not all_deps_done(task, states):
                continue
            # start
            state.attempts += 1
            state.status = Status.RUNNING
            state.started_at = now_iso()
            state.session_id = state.session_id or uuid.uuid4().hex[:12]
            state.log_path = str(log_paths[task.id])
            state.last_step = "spawning claude"
            save_state(state)
            wt = ensure_worktree(task)
            proc = spawn_claude(task, wt, log_paths[task.id], dry_run=dry_run)
            procs[task.id] = proc
            running += 1
            log.info("[%s] spawned attempt=%d pid=%d", task.id, state.attempts, proc.pid)

        # all done?
        if all(terminal(s.status) for s in states.values()) and not procs:
            break
        time.sleep(POLL_INTERVAL_SECONDS)

    # PR phase, in topological order
    for task in topological_order(tasks):
        state = states[task.id]
        if state.status != Status.PASSED_TESTS:
            continue
        wt = WORKTREE_DIR / task.id
        url = open_pr(task, wt, log_paths[task.id], dry_run=dry_run)
        if url:
            state.pr_url = url
            state.status = Status.PR_OPENED
            state.last_step = "PR opened"
        else:
            state.status = Status.FAILED
            state.error = "gh pr create failed"
        save_state(state)
    return states


def install_signal_handlers(states_callback: Any) -> None:
    def handler(signum: int, _frame: Any) -> None:
        log.warning("received signal %d, persisting state and exiting", signum)
        sys.exit(130)

    signal.signal(signal.SIGINT, handler)
    signal.signal(signal.SIGTERM, handler)


# -- CLI ----------------------------------------------------------------------


def cmd_run(args: argparse.Namespace) -> int:
    plan_path = Path(args.plan).resolve()
    tasks = load_plan(plan_path)
    topological_order(tasks)  # raises on cycle
    ORCH_DIR.mkdir(parents=True, exist_ok=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    install_signal_handlers(None)
    log.info("plan loaded: %d tasks (dry_run=%s, max_concurrent=%d)",
             len(tasks), args.dry_run, args.max_concurrent)
    states = supervise(
        tasks,
        max_concurrent=args.max_concurrent,
        max_attempts=args.max_attempts,
        dry_run=args.dry_run,
    )
    print_summary(states)
    failed = sum(1 for s in states.values() if s.status == Status.FAILED)
    return 0 if failed == 0 else 1


def cmd_status(_args: argparse.Namespace) -> int:
    if not STATE_DIR.exists():
        print("no state directory; nothing to report")
        return 0
    states = []
    for p in sorted(STATE_DIR.glob("*.json")):
        data = json.loads(p.read_text(encoding="utf-8"))
        states.append(data)
    if not states:
        print("no tasks recorded")
        return 0
    for s in states:
        print(
            f"  {s['id']:30} {s['status']:14} attempts={s['attempts']} "
            f"step={s['last_step']!r} pr={s.get('pr_url') or '-'}"
        )
    return 0


def cmd_cleanup(_args: argparse.Namespace) -> int:
    if WORKTREE_DIR.exists():
        for wt in WORKTREE_DIR.iterdir():
            if wt.is_dir():
                subprocess.run(
                    ["git", "worktree", "remove", "--force", str(wt)],
                    cwd=REPO_ROOT,
                    check=False,
                )
        shutil.rmtree(WORKTREE_DIR, ignore_errors=True)
    if STATE_DIR.exists():
        shutil.rmtree(STATE_DIR, ignore_errors=True)
    if LOG_DIR.exists():
        shutil.rmtree(LOG_DIR, ignore_errors=True)
    print("cleaned .orchestrate/")
    return 0


def print_summary(states: dict[str, State]) -> None:
    print("\n=== orchestrator summary ===")
    for sid, st in states.items():
        print(
            f"  {sid:30} {st.status.value:14} attempts={st.attempts} pr={st.pr_url or '-'}"
            f" err={st.error or '-'}"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="orchestrate", description=__doc__)
    parser.add_argument("--log-level", default="INFO")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_run = sub.add_parser("run", help="execute a plan")
    p_run.add_argument("plan", help="YAML plan file")
    p_run.add_argument("--dry-run", action="store_true")
    p_run.add_argument("--max-concurrent", type=int, default=DEFAULT_MAX_CONCURRENT)
    p_run.add_argument("--max-attempts", type=int, default=DEFAULT_MAX_ATTEMPTS)
    p_run.set_defaults(func=cmd_run)

    p_status = sub.add_parser("status", help="print state of last run")
    p_status.set_defaults(func=cmd_status)

    p_cleanup = sub.add_parser("cleanup", help="remove .orchestrate/ artifacts")
    p_cleanup.set_defaults(func=cmd_cleanup)

    args = parser.parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper()),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
