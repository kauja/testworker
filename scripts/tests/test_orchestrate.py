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
