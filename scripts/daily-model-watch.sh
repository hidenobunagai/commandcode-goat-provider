#!/usr/bin/env bash
# Daily model-catalog watch for the Command Code GOAT provider pair
# (this VS Code extension + the DSH plugin in $DSH_REPO).
#
# 1. Cheap gate (no LLM): compare the live provider API with both catalogs.
# 2. Only when drift is detected, wake an agy headless run that follows
#    docs/model-sync.md to update both catalogs and publish (tag push -> GitHub
#    Actions -> VS Code Marketplace; the DSH plugin deploys by `bun run build`).
# 3. After that run, restart `dsh web` on homepi and the Mac so the rebuilt
#    plugin is re-read (scripts/restart-dsh-web.sh no-ops when already newer).
#
# 公開ポリシー: リリース (version bump + タグ push = 公開) を行うのは
# **この日次ジョブと daily-pi-provider-sync.sh だけ**。
# この拡張は Copilot Chat プロバイダなので publish.yml は VS Code Marketplace のみへ出す。
#
# Invoked by ~/bin/daily-provider-publish.sh (systemd user timer daily-provider-publish.timer).
# Manual use:
#   scripts/daily-model-watch.sh              # gate + agent only on drift
#   scripts/daily-model-watch.sh --force      # run the agent even with no drift
#   scripts/daily-model-watch.sh --dry-run    # print the prompt, run nothing
set -uo pipefail

REPO="/home/pi/projects/commandcode-goat-provider"
DSH_REPO="/home/pi/projects/dsh-commandcode-goat-provider"
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
for repo in "$REPO" "$DSH_REPO"; do
  branch="$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
  # jj colocated repos sit on a detached HEAD, so check the main bookmark instead
  if [ -d "$repo/.jj" ]; then
    [ -n "$(jj -R "$repo" log -r '(@ | @-) & main' --no-graph -T commit_id 2>/dev/null)" ] && branch=main || branch="detached (main bookmark not at @ or @-)"
  fi
  if [ "$branch" != "main" ]; then
    log "$(basename "$repo") is on branch '$branch' (not main) — skipping agent run"
    exit 1
  fi
done

if [ "$DRIFT" -eq 0 ] && [ "$FORCE" -eq 0 ]; then
  log "no catalog drift — nothing to do (agent not started)"
  exit 0
fi

REPORT="$(cat "$REPORT_FILE")"
PROMPT="$(cat <<EOF
Command Code のモデルカタログ日次同期を実行してください。

手順書: $REPO/docs/model-sync.md を必ず最初に読み、そこに書かれた手順に従ってください。
対象リポジトリ: $REPO （VS Code 拡張）と $DSH_REPO （DSH プラグイン）。
両リポジトリの AGENTS.md があればそれにも従ってください。

検出済みの差分（scripts/check-live-models.ts の出力）:
---
$REPORT
---

やること:
1. 上記の差分が実在するか確認し、実在しなければ何も変更せず、その理由を1段落で報告して終了。
2. 新モデルがあれば capability（vision / thinking / protocol / 価格 / tier）を commandcode.ai の情報から確認して両カタログへ反映（手順書の 3 → 4 の順。DSH の CATALOG が先）。
   thinking effort は手順書の「Thinking efforts」に従う。EFFORTS MISMATCH / UNVERIFIED の行と新しい reasoning モデルは、
   開発元の API ドキュメントを調べ、scripts/probe-efforts.ts で既定の思考の有無と off 可否を確かめてから
   docs/effort-decisions.json に根拠つきで記録し、DSH CATALOG と EFFORTS_MAP に反映する。
   最後に bun run check:models を再実行し、EFFORTS の2セクションと MISSING FROM DSH / CAPABILITY が空になったことを確認する。
3. 各リポジトリで test / lint / build（VS Code 拡張は compile）を実行し、通ってから version bump・CHANGELOG 更新・commit・push・tag push。
   jj で管理された repo（.jj がある）では commit・push を jj で行う: jj commit <paths> -m "..." → jj bookmark set main -r @- → jj git push -b main。
   タグは git tag vX.Y.Z と git push origin vX.Y.Z で作る（publish.yml はタグで起動し、jj はタグを push できないため、これだけ git を使う）。git add -A は使わない。
   CHANGELOG にはカタログ更新の要点を書く（DSH プラグインには CHANGELOG もタグも無い。version の patch bump と commit・push だけ）。
   DSH プラグインは bun run build までで完了（deploy）。dsh web の再起動はこのラッパーが行うので自分で再起動しないこと。
4. VS Code 拡張の tag push で起動する GitHub Actions（Publish / CI）の結果を gh で確認し、成功を確認してから完了とする。
   失敗したら原因を直して再実行するところまでやる。
5. 最後に、何をどう判断して何を公開したのか（または公開しなかったのか）を日本語で簡潔に報告。

壊れた状態で push しないこと。テストが落ちる場合は原因を直すか、直せなければ何も push せず理由を報告して終了してください。
EOF
)"

log "drift=$DRIFT force=$FORCE — starting agy agent run"
notify "🔎 モデルカタログ更新開始" "Command Code GOAT プロバイダのモデル差分を検知しました。agy による自動更新を開始します。" "true"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "--- prompt that would be sent ---"
  echo "$PROMPT"
  echo "--- dry run: agent not started ---"
  exit 0
fi

( cd "$REPO" && timeout "$AGENT_TIMEOUT_SEC" agy -p "$PROMPT" --dangerously-skip-permissions --model gemini-3.8-flash-medium ) >>"$LOG_DIR/daily-model-watch.log" 2>&1
AGENT_STATUS=$?

if [ "$AGENT_STATUS" -eq 0 ]; then
  log "agent run finished OK (full transcript: $LOG_DIR/daily-model-watch.log)"
  # Deploy step: the DSH plugin has no npm publish, so the rebuilt lib/ only reaches the
  # Web GUI when `dsh web` restarts. lib/ reaches the Mac by Mutagen, so restart there too.
  # Both calls no-op when the server is already newer, and wait for an idle window.
  "$REPO/scripts/restart-dsh-web.sh" --wait 600 || log "homepi dsh web restart failed — see the output above"
  ssh -o BatchMode=yes -o ConnectTimeout=10 mac '~/projects/commandcode-goat-provider/scripts/restart-dsh-web.sh --wait 600' \
    || log "Mac dsh web restart failed or Mac unreachable — it picks up the plugin on its next restart"
  notify "✅ モデルカタログ更新完了" "Command Code GOAT プロバイダの更新・公開が完了しました。" "false"
else
  log "agent run exited $AGENT_STATUS — see $LOG_DIR/daily-model-watch.log"
  notify "⚠️ モデルカタログ更新エラー" "Command Code GOAT プロバイダの更新でエラーが発生しました (exit=$AGENT_STATUS)。" "false"
fi

exit "$AGENT_STATUS"
