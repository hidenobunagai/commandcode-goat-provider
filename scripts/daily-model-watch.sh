#!/usr/bin/env bash
# Daily model-catalog watch for the Command Code GOAT provider pair.
#
# 1. Cheap gate (no LLM): compare the live provider API with both catalogs.
# 2. Only when drift is detected, wake a DSH headless agent run that follows
#    docs/model-sync.md to update the catalogs and publish (tag push -> GitHub
#    Actions -> VS Code Marketplace).
#
# Invoked by the systemd user timer daily-model-watch.timer.
# Manual use:
#   scripts/daily-model-watch.sh              # gate + agent only on drift
#   scripts/daily-model-watch.sh --force      # run the agent even with no drift
#   scripts/daily-model-watch.sh --dry-run    # print the prompt, run nothing
set -uo pipefail

REPO="/home/pi/projects/commandcode-goat-provider"
DSH_REPO="/home/pi/projects/commandcode-goat-dsh-provider"
HARNESS="/home/pi/deepseek-harness"
DSH_PROFILE="headless"
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

# Releasing only makes sense from the default branch: a version bump, commit and tag
# on a feature branch would publish a commit that is not on main.
for repo in "$REPO" "$DSH_REPO"; do
  branch="$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
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
2. 新モデルがあれば capability（vision / thinking / protocol / 価格 / tier）を commandcode.ai の情報から確認して両カタログへ反映。
   確認できない項目は推測せず保守的デフォルトにし、判断できなかった点を最終報告に明記。
3. 各リポジトリで test / lint / compile を実行し、通ってから version bump・CHANGELOG 更新・commit・push・tag push。
4. VS Code 拡張の tag push で起動する GitHub Actions（Publish / CI）の結果を gh で確認し、成功を確認してから完了とする。
   失敗したら原因を直して再実行するところまでやる。Marketplace の VSCE_PAT は GitHub Secrets にあるのでホームディレクトリから探さないこと。
5. 最後に、何をどう判断して何を公開したのか（または公開しなかったのか）を日本語で簡潔に報告。

壊れた状態で push しないこと。テストが落ちる場合は原因を直すか、直せなければ何も push せず理由を報告して終了してください。
EOF
)"

log "drift=$DRIFT force=$FORCE — starting DSH agent run"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "--- prompt that would be sent ---"
  echo "$PROMPT"
  echo "--- dry run: agent not started ---"
  exit 0
fi

cd "$HARNESS" || { log "FATAL: cannot cd $HARNESS"; exit 1; }
timeout "$AGENT_TIMEOUT_SEC" node --import tsx/esm apps/cli/src/bin.ts --profile "$DSH_PROFILE" "$PROMPT" \
  >>"$LOG_DIR/daily-model-watch.log" 2>&1
AGENT_STATUS=$?

if [ "$AGENT_STATUS" -eq 0 ]; then
  log "agent run finished OK (full transcript: $LOG_DIR/daily-model-watch.log)"
else
  log "agent run exited $AGENT_STATUS — see $LOG_DIR/daily-model-watch.log"
fi

exit "$AGENT_STATUS"
