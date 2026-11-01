#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo 'Node.js 22+ is required.'; exit 1; }
if [ ! -f node_modules/wrangler/bin/wrangler.js ]; then npm ci --no-audit --no-fund; fi
exec node bin/connect.mjs "$@"
