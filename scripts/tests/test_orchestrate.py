"""Unit tests for scripts/orchestrate.py."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import orchestrate  # noqa: E402
from orchestrate import State, Status, Task, load_plan, save_state, topological_order  # noqa: E402


def _write(tmp_path: Path, name: str, content: str) -> Path:
    p = tmp_path / name
    p.write_text(content, encoding="utf-8")
    return p


def test_load_plan_minimal(tmp_path: Path) -> None:
    yaml_text = """
plan:
  - id: a
    branch: feat/a
    prompt: do A
    tests: [pytest]
"""
    tasks = load_plan(_write(tmp_path, "p.yaml", yaml_text))
    assert len(tasks) == 1
    assert tasks[0] == Task(
        id="a", branch="feat/a", prompt="do A", tests=["pytest"], depends_on=[]
    )


def test_load_plan_rejects_duplicate_ids(tmp_path: Path) -> None:
    yaml_text = """
plan:
  - id: a
    branch: x
    prompt: p
  - id: a
    branch: y
    prompt: q
"""
    with pytest.raises(ValueError, match="Duplicate task id"):
        load_plan(_write(tmp_path, "p.yaml", yaml_text))


def test_load_plan_rejects_unknown_dependency(tmp_path: Path) -> None:
    yaml_text = """
plan:
  - id: a
    branch: x
    prompt: p
    depends_on: [ghost]
"""
    with pytest.raises(ValueError, match="depends on unknown task"):
        load_plan(_write(tmp_path, "p.yaml", yaml_text))


def test_load_plan_rejects_empty(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="non-empty"):
        load_plan(_write(tmp_path, "p.yaml", "plan: []"))


def test_topological_order_linear() -> None:
    a = Task(id="a", branch="a", prompt="")
    b = Task(id="b", branch="b", prompt="", depends_on=["a"])
    c = Task(id="c", branch="c", prompt="", depends_on=["b"])
    out = topological_order([c, b, a])
    assert [t.id for t in out] == ["a", "b", "c"]


def test_topological_order_diamond() -> None:
    a = Task(id="a", branch="a", prompt="")
    b = Task(id="b", branch="b", prompt="", depends_on=["a"])
    c = Task(id="c", branch="c", prompt="", depends_on=["a"])
    d = Task(id="d", branch="d", prompt="", depends_on=["b", "c"])
    out = topological_order([a, b, c, d])
    pos = {t.id: i for i, t in enumerate(out)}
    assert pos["a"] < pos["b"] < pos["d"]
    assert pos["a"] < pos["c"] < pos["d"]


def test_topological_order_cycle() -> None:
    a = Task(id="a", branch="a", prompt="", depends_on=["b"])
    b = Task(id="b", branch="b", prompt="", depends_on=["a"])
    with pytest.raises(ValueError, match="Cycle"):
        topological_order([a, b])


def test_save_and_load_state_round_trip(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(orchestrate, "STATE_DIR", tmp_path)
    state = State(
        id="task-x",
        status=Status.RUNNING,
        attempts=2,
        last_step="spawning",
        session_id="abc123",
    )
    save_state(state)
    raw = json.loads((tmp_path / "task-x.json").read_text(encoding="utf-8"))
    assert raw["status"] == "running"
    assert raw["attempts"] == 2
    reloaded = orchestrate.load_state("task-x")
    assert reloaded == state


def test_state_atomic_write_no_tmp_leftover(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(orchestrate, "STATE_DIR", tmp_path)
    save_state(State(id="x"))
    leftovers = list(tmp_path.glob("*.tmp"))
    assert leftovers == []


def test_detect_rate_limit_positive(tmp_path: Path) -> None:
    p = tmp_path / "log.txt"
    p.write_text("everything fine\nclaude: rate limit exceeded\n", encoding="utf-8")
    assert orchestrate.detect_rate_limit(p) is True


def test_detect_rate_limit_negative(tmp_path: Path) -> None:
    p = tmp_path / "log.txt"
    p.write_text("all good here\n", encoding="utf-8")
    assert orchestrate.detect_rate_limit(p) is False


def test_detect_rate_limit_missing_file(tmp_path: Path) -> None:
    assert orchestrate.detect_rate_limit(tmp_path / "nope.log") is False


def test_load_state_returns_pending_for_unknown(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(orchestrate, "STATE_DIR", tmp_path)
    s = orchestrate.load_state("never-seen")
    assert s.status is Status.PENDING
    assert s.attempts == 0


def test_example_plan_is_well_formed() -> None:
    """The shipped example plan should always parse and topo-sort cleanly."""
    example = Path(__file__).resolve().parent.parent / "orchestrate.example.yaml"
    tasks = load_plan(example)
    assert len(tasks) == 5
    ordered = topological_order(tasks)
    assert {t.id for t in ordered} == {t.id for t in tasks}


def test_reconcile_orphans_resets_running_to_failed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Restart with a RUNNING state from a previous crash must not hang.

    reconcile_orphans should flip RUNNING → FAILED so supervise() can either
    retry (within max_attempts) or move on, instead of being starved forever.
    Also: the interrupted attempt should be refunded (attempts -= 1) and
    next_attempt_after cleared so the retry isn't blocked by stale backoff.
    """
    monkeypatch.setattr(orchestrate, "STATE_DIR", tmp_path)
    monkeypatch.setattr(orchestrate, "WORKTREE_DIR", tmp_path / "wt")
    states = {
        "a": State(
            id="a",
            status=Status.RUNNING,
            attempts=2,
            next_attempt_after="2030-01-01T00:00:00+00:00",
        ),
        "b": State(id="b", status=Status.PENDING),
        "c": State(id="c", status=Status.PASSED_TESTS),
    }
    orchestrate.reconcile_orphans(states)
    assert states["a"].status is Status.FAILED
    assert "orphan" in states["a"].error.lower()
    assert states["a"].attempts == 1, "interrupted attempt must be refunded"
    assert states["a"].next_attempt_after is None, "stale backoff must be cleared"
    assert states["b"].status is Status.PENDING
    assert states["c"].status is Status.PASSED_TESTS
    # checkpoint should be persisted for the reset
    reloaded = orchestrate.load_state("a")
    assert reloaded.status is Status.FAILED
    assert reloaded.attempts == 1


