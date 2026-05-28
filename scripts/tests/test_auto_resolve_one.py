"""Focused tests for scripts/auto-resolve-one.sh guard helpers."""

from __future__ import annotations

import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
AUTO_RESOLVE = REPO_ROOT / "scripts" / "auto-resolve-one.sh"


def _run(cmd: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd, check=True, text=True, capture_output=True)


def _init_repo(tmp_path: Path, with_origin_main: bool = True) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    _run(["git", "init", "-q", "-b", "work"], repo)
    _run(["git", "config", "user.email", "test@example.com"], repo)
    _run(["git", "config", "user.name", "Test User"], repo)
    (repo / "README.md").write_text("# test\n", encoding="utf-8")
    _run(["git", "add", "README.md"], repo)
    _run(["git", "commit", "-q", "-m", "initial"], repo)
    if with_origin_main:
        _run(["git", "update-ref", "refs/remotes/origin/main", "HEAD"], repo)
    return repo


def _helper_script(command: str) -> str:
    script = AUTO_RESOLVE.read_text(encoding="utf-8")
    helpers = script.split("# ---- main ", maxsplit=1)[0]
    return f"{helpers}\n{command}\n"


def _run_helper(repo: Path, command: str) -> subprocess.CompletedProcess[str]:
    helper = repo / "helper.sh"
    helper.write_text(_helper_script(command), encoding="utf-8")
    return subprocess.run(
        ["bash", str(helper), "123"],
        cwd=repo,
        check=False,
        text=True,
        capture_output=True,
    )


def test_guard_helpers_use_origin_main_without_local_main(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    assert (
        subprocess.run(
            ["git", "rev-parse", "--verify", "main"],
            cwd=repo,
            check=False,
            capture_output=True,
        ).returncode
        != 0
    )

    src = repo / "packages" / "api" / "src"
    src.mkdir(parents=True)
    (src / "server.ts").write_text("export const ok = true;\n", encoding="utf-8")
    _run(["git", "add", "packages/api/src/server.ts"], repo)
    _run(["git", "commit", "-q", "-m", "add source"], repo)

    result = _run_helper(
        repo,
        """
        if requires_tests; then
          echo "requires_tests unexpectedly passed"
          exit 1
        fi
        changed_files_since_base | grep -qx 'packages/api/src/server.ts'
        """,
    )

    assert result.returncode == 0, result.stderr + result.stdout


def test_requires_tests_passes_when_matching_test_file_changed(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    src = repo / "packages" / "api" / "src"
    src.mkdir(parents=True)
    (src / "server.ts").write_text("export const ok = true;\n", encoding="utf-8")
    (src / "server.test.ts").write_text("import './server.js';\n", encoding="utf-8")
    _run(["git", "add", "packages/api/src/server.ts", "packages/api/src/server.test.ts"], repo)
    _run(["git", "commit", "-q", "-m", "add source with tests"], repo)

    result = _run_helper(repo, "requires_tests")

    assert result.returncode == 0, result.stderr + result.stdout


def test_missing_diff_base_fails_closed(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path, with_origin_main=False)

    result = _run_helper(
        repo,
        """
        if changed_files_since_base; then
          echo "diff unexpectedly succeeded"
          exit 1
        fi
        """,
    )

    assert result.returncode == 0, result.stderr + result.stdout
    assert "diff base ref is unavailable: origin/main" in result.stdout


def test_denylist_checks_uncommitted_files(tmp_path: Path) -> None:
    repo = _init_repo(tmp_path)
    workflow = repo / ".github" / "workflows" / "unsafe.yml"
    workflow.parent.mkdir(parents=True)
    workflow.write_text("name: unsafe\n", encoding="utf-8")

    result = _run_helper(
        repo,
        """
        if denylist_violations; then
          echo "denylist unexpectedly passed"
          exit 1
        fi
        """,
    )

    assert result.returncode == 0, result.stderr + result.stdout
    assert ".github/workflows/unsafe.yml" in result.stdout


def test_script_no_longer_uses_local_main_range() -> None:
    assert "main..HEAD" not in AUTO_RESOLVE.read_text(encoding="utf-8")
