#!/bin/bash
# Keep the `sandbox` submodule pointer in sync with the inhabitant's latest
# Kimi_Sandbox commits. Commits + pushes ONLY when the sandbox actually advanced,
# so the history stays quiet. Run on a timer.
set -uo pipefail
REPO=/root/Kimi_Terrarium
cd "$REPO" || exit 1

# Pull the submodule up to the tip of its tracked branch (main).
git submodule update --init --remote --quiet sandbox 2>/dev/null || exit 0

# Nothing changed? Done.
if git diff --quiet -- sandbox 2>/dev/null; then
  exit 0
fi

SHA=$(git -C sandbox rev-parse --short HEAD 2>/dev/null || echo unknown)
git add sandbox
git -c user.name="Colton Williams" -c user.email="coltonlwilliams95@gmail.com" \
    commit -q -m "chore: sync sandbox pointer to ${SHA}"
git push -q origin main && echo "synced sandbox -> ${SHA}"
