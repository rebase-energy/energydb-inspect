#!/usr/bin/env fish
# Launch the inspector backend, the marimo editor, and the dashboard dev server.
# Run from anywhere; it cd's into its own directory first.

set dir (dirname (status filename))
cd $dir

echo "→ backend   http://localhost:8000   (uvicorn, writable)"
# Local dev runs against the throwaway dev DB, so allow Reset (INSPECT_WRITABLE=1).
env INSPECT_WRITABLE=1 uv run uvicorn energydb_inspect.app:app --reload --port 8000 &
set backend_pid $last_pid

echo "→ editor    http://localhost:2718   (marimo)"
uv run marimo edit energydb_inspect/notebooks/demo.py --port 2718 --headless &
set marimo_pid $last_pid

function _cleanup --on-signal INT --on-signal TERM
    kill $backend_pid $marimo_pid 2>/dev/null
end

echo "→ dashboard http://localhost:5173   (vite), foreground; Ctrl-C stops everything"
cd web
if type -q bun
    bun install; and bun run dev
else if type -q npm
    npm install; and npm run dev
else if type -q nix
    echo "  (no bun/npm on PATH, bootstrapping bun via: nix shell nixpkgs#bun)"
    nix shell nixpkgs#bun -c bash -c 'bun install && bun run dev'
else
    echo "  need bun, npm, or nix on PATH to run the dashboard"
end

kill $backend_pid $marimo_pid 2>/dev/null