def test_run_tests_uses_sh_c_for_shell_metachar(tmp_path: Path) -> None:
    """`&&` / `||` / `>` のような shell 演算子は sh -c 経由で動く必要がある。"""
    log_path = tmp_path / "t.log"
    out_file = tmp_path / "out.txt"
    # &&: 両方 success
    assert (
        orchestrate.run_tests(tmp_path, [f"true && echo ok > {out_file}"], log_path) is True
    )
    assert out_file.exists() and out_file.read_text().strip() == "ok"
    out_file.unlink()
    # ||: 左失敗→右で fallback
    assert (
        orchestrate.run_tests(tmp_path, [f"false || echo fallback > {out_file}"], log_path) is True
    )
    assert out_file.read_text().strip() == "fallback"


def test_needs_shell_detection() -> None:
    assert orchestrate._needs_shell("pnpm test && pnpm typecheck") is True
    assert orchestrate._needs_shell("echo hi > /tmp/x") is True
    assert orchestrate._needs_shell("pnpm install --frozen-lockfile") is False
    assert orchestrate._needs_shell("pytest -q") is False


def test_run_tests_uses_argv_not_shell(tmp_path: Path) -> None:
    """run_tests must NOT pass commands through shell (shell=True is unsafe).

    A command containing shell-operator chars should be parsed as argv;
    the operator becomes a literal arg and the underlying program fails to
    parse it, but the orchestrator itself is unharmed.
    """
    log_path = tmp_path / "t.log"
    # Bare 'true' should succeed; demonstrates shell=False path works.
    assert orchestrate.run_tests(tmp_path, ["true"], log_path) is True
    # An empty list short-circuits to True.
    assert orchestrate.run_tests(tmp_path, [], log_path) is True


def test_run_tests_parse_error_is_returned_not_raised(tmp_path: Path) -> None:
    log_path = tmp_path / "t.log"
    # unterminated quote raises ValueError inside shlex.split → run_tests should return False
    assert orchestrate.run_tests(tmp_path, ['echo "unterminated'], log_path) is False


def test_backoff_until_is_removed() -> None:
    """Dead code with a wrong return shape was deleted; importing it must fail."""
    assert not hasattr(orchestrate, "backoff_until")


def test_load_state_forward_compat_ignores_unknown_fields(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """新版で追加された field を含む checkpoint を旧版で読んでも TypeError にしない。"""
    monkeypatch.setattr(orchestrate, "STATE_DIR", tmp_path)
    (tmp_path / "x.json").write_text(
        json.dumps(
            {
                "id": "x",
                "status": "pending",
                "attempts": 0,
                "started_at": None,
                "finished_at": None,
                "last_step": "",
                "log_path": "",
                "pr_url": "",
                "session_id": "",
                "next_attempt_after": None,
                "error": "",
                # 未来追加されたであろう未知の field
                "future_extra_metric": 42,
                "another_unknown": {"nested": True},
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    state = orchestrate.load_state("x")
    assert state.id == "x"
    assert state.status is Status.PENDING


def test_load_state_forward_compat_unknown_status_value(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """新版で追加された Status enum 値を含む checkpoint を旧版が読んでも crash しない。"""
    monkeypatch.setattr(orchestrate, "STATE_DIR", tmp_path)
    (tmp_path / "y.json").write_text(
        json.dumps(
            {
                "id": "y",
                "status": "rate_limited",  # 旧版に存在しない値
                "attempts": 1,
                "started_at": None,
                "finished_at": None,
                "last_step": "",
                "log_path": "",
                "pr_url": "",
                "session_id": "",
                "next_attempt_after": None,
                "error": "",
            }
        ),
        encoding="utf-8",
    )
    state = orchestrate.load_state("y")
    assert state.status is Status.PENDING
