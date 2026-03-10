#!/usr/bin/env bash
set -euo pipefail

npm run build

# Netlify snapshots the workspace into cache after build. Dropping Git history
# here keeps cache size down while preserving site output.
rm -rf .git
