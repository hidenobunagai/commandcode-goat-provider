#!/usr/bin/env bash
# Daily model-catalog watch for the Command Code GOAT provider.
#
# 1. Cheap gate (no LLM): compare the live provider API with the catalog.
# 2. Only when drift is detected, wake a Pi headless agent run that follows
#    docs/model-sync.md to update the catalog and publish (tag push -> GitHub
#    Actions -> VS Code Marketplace).
#
# 公開ポリシー: リリース (version bump + タグ push = 公開) を行うのは
# **この日次ジョブと daily-pi-provider-sync.sh だけ**。
# この拡張は Copilot Chat プロバイダなので publish.yml は VS Code Marketplace のみへ出す。
#
# Invoked by the systemd user timer daily-model-watch.timer.
# Manual use:
#   scripts/daily-model-watch.sh              # gate + agent only on drift
#   scripts/daily-model-watch.sh --force      # run the agent even with no drift
#   scripts/daily-model-watch.sh --dry-run    # print the prompt, run nothing
set -uo pipefail

REPO="/home/pi/projects/commandcode-goat-provider"
LOG_DIR="$REPO/logs"
AGENT_TIMEOUT_SEC="${AGENT_TIMEOUT_SEC:-3600}"

export PATH="/home/pi/.bun/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

FORCE=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

mkdir -p "$LOG_DIR"
STAMP="$(date '+%Y-%m-%dT%H:%M:%S%z')"
REPORT_FILE="$(mktemp /tmp/model-watch.XXXXXX)"
trap 'rm -f "$REPORT_FILE"' EXIT

log() { echo "[$STAMP] $*"; }

notify() {
  local title="$1" body="$2" silent="${3:-false}"
  if command -v notify-telegram >/dev/null 2>&1; then
    if [ "$silent" = "true" ]; then
      notify-telegram --silent "$title" "$body" || true
    else
      notify-telegram "$title" "$body" || true
    fi
  fi
}

log "=== daily model watch started (repo=$REPO) ==="

cd "$REPO" || { log "FATAL: cannot cd $REPO"; exit 1; }

bun run check:models >"$REPORT_FILE" 2>/dev/null
CHECK_STATUS=$?
cat "$REPORT_FILE"

if [ "$CHECK_STATUS" -eq 1 ]; then
  log "live API unreachable or catalog unreadable — skipping agent run (see report above)"
  exit 1
fi

if [ "$CHECK_STATUS" -ne 0 ] && [ "$CHECK_STATUS" -ne 2 ]; then
  log "unexpected checker exit $CHECK_STATUS — skipping agent run"
  exit 1
fi

DRIFT=0
[ "$CHECK_STATUS" -eq 2 ] && DRIFT=1

# Releasing only makes sense from the default branch
branch="$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
if [ "$branch" != "main" ]; then
  log "$(basename "$REPO") is on branch '$branch' (not main) — skipping agent run"
  exit 1
fi

if [ "$DRIFT" -eq 0 ] && [ "$FORCE" -eq 0 ]; then
  log "no catalog drift — nothing to do (agent not started)"
  exit 0
fi

REPORT="$(cat "$REPORT_FILE")"
PROMPT="$(cat <<EOF
Command Code のモデルカタログ日次同期を実行してください。

手順書: $REPO/docs/model-sync.md を必ず最初に読み、そこに書かれた手順に従ってください。
対象リポジトリ: $REPO （VS Code 拡張）。AGENTS.md があればそれにも従ってください。

検出済みの差分（scripts/check-live-models.ts の出力）:
---
$REPORT
---

やること:
1. 上記の差分が実在するか確認し、実在しなければ何も変更せず、その理由を1段落で報告して終了。
2. 新モデルがあれば capability（vision / thinking / protocol / 価格 / tier）を commandcode.ai の情報から確認してカタログへ反映。
   thinking effort は手順書の「Thinking efforts」に従う。EFFORTS MISMATCH / UNVERIFIED の行と新しい reasoning モデルは、
   開発元の API ドキュメントを調べ、scripts/probe-efforts.ts で既定の思考の有無と off 可否を確かめてから
   docs/effort-decisions.json に根拠つきで記録し、EFFORTS_MAP に反映する。
   最後に bun run check:models を再実行し、EFFORTS の2セクションが空になったことを確認する。
3. test / lint / compile を実行し、通ってから version bump・CHANGELOG 更新・commit・push・tag push。
   CHANGELOG にはカタログ更新の要点を書く。
4. VS Code 拡張の tag push で起動する GitHub Actions（Publish / CI）の結果を gh で確認し、成功を確認してから完了とする。
   失敗したら原因を直して再実行するところまでやる。
5. 最後に、何をどう判断して何を公開したのか（または公開しなかったのか）を日本語で簡潔に報告。

壊れた状態で push しないこと。テストが落ちる場合は原因を直すか、直せなければ何も push せず理由を報告して終了してください。
EOF
)"

log "drift=$DRIFT force=$FORCE — starting Pi agent run"
notify "🔎 モデルカタログ更新開始" "Command Code GOAT プロバイダのモデル差分を検知しました。Pi による自動更新を開始します。" "true"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "--- prompt that would be sent ---"
  echo "$PROMPT"
  echo "--- dry run: agent not started ---"
  exit 0
fi

( cd "$REPO" && timeout "$AGENT_TIMEOUT_SEC" pi -p "$PROMPT" ) >>"$LOG_DIR/daily-model-watch.log" 2>&1
AGENT_STATUS=$?

if [ "$AGENT_STATUS" -eq 0 ]; then
  log "agent run finished OK (full transcript: $LOG_DIR/daily-model-watch.log)"
  notify "✅ モデルカタログ更新完了" "Command Code GOAT プロバイダの更新・公開が完了しました。" "false"
else
  log "agent run exited $AGENT_STATUS — see $LOG_DIR/daily-model-watch.log"
  notify "⚠️ モデルカタログ更新エラー" "Command Code GOAT プロバイダの更新でエラーが発生しました (exit=$AGENT_STATUS)。" "false"
fi

exit "$AGENT_STATUS"
