#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${1:-/home/container}"
SRC_DIR="$APP_ROOT/src"

echo "[cleanup] app root: $APP_ROOT"
echo "[cleanup] removing stale autobump files (if present)"
rm -f "$SRC_DIR/commands/autobump.js"
rm -f "$SRC_DIR/utils/autoBumpStore.js"

echo "[verify] scanning for autobump references under $SRC_DIR"
if grep -RinE "autobump|autoBumpStore|auto bump" "$SRC_DIR"; then
  echo "[verify] found autobump references. remove or update these files before restart."
  exit 2
fi

echo "[ok] no autobump files or references found under $SRC_DIR"
echo "[next] redeploy commands and restart the bot process/container"
