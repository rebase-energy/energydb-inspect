#!/usr/bin/env bash
# Optional one-shot MANUAL deploy of the in-browser demo to a gh-pages branch.
#
# Static web hosting is normally a separate CI job that builds `VITE_TARGET=wasm`
# and publishes the static `dist/` (see the README, "Static web demo"). This
# script is an optional one-shot manual deploy: it builds, then force-pushes ONLY
# the built dist/ to the given remote's gh-pages branch.
#
# Usage:  ./deploy-gh-pages.sh <git-remote> [base-path]
#   e.g.  ./deploy-gh-pages.sh git@github.com:rebase-energy/energydb-inspector.git /energydb-inspector/
#
# One-time, in the target repo's Settings → Pages: Source = "Deploy from a
# branch", Branch = gh-pages / (root).
set -euo pipefail

REPO="${1:?usage: ./deploy-gh-pages.sh <git-remote> [base-path]}"
BASE="${2:-/}"

cd "$(dirname "$0")" # inspect/web

echo "==> build (VITE_TARGET=wasm VITE_BASE=$BASE)"
VITE_TARGET=wasm VITE_BASE="$BASE" npm run build

echo "==> prepare dist for Pages"
touch dist/.nojekyll # serve asset files as-is (no Jekyll processing)

echo "==> force-push dist/ to $REPO (gh-pages)"
pushd dist >/dev/null
rm -rf .git
git init -q
git checkout -q -b gh-pages
git add -A
git -c user.name="inspector-deploy" -c user.email="deploy@local" commit -qm "deploy $(date -u +%FT%TZ)"
git push -f "$REPO" gh-pages
rm -rf .git
popd >/dev/null

echo "==> done (Pages will serve the pushed gh-pages branch)"
