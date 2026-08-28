""".env is loaded from the current working directory only -- no upward walk to
a parent directory. A prior find_dotenv(usecwd=True) walked up to the
filesystem root, which meant a stray .env in some ancestor of the cwd could
silently supply credentials nobody asked this run to use.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def _pg_dsn_seen_from(cwd: Path) -> str:
    env = dict(os.environ)
    env.pop("TIMEDB_PG_DSN", None)
    env.pop("TIMEDB_CH_URL", None)
    result = subprocess.run(
        [sys.executable, "-c", "from energydb_inspect import db; print(db.PG_DSN)"],
        capture_output=True,
        text=True,
        env=env,
        cwd=str(cwd),
        check=False,
    )
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def test_parent_dir_env_is_not_loaded(tmp_path):
    child = tmp_path / "child"
    child.mkdir()
    (tmp_path / ".env").write_text(
        "TIMEDB_PG_DSN=postgresql://parent/should-not-load\n"
    )

    assert _pg_dsn_seen_from(child) == ""


def test_cwd_env_is_loaded(tmp_path):
    (tmp_path / ".env").write_text("TIMEDB_PG_DSN=postgresql://x/loaded\n")

    assert _pg_dsn_seen_from(tmp_path) == "postgresql://x/loaded"
