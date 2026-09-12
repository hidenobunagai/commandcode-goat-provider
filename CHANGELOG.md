# Change Log

## [0.1.14] - 2026-09-12

### Fixed

- Docs: the closing note in `docs/model-sync.md` claimed the drift gate "also runs … inside CI's `ci.yml` via `package:vsix`". `package:vsix` is `bun run check-changelog && bun run compile && vsce package`, and no workflow has a `check:models` step — `ci.yml`, `publish.yml` and `pages.yml` were read end to end, and the only callers in the repo are `scripts/daily-model-watch.sh` and a manual `bun run check:models`. The note now states the gate runs only by hand and in the daily watch, which is what the paragraph below it (no scheduled CI-side drift job: the comparison needs the sibling DSH checkout, present only on homepi) already implied. The same sentence's stale "timer below" — section 6 describes the timer above it — is corrected to "above". No script, workflow, or runtime behaviour changed.

## [0.1.13] - 2026-09-12

### Fixed

- CI/Publish: install with `--frozen-lockfile` (`bun install --frozen-lockfile --ignore-scripts`). The committed `bun.lock` is now the only dependency set CI and a tagged release install. With bun 1.4.0 a plain `bun install` resolves from the lockfile when the two files agree — verified here: `bun install --frozen-lockfile --ignore-scripts --dry-run` exits 0 against the committed lock — but when `package.json` and the lockfile drift it exits 0 anyway and rewrites the lock, so CI reported green while installing a set no committed file records. Reproduced in a scratch copy: pinning `prettier` to `3.9.5` against a lock holding `3.9.6` rewrote `bun.lock` (sha256 `c6c8cbb6…` → `2095d3b9…`) under a plain install, while the same drift with the flag exits 1 with `error: lockfile had changes, but lockfile is frozen`. Both workflows now match the sibling repos that already pass the flag (`commandcode-goat-dsh-provider`, `inline-sql-toolkit`, `noteeees`, `nvidia-nim-provider`, `goen-net`). `docs/model-sync.md` section 4 updated to state the frozen install; no lockfile or dependency changed.

## [0.1.12] - 2026-09-12

### Fixed

- Docs: `docs/model-sync.md` section 1 and the usage header of `scripts/check-live-models.ts` now document the drift gate as `bun run check:models` instead of `node scripts/check-live-models.ts`. Node 22.23.2 does run the script (exit 0, verified), but it prints `MODULE_TYPELESS_PACKAGE_JSON` on every invocation because the file is ESM syntax in a package without `"type": "module"` — and that field cannot be added here, since the extension is compiled to CommonJS. Every other caller already uses bun (README, `package.json`, `scripts/daily-model-watch.sh`, CI pin 1.4.0), so the two stale command lines were the only place a reader was pointed at the warning-producing form. No script behaviour or invocation changed.

## [0.1.11] - 2026-09-12

### Changed

- CI/Publish: pin `bun-version` to **1.4.0** (was 1.3.8) so both workflows run the same toolchain as this checkout, matching the DSH sibling repo. `bun.lock` here is still `lockfileVersion: 1` and 1.4.0 keeps it that way (`bun install` and `bun add` both leave it untouched), but a lockfile regenerated from scratch is `lockfileVersion: 2`: `bunx bun@1.3.8` against that file fails `--frozen-lockfile` with `Unknown lockfile version`, and without `--frozen-lockfile` — which is what these workflows run — it merely warns "Ignoring lockfile", re-resolves from `package.json` and rewrites the lock, so the committed pins silently stop being what CI installs. 1.4.0 reads both formats, so the pin no longer depends on nobody regenerating the lockfile. `docs/model-sync.md` section 4 updated to match; no lockfile or dependency changed.

## [0.1.10] - 2026-09-12

### Fixed

- `docs/model-sync.md`: the bun-pin note in section 3 ("pins **bun 1.4.0** … this repo's `bun.lock` is `lockfileVersion: 2`") describes the **DSH sibling repo's** CI, but read from this checkout "this repo" looks like the extension repo, which pins `bun 1.3.8` in `ci.yml`/`publish.yml` against a `lockfileVersion: 1` lockfile. The paragraph now names the DSH repo explicitly, and section 4 states this repo's opposite case. Both sides were verified rather than assumed: the DSH `ci.yml` pins `1.4.0` with a `lockfileVersion: 2` lockfile, and bun 1.4.0 keeps this repo's lockfile at `lockfileVersion: 1` (unchanged after `bun install` and after `bun add`), so no version pin or lockfile changed here.

## [0.1.9] - 2026-09-12

### Changed

- Pages deploy: bump `actions/configure-pages` v5 to v6, `actions/deploy-pages` v4 to v5 and `actions/upload-pages-artifact` v3 to v5 so every step runs on its native Node.js 24 runtime. All three previous pins declared `runs.using: node20` (v3 of `upload-pages-artifact` also pulled in `actions/upload-artifact@v4`), which made GitHub print the "Node.js 20 is deprecated … forced to run on Node.js 24" annotation on every Pages run (e.g. run 34684833813). Inputs used here (`path: docs/`) and the `steps.deployment.outputs.page_url` output are unchanged, and `docs/` contains no dotfiles, so the v4 hidden-file default does not apply.

## [0.1.8] - 2026-09-12

### Changed

- CI: bump `actions/upload-artifact` from v4 to v7 so the coverage upload runs on its native Node.js 24 runtime. v4 declares `runs.using: node20`, which made GitHub print the "Node.js 20 is deprecated … forced to run on Node.js 24" annotation on every CI run (e.g. run 34679722959); v5 still declares `node20`, so only v6+ clears it. No change to the uploaded `coverage-report` artifact or its retention.

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
