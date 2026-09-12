# Change Log

## [0.1.7] - 2026-09-12

### Changed

- Daily model watch: document `logs/daily-model-watch.service.log` as the canonical service log. The unit writes stdout/stderr there with `StandardOutput/StandardError=append:`, which bypasses journald — `journalctl --user -u daily-model-watch.service` records only the unit start/finish lines — so the stale "journald is canonical" comment in the unit and the playbook now match reality. No runtime behaviour change.

## [0.1.6] - 2026-09-12

### Changed

- Daily model watch (`scripts/daily-model-watch.sh`): mirror the `~/bin/dsh-headless-route` decision to the service log (`logs/daily-model-watch.service.log`) as a single `model route:` line. Previously that reasoning only reached the transcript, so the service log alone could not tell whether a daily run booted on Go or goat.

## [0.1.5] - 2026-09-10

### Added

- Sync catalog with live API (`GET /provider/v1/models`, 69 models): add `deepseek/deepseek-v4.1-flash` (DeepSeek V4.1 Flash): 1M context, OpenAI protocol, OpenAI reasoning efforts `high`/`max`, vision-capable. Previously it appeared as an unknown model with all capabilities disabled.

## [0.1.4] - 2026-09-10

### Added

- Sync catalog with live API (`GET /provider/v1/models`, 68 models): add `inclusionai/ling-3.0-flash-sante:free` (Ling 3.0 Flash Sante, 262,144 context, text-only free tier). Previously it appeared as an unknown model with all capabilities disabled.

### Fixed

- Align static context windows with the live API (12 models: Step 3.5 Flash, Kimi K2.5/K2.6/K2.7 Code HighSpeed, GLM-5/5.1, MiniMax M2.5/M2.7, Qwen 3.6 Plus/Max Preview, Inkling, Tencent Hy3).
- Refresh display names to match the live API: DeepSeek V4 Pro/Flash `(latest)`, DeepSeek V4 Flash Vision `(exp)`, Kimi K2.7 Code HighSpeed, Tencent Hy3, Laguna S 2.1.

## [0.1.3] - 2026-09-05

### Added

- Sync catalog with live API (`GET /provider/v1/models`, 67 models): add `claude-fable-5-1`, `google/gemini-3.8-flash`, `meta/muse-spark-1.3` (+contributor), `Qwen/Qwen3.8-Max-0902`, `meituan/LongCat-2.0:free`. Previously they appeared as unknown models with all capabilities disabled.
- Guard `resolveApiModelId` so registered ids containing `:` (e.g. `meituan/LongCat-2.0:free`) are sent verbatim instead of being truncated as IDE variant suffixes.

### Removed

- Drop `minimax/minimax-m2.7-free` and `minimax/minimax-m3-free` from the static catalog (no longer served by the API).

## [0.1.2] - 2026-08-31

### Added

- Add `deepseek/deepseek-v4-flash-fast` (DeepSeek V4 Flash Fast): low-latency V4 Flash deployment, 1M context, OpenAI protocol, OpenAI reasoning efforts `high`/`max`, text-only. Available on Go plan and above (per [Command Code model page](https://commandcode.ai/models/deepseek-v4-flash-fast)).

## [0.1.1] - 2026-08-30

### Fixed

- Sync model catalog from DSH (`commandcode.ai/docs` via `pnpm generate:knowledge`): replace regex-guessed vision/thinking/efforts with explicit `VISION_SET`/`EFFORTS_MAP`/`PROTOCOL_MAP`. Fixes MiniMax duplicate display name (now `MiniMax M3 (Free)`), corrects thinking levels per docs (Claude/Gemini/GPT with proper efforts, Kimi-K3/MiniMax/Step without thinking, GLM escaping bug fixed).
- Regenerate `docs/models.md` from authoritative catalog.

## [0.1.0] - 2026-08-30

### Added

- Initial release of Command Code GOAT Provider for GitHub Copilot in VS Code.
- Language model provider registration under vendor `commandcode-goat`.
- Official Command Code model catalog support (62 models including Claude 5/4.6/4.8/4.7, DeepSeek V4, Kimi K3/K2.7, GLM 5.3, MiniMax M3, Qwen 3.8/3.7, Gemini, Step, Tencent Hy4, Grok 4.6/4.5, Muse Spark, and more).
- Dual protocol routing: Anthropic `/messages` format for Claude models and OpenAI `/chat/completions` format for other models.
- SecretStorage integration for `commandcode-goat.apiKey` with on-change model refresh.
- Dynamic model discovery from `GET https://api.commandcode.ai/provider/v1/models` with static capability fallback and non-selectable fallback for unknown models.
- Zero Data Retention (ZDR) mode toggle (`commandcode-goat.enableZdr`) sending `x-cmd-zdr: 1`.
- Comprehensive error normalization for standard and `success: false` envelopes, 401/403 API key guidance, 422 ZDR rejection, 429 rate limits, 400 token limits, and 5xx failures.
- Native streaming response parts, fragmented tool call assembly, thinking/reasoning parts, and silent retry logic for empty or truncated responses.
- Management commands: `Command Code GOAT: Manage API Key`, `Command Code GOAT: Toggle Debug Logging`, `Command Code GOAT: Open Debug Log`.
