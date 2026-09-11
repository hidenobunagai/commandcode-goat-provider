#!/usr/bin/env bash
# Make a rebuilt Command Code GOAT provider plugin visible to the `dsh web` server.
#
# Why this exists: the plugin has no npm publish. The DSH profile loads the checkout
# through a symlink (~/.dsh/profiles/node_modules/dsh-commandcode-goat-provider), so
# `bun run build` is the deploy step and only a `dsh web` restart makes the new catalog
# reach the Web GUI. The server is supervised on both hosts, so this script asks the
# supervisor instead of managing the process itself:
#   homepi (Linux): systemd unit dsh-web.service -> sudo -n systemctl restart
#   Mac (macOS):    launchd job com.dsh.web      -> launchctl kickstart -k
#
# Callers: scripts/daily-model-watch.sh (after the model-sync agent run) and, on the
# Mac, the launchd job com.dsh.plugin-watch (WatchPaths on the plugin's lib/).
#
# Safety:
#   * no-ops when the running server started after the newest lib/ artifact
#   * refuses while a session looks active (a write within ACTIVITY_WINDOW seconds)
#     unless --force, because a restart drops every in-flight turn
#
# Usage:
#   scripts/restart-dsh-web.sh --dry-run      # report the decision, change nothing
#   scripts/restart-dsh-web.sh                # restart when stale and idle
#   scripts/restart-dsh-web.sh --wait 600     # wait up to 600s for an idle window first
#   scripts/restart-dsh-web.sh --force        # restart even while a turn is running
#
# --wait exists for the daily wrapper: the model-sync agent's own session log is
# written until the run ends, so an immediate check would always look busy.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PLUGIN_DIR="${PLUGIN_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)/commandcode-goat-dsh-provider}"
PORT="${PORT:-3080}"
ACTIVITY_WINDOW="${ACTIVITY_WINDOW:-120}"
SYSTEMD_UNIT="${SYSTEMD_UNIT:-dsh-web.service}"
LAUNCHD_LABEL="${LAUNCHD_LABEL:-com.dsh.web}"
PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

DRY_RUN=0
FORCE=0
IDLE_WAIT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --force) FORCE=1; shift ;;
    --wait)
      [ $# -ge 2 ] || { echo "--wait needs a number of seconds" >&2; exit 2; }
      IDLE_WAIT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ "$DRY_RUN" -eq 1 ] && IDLE_WAIT=0

log() { echo "[$(date '+%Y-%m-%dT%H:%M:%S%z')] $*"; }
IS_MACOS=0
[ "$(uname -s)" = "Darwin" ] && IS_MACOS=1
is_macos() { [ "$IS_MACOS" -eq 1 ]; }

# The supervisor owns the process tree; ask it rather than pattern-matching ps.
server_pid() {
  if is_macos; then
    launchctl print "gui/$UID/$LAUNCHD_LABEL" 2>/dev/null | awk '/^[[:space:]]*pid = /{print $3; exit}'
  else
    systemctl show -p MainPID --value "$SYSTEMD_UNIT" 2>/dev/null | grep -v '^0$'
  fi
}

# `ps -o lstart=` and `date -j -f` (BSD) vs `date -d` (GNU) keep this portable.
start_epoch() {
  local lstart
  lstart="$(ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//; s/ *$//')"
  [ -n "$lstart" ] || return 1
  if is_macos; then
    date -j -f "%a %b %d %T %Y" "$lstart" +%s 2>/dev/null
  else
    date -d "$lstart" +%s 2>/dev/null
  fi
}

# Branch on the platform: GNU `stat -f` reports the filesystem instead of failing,
# so a `||` fallback would capture its output as the mtime.
file_epoch() {
  if is_macos; then
    stat -f %m "$1" 2>/dev/null
  else
    stat -c %Y "$1" 2>/dev/null
  fi
}

fmt_epoch() {
  if is_macos; then date -r "$1" '+%Y-%m-%dT%H:%M:%S%z'; else date -d "@$1" '+%Y-%m-%dT%H:%M:%S%z'; fi
}

