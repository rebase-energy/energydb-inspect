"""Console entrypoint for ``energydb-inspect``.

Serves the dashboard + the marimo notebook against the Postgres + ClickHouse you
point it at (``TIMEDB_PG_DSN`` / ``TIMEDB_CH_URL``, from a ``.env`` in the current
directory or the environment; see ``.env.example``).

    energydb-inspect                 # dashboard :8000 + notebook :2718
    energydb-inspect --no-notebook   # dashboard only (e.g. read-only on a real DB)

Reads are always allowed; the Reset button needs ``INSPECT_WRITABLE=1`` (use it
only against throwaway/dev databases).
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from importlib import resources
from pathlib import Path

from dotenv import load_dotenv


def _writable_notebook() -> Path:
    """Copy the bundled notebook to a writable temp file so marimo can autosave."""
    dst = Path(tempfile.mkdtemp(prefix="energydb-inspect-")) / "demo.py"
    with resources.as_file(
        resources.files("energydb_inspect") / "notebooks" / "demo.py"
    ) as src:
        shutil.copy(src, dst)
    return dst


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="energydb-inspect", description="Visual inspector for energydb."
    )
    parser.add_argument(
        "--port", type=int, default=8000, help="dashboard + API port (default 8000)"
    )
    parser.add_argument(
        "--notebook-port",
        type=int,
        default=2718,
        help="marimo notebook port (default 2718)",
    )
    parser.add_argument(
        "--no-notebook", action="store_true", help="don't start the marimo notebook"
    )
    args = parser.parse_args()

    load_dotenv()  # TIMEDB_PG_DSN / TIMEDB_CH_URL from a .env in the cwd
    if not os.environ.get("TIMEDB_PG_DSN") or not os.environ.get("TIMEDB_CH_URL"):
        print(
            "warning: TIMEDB_PG_DSN / TIMEDB_CH_URL are not set; the dashboard will be empty.\n"
            "  Create a .env (see .env.example) or start the energydb local-db.\n",
            file=sys.stderr,
        )

    marimo = None
    if not args.no_notebook:
        nb = _writable_notebook()
        marimo = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "marimo",
                "edit",
                str(nb),
                "--host",
                "127.0.0.1",
                "-p",
                str(args.notebook_port),
                "--headless",
                "--no-token",
            ]
        )
        print(f"  notebook  → http://localhost:{args.notebook_port}")

    print(f"  dashboard → http://localhost:{args.port}\n")
    try:
        import uvicorn

        uvicorn.run("energydb_inspect.app:app", host="127.0.0.1", port=args.port)
    finally:
        if marimo is not None:
            marimo.terminate()


if __name__ == "__main__":
    main()
