#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo 'Node.js 22+ is required.'; exit 1; }
# If your network restricts Cloudflare (e.g. DNS-poisoned workers.dev), run with
# a proxy: env NODE_USE_ENV_PROXY=1 HTTP_PROXY=http://127.0.0.1:7897
# HTTPS_PROXY=http://127.0.0.1:7897 NO_PROXY=127.0.0.1,localhost,::1 sh start.sh
if [ ! -f node_modules/wrangler/bin/wrangler.js ]; then npm ci --no-audit --no-fund; fi
exec node bin/connect.mjs "$@"