newest_artifact_epoch() {
  local newest=0 f m
  while IFS= read -r f; do
    m="$(file_epoch "$f")" || continue
    [ -n "$m" ] && [ "$m" -gt "$newest" ] 2>/dev/null && newest="$m"
  done < <(find "$PLUGIN_DIR/lib" -type f 2>/dev/null)
  echo "$newest"
}

# A reference file older than "now - ACTIVITY_WINDOW": `find -newer` is the portable
# form of `find -newermt`, which BSD find does not have.
activity_ref_file() {
  local ref stamp
  ref="$(mktemp)"
  stamp="$(date -v-"${ACTIVITY_WINDOW}"S +%Y%m%d%H%M.%S 2>/dev/null \
    || date -d "-${ACTIVITY_WINDOW} seconds" +%Y%m%d%H%M.%S)"
  touch -t "$stamp" "$ref"
  echo "$ref"
}

# Sessions written inside the window mean a turn (or a headless run) is live.
busy_sessions() {
  local ref
  ref="$(activity_ref_file)"
  find "$DSH_HOME/sessions" "$DSH_HOME/storages" -type f -newer "$ref" 2>/dev/null | grep -v '\.lock$' | head -3
  rm -f "$ref"
}

[ -d "$PLUGIN_DIR/lib" ] || { log "FATAL: no built artifacts in $PLUGIN_DIR/lib"; exit 1; }

PID="$(server_pid || true)"
ARTIFACT="$(newest_artifact_epoch)"
if [ -z "$PID" ]; then
  log "no running 'dsh web' — asking the supervisor to start it"
else
  STARTED="$(start_epoch "$PID" || echo 0)"
  log "server pid=$PID started=$(fmt_epoch "$STARTED" 2>/dev/null || echo "$STARTED")"
  log "newest lib artifact=$(fmt_epoch "$ARTIFACT" 2>/dev/null || echo "$ARTIFACT")"
  if [ "$ARTIFACT" -le "$STARTED" ]; then
    log "the running server already started after the newest artifact — nothing to do"
    exit 0
  fi
fi

if [ "$FORCE" -eq 0 ]; then
  DEADLINE=$(( $(date +%s) + IDLE_WAIT ))
  while :; do
    RECENT="$(busy_sessions)"
    [ -z "$RECENT" ] && break
    if [ "$(date +%s)" -ge "$DEADLINE" ]; then
      log "a session was written within ${ACTIVITY_WINDOW}s — skipping the restart to keep the turn alive:"
      echo "$RECENT" | sed 's/^/    /'
      log "re-run with --force to restart anyway, or with --wait to keep polling"
      exit 0
    fi
    log "session active — waiting up to $(( DEADLINE - $(date +%s) ))s more for an idle window"
    sleep 15
  done
fi

if [ "$DRY_RUN" -eq 1 ]; then
  log "--dry-run: would restart dsh web through the supervisor"
  exit 0
fi

if is_macos; then
  log "restarting via launchctl kickstart -k gui/$UID/$LAUNCHD_LABEL"
  launchctl kickstart -k "gui/$UID/$LAUNCHD_LABEL" || { log "FATAL: launchctl kickstart failed"; exit 1; }
else
  log "restarting via sudo -n systemctl restart $SYSTEMD_UNIT"
  sudo -n systemctl restart "$SYSTEMD_UNIT" || { log "FATAL: systemctl restart failed"; exit 1; }
fi

# A bound port answers 404 while the routes are still mounting (observed on both
# hosts), so readiness is the trusted-host 200, not just "something answered".
CODE=""
for _ in $(seq 1 40); do
  CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 -H 'Host: localhost' "http://127.0.0.1:${PORT}/" 2>/dev/null)"
  [ "$CODE" = "200" ] && break
  sleep 1
done

if [ "$CODE" = "200" ]; then
  log "dsh web answers 200 on http://127.0.0.1:${PORT}/ (pid=$(server_pid || echo '?'))"
  exit 0
fi

log "FATAL: dsh web did not answer 200 within 40s (last http=${CODE:-none}, pid=$(server_pid || echo none))"
exit 1
