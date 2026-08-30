# Command Code GOAT Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone VS Code VSIX that exposes Command Code GOAT and Provider API models inside Copilot Chat with streaming, tools, images, reasoning settings, and secure API-key storage.

**Architecture:** Adapt the proven VS Code `LanguageModelChatProvider` and wire-format conversion code from `opencode-go-provider`. Call Command Code directly at `/provider/v1`, use the static catalog as the authority for API format and capabilities, route known Claude IDs to Anthropic Messages and known non-Claude IDs to OpenAI Chat Completions, and merge API names/context lengths with the static snapshot.

**Tech Stack:** TypeScript, VS Code Extension API 1.104+, Node.js built-in `fetch`/`AbortController`, Bun, Jest, ESLint, `@vscode/vsce`, zero runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-30-commandcode-goat-provider-design.md`

## Global Constraints

- The host is VS Code Copilot Chat; DeepSeek Harness and Command Code CLI plugins are out of scope.
- API base URL is `https://api.commandcode.ai/provider/v1`.
- Known Claude models use `/messages`; known non-Claude models use `/chat/completions`; unknown models are display-only and are never sent.
- Model IDs must preserve exact case, including IDs such as `Qwen/Qwen3.8-27B` and `MiniMaxAI/MiniMax-M3`.
- `/models` must work without an API key, must require a non-empty validated list, and must use `name` and `context_length` when present.
- Unknown models default to 262,144 context tokens, 65,536 output tokens, tools disabled, images disabled, no reasoning selector, and `isUserSelectable: false`.
- API keys are stored only in VS Code SecretStorage under `commandcode-goat.apiKey`.
- `x-cmd-zdr: 1` is sent only when `commandcode-goat.enableZdr` is true; its default is false.
- The extension must not log API keys, authorization headers, or secret request values.
- Runtime dependencies remain empty; HTTP, SSE, cancellation, and parsing use existing platform APIs.
- Use Bun commands, never npm commands; install with `bun install --ignore-scripts`.
- Preserve the upstream MIT license and record the adaptation in `NOTICE`.
- The first release does not include usage quota status, browser login, account rotation, image delegation, Responses API, or Marketplace publishing.

## File Map

### Copied and retained from the existing provider

- `src/announcement.ts` — action-announcement detection and missing-tool nudge.
- `src/guidance.ts` — provider identity and tool-use guidance, rewritten for Command Code.
- `src/message-parts.ts` — VS Code input-part guards and extractors.
- `src/openai-conversion.ts` — OpenAI message and tool conversion.
- `src/anthropic-conversion.ts` — Anthropic message and tool conversion.
- `src/tokenizer.ts` — lightweight token estimator.
- `src/tool-parser.ts` — text-embedded tool-call scanner.
- `src/tool-repair.ts` — tool argument repair and duplicate suppression.
- `src/output-channel.ts` — redacted debug output.
- `src/streaming/sse.ts` — bounded SSE line reader.
- `src/streaming/shared.ts` — shared response and tool state.
- `src/streaming/openai.ts` — OpenAI stream processor.
- `src/streaming/anthropic.ts` — Anthropic stream processor.
- `tests/announcement.test.ts`, `tests/guidance.test.ts`, `tests/tool-parser.test.ts`, and `tests/tool-repair.test.ts` — shared behavior coverage, with branding updates.
- `__mocks__/vscode.ts`, `jest.config.js`, `tsconfig.json`, `.prettierrc`, `eslint.config.mjs`, `.vscodeignore`, `.vscode/launch.json`, `.vscode/settings.json`, `.vscode/tasks.json`, `.github/workflows/ci.yml`, `.gitignore`, and `bunfig.toml` — development configuration.

### Created or substantially modified

- `package.json` — extension identity, provider contribution, commands, ZDR setting, and scripts.
- `src/types.ts` — Command Code wire types, model metadata, fallback catalog, and reasoning effort map.
- `src/constants.ts` — Command Code URL, timeouts, retry constants, and model workarounds.
- `src/api.ts` — Command Code model fetch, OpenAI request, retry, SSE, and error normalization.
- `src/provider.ts` — `CommandCodeChatModelProvider` implementation.
- `src/extension.ts` — activation, SecretStorage, provider registration, and commands.
- `tests/api.test.ts`, `tests/model-catalog.test.ts`, `tests/openai-conversion.test.ts`, `tests/openai-streaming.test.ts`, `tests/provider.test.ts`, `tests/extension.test.ts`, `tests/anthropic-conversion.test.ts`, and `tests/anthropic-streaming.test.ts` — Command Code-specific tests.
- `README.md` — installation, API-key, model, ZDR, and local verification instructions.
- `CHANGELOG.md` — initial release entry.
- `NOTICE` — upstream adaptation and attribution.
- `LICENSE` — retained MIT license with the upstream copyright notice.

### Deleted after imports are removed

- `src/responses-conversion.ts`
- `src/streaming/responses.ts`
- `src/tools.ts`
- `src/usage.ts`
- `src/usage-bar.ts`
- `src/vision.ts`
- `tests/responses-conversion.test.ts`
- `tests/tools.test.ts`
- `tests/usage.test.ts`
- `tests/usage-bar.test.ts`
- `tests/vision.test.ts`

---

### Task 1: Bootstrap the independent extension repository

**Files:**
- Create: all baseline files from `/home/pi/projects/opencode-go-provider` listed in the File Map.
- Modify: `package.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `.gitignore`.
- Create: `NOTICE`.
- Test: repository compile command.

**Interfaces:**
- Produces a clean Git repository at `/home/pi/projects/commandcode-goat-provider` with the same TypeScript/Jest build conventions as the source extension.
- Keeps the existing VS Code engine floor at `^1.104.0` and Bun minimum-release-age settings.

- [ ] **Step 1: Import only tracked upstream files**

```bash
git -C /home/pi/projects/opencode-go-provider archive HEAD | tar -x -C /home/pi/projects/commandcode-goat-provider
```

Do not copy the upstream `.git` directory, `node_modules`, compiled output, coverage, VSIX files, or local environment files. Keep the already-created `docs/superpowers` directory and its committed design history.

- [ ] **Step 2: Replace package identity**

In `package.json`, set these exact values while retaining the existing development dependencies and scripts:

```json
{
  "name": "commandcode-goat-provider",
  "publisher": "HidenobuNagai",
  "displayName": "Command Code GOAT Provider",
  "description": "Command Code GOAT Chat Provider for VS Code Copilot Chat",
  "version": "0.1.0",
  "keywords": ["commandcode", "goat", "copilot", "chat", "provider"]
}
```

Change the extension contribution vendor to `commandcode-goat`, the display name to `Command Code GOAT`, and the management command to `commandcode-goat.manage`.

- [ ] **Step 3: Add attribution before any ported code is changed**

Create `NOTICE` with the following complete text:

```text
This project adapts portions of OpenCode Go Provider for VS Code Copilot Chat:
https://github.com/hidenobunagai/opencode-go-provider

The adapted source is distributed under the MIT License. The original copyright
notice is retained in LICENSE. Command Code GOAT integration is an independent,
unofficial community project and is not affiliated with Command Code, Inc.
```

Keep the original MIT copyright line in `LICENSE` and add no API keys or environment values.

- [ ] **Step 4: Update the initial documentation identity**

Replace the README title and OpenCode-specific installation/setup wording with the Command Code GOAT name, while leaving the detailed Command Code setup for Task 7. Add a `0.1.0` entry to `CHANGELOG.md` stating that this is the initial local VSIX implementation.

- [ ] **Step 5: Install and compile the untouched baseline**

Run:

```bash
bun install --ignore-scripts
bun run compile
```

Expected result: TypeScript compilation succeeds before the protocol-specific edits begin.

- [ ] **Step 6: Commit the bootstrap**

```bash
git add .
git commit -m "chore: bootstrap Command Code GOAT provider"
```

### Task 2: Add the Command Code model catalog and capability snapshot

**Files:**
- Modify: `src/types.ts`.
- Modify: `src/constants.ts`.
- Create: `tests/model-catalog.test.ts`.

**Interfaces:**
- Produces `CommandCodeModelInfo`, `CommandCodeApiModel`, `CommandCodeModelsResponse`, `inferModelInfo()`, `FALLBACK_MODELS`, and `REASONING_EFFORT_ORDER` for the API and provider tasks.
- `inferModelInfo(model: CommandCodeApiModel): CommandCodeModelInfo` preserves the API ID exactly and uses static metadata when an exact ID is known.

- [ ] **Step 1: Write failing catalog tests**

Create tests with these cases:

```typescript
test("maps a known Claude model to Anthropic and preserves API metadata", () => {
  const info = inferModelInfo({
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    context_length: 1_000_000,
  });

  expect(info.apiFormat).toBe("anthropic");
  expect(info.displayName).toBe("Claude Sonnet 4.6");
  expect(info.contextWindow).toBe(1_000_000);
});

test("maps a known namespaced model without changing its case", () => {
  const info = inferModelInfo({
    id: "Qwen/Qwen3.8-27B",
    name: "Qwen 3.8 27B",
    context_length: 262_144,
  });

  expect(info.id).toBe("Qwen/Qwen3.8-27B");
  expect(info.apiFormat).toBe("openai");
  expect(info.supportsVision).toBe(true);
});

test("marks an unknown model display-only and disables capabilities", () => {
  const info = inferModelInfo({
    id: "new-provider/new-model",
    name: "New Model",
    context_length: 131072,
  });

  expect(info.contextWindow).toBe(131072);
  expect(info.maxOutput).toBe(65_536);
  expect(info.supportsTools).toBe(false);
  expect(info.supportsVision).toBe(false);
  expect(info.supportsThinking).toBe(false);
  expect(info.apiFormat).toBeUndefined();
  expect(info.isUserSelectable).toBe(false);
});

test("rejects an invalid model id", () => {
  expect(() => inferModelInfo({ id: "" })).toThrow("non-empty");
});
```

Run:

```bash
bun run test -- --runInBand tests/model-catalog.test.ts
```

Expected result: FAIL because the Command Code types and inference function do not exist yet.

- [ ] **Step 2: Define exact model and wire types**

In `src/types.ts`, define:

```typescript
export type CommandCodeApiFormat = "openai" | "anthropic";

export interface CommandCodeApiModel {
  id: string;
  name?: string;
  context_length?: number;
}

export interface CommandCodeModelsResponse {
  object: "list";
  data: CommandCodeApiModel[];
}

export interface CommandCodeModelInfo {
  id: string;
  name: string;
  displayName: string;
  contextWindow: number;
  maxOutput: number;
  supportsTools: boolean;
  supportsVision: boolean;
  apiFormat?: CommandCodeApiFormat;
  fixedTemperature?: number;
  fixedTopP?: number;
  supportsThinking: boolean;
  supportedReasoningEfforts?: ReasoningEffort[];
  isUserSelectable: boolean;
}
```

Retain the existing chat message, tool, OpenAI stream, Anthropic stream, and token usage interfaces, renaming `OcGo` prefixes to `CommandCode` and removing the Responses-only interfaces.

- [ ] **Step 3: Populate known capabilities from the observed official catalog**

Add exact entries for the current Provider API IDs observed on 2026-08-30: Claude (`claude-sonnet-5`, `claude-sonnet-4-6`, `claude-fable-5`, `claude-opus-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-haiku-4-5-20251001`), GPT (`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.4-mini`), DeepSeek, Kimi, GLM, MiniMax, MiMo, Qwen, StepFun, Tencent, Gemini, Fugu, Nemotron, Inkling, Laguna, Muse Spark, and Grok IDs returned by `GET https://api.commandcode.ai/provider/v1/models`.

Use the API's `context_length` values for context windows and the official CLI/GOAT catalog for `supportsVision`, `supportsThinking`, `supportedReasoningEfforts`, and maximum output values. Preserve the exact IDs and known capability sets from the existing Command Code integration: Claude models use Anthropic; `deepseek/deepseek-v4-flash-vision-exp`, the Qwen vision variants, Kimi vision variants, compatible Gemini/GPT/MiniMax/MiMo/StepFun/Inkling/Muse/Grok models use native image input; unknown IDs remain image-disabled and non-selectable. The exact static `apiFormat` is authoritative; do not infer a sendable format from a prefix for an ID absent from the catalog.

Define `REASONING_EFFORT_ORDER` as `minimal`, `low`, `medium`, `high`, `xhigh`, `max` and include selectable efforts only where the official capability snapshot lists them. Models marked as reasoning-capable without selectable efforts expose no dropdown.

- [ ] **Step 4: Implement inference and fallback list**

Implement `inferModelInfo()` with these rules:

1. Reject an empty `id` before inference.
2. Look up exact static metadata by ID.
3. Use valid API `name` and positive `context_length` when provided; otherwise use static values.
4. Use the static entry's `apiFormat` and capabilities as the only sendable metadata.
5. For an ID absent from the static catalog, use 262,144 context when API context is absent, 65,536 output, tools false, vision false, thinking false, no `apiFormat`, and `isUserSelectable: false`.
6. Set `isUserSelectable: true` only for known catalog entries.

Set `FALLBACK_MODELS` to the complete known catalog so the model picker works when the API is unavailable. Validate an API response as non-empty before replacing this list.

- [ ] **Step 5: Run catalog tests and compile**

```bash
bun run test -- --runInBand tests/model-catalog.test.ts
bun run compile
```

Expected result: PASS for the catalog tests and TypeScript compilation.

- [ ] **Step 6: Commit the catalog**

```bash
git add src/types.ts src/constants.ts tests/model-catalog.test.ts
git commit -m "feat: add Command Code model catalog"
```

### Task 3: Implement the Command Code API client and error normalization

**Files:**
- Modify: `src/api.ts`.
- Modify: `src/constants.ts`.
- Modify: `src/types.ts` for request fields such as `stream_options`.
- Modify: `tests/api.test.ts`.

**Interfaces:**
- Produces `BASE_URL`, `fetchWithRetry()`, `fetchModels()`, `streamChatCompletion()`, `streamAnthropicMessages()`, and `throwApiError()`.
- `fetchModels(userAgent?: string): Promise<CommandCodeApiModel[]>` performs an unauthenticated GET to `/models` and validates `object === "list"`, a non-empty `data` array, non-empty string IDs and names, and positive finite `context_length` values.
- Streaming functions accept an `AbortSignal`, optional user agent, and `enableZdr` flag without exposing the API key in errors or logs.

- [ ] **Step 1: Add failing API tests**

Extend `tests/api.test.ts` with these assertions:

```typescript
test("fetchModels reads the unauthenticated live-list shape", async () => {
  global.fetch = jest.fn().mockResolvedValue(
    new Response(JSON.stringify({
      object: "list",
      data: [{ id: "Qwen/Qwen3.8-27B", name: "Qwen 3.8 27B", context_length: 262144 }],
    }), { status: 200 }),
  );

  await expect(fetchModels("test-agent")).resolves.toEqual([
    { id: "Qwen/Qwen3.8-27B", name: "Qwen 3.8 27B", context_length: 262144 },
  ]);
  expect(global.fetch).toHaveBeenCalledWith(
    "https://api.commandcode.ai/provider/v1/models",
    expect.objectContaining({
      method: "GET",
      headers: expect.objectContaining({ "User-Agent": "test-agent" }),
    }),
  );
});

test.each([
  { object: "list", data: [] },
  { object: "object", data: [{ id: "model", name: "Model", context_length: 1 }] },
  { object: "list", data: [{ id: "", name: "Model", context_length: 1 }] },
  { object: "list", data: [{ id: "model", name: "", context_length: 1 }] },
  { object: "list", data: [{ id: "model", name: "Model", context_length: 0 }] },
])("rejects invalid model catalog %#", async (body) => {
  global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
  await expect(fetchModels()).rejects.toThrow();
});

test("normalizes Command Code success-false authentication errors", async () => {
  const response = new Response(JSON.stringify({
    success: false,
    error: { code: "UNAUTHORIZED", status: 401, message: "Invalid token" },
  }), { status: 401 });

  await expect(throwApiError(response, "Command Code API error")).rejects.toThrow(
    "authentication failed",
  );
});

test("sends ZDR only when enabled", async () => {
  global.fetch = jest.fn().mockResolvedValue(
    new Response("data: [DONE]\n\n", { status: 200 }),
  );

  for await (const _chunk of streamChatCompletion(
    "secret",
    { model: "deepseek/deepseek-v4-flash", messages: [], stream: true },
    undefined,
    "test-agent",
    true,
  )) {
    void _chunk;
  }

  expect(global.fetch).toHaveBeenCalledWith(
    "https://api.commandcode.ai/provider/v1/chat/completions",
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer secret",
        "x-cmd-zdr": "1",
      }),
    }),
  );
});
```

Run the focused test file and verify it fails before implementation.

- [ ] **Step 2: Set API constants and request types**

Set:

```typescript
export const BASE_URL = "https://api.commandcode.ai/provider/v1";
export const REQUEST_TIMEOUT_MS = 120000;
export const STREAM_READ_TIMEOUT_MS = 60000;
```

Add `stream_options?: { include_usage?: boolean }` to the OpenAI request type and retain `max_tokens`, `tools`, `tool_choice`, and `reasoning_effort`.

- [ ] **Step 3: Implement model fetching**

Implement `fetchModels()` with `GET ${BASE_URL}/models`, `Accept: application/json`, `User-Agent` when supplied, a 10,000 ms timeout, JSON parsing, and strict validation of `object === "list"`, a non-empty `data` array, non-empty string `id`/`name`, and positive finite `context_length`. Do not send an API key. Throw a descriptive error for non-2xx, malformed JSON, an empty list, or any invalid entry so the provider can use its fallback list.

- [ ] **Step 4: Implement retrying streaming requests**

Retain exponential backoff with full jitter and `Retry-After` support for network failures and `429`, `502`, `503`, and `504`. Never retry `400`, `401`, `403`, `404`, `422`, or other client errors. Combine request timeout and caller cancellation with `AbortSignal.any()`.

For OpenAI requests, POST to `${BASE_URL}/chat/completions`, set `stream: true`, set `stream_options.include_usage` to true, and parse `data: {...}` lines plus `[DONE]`. For Anthropic requests, POST to `${BASE_URL}/messages`, set `Authorization: Bearer ${apiKey}`, `anthropic-version: 2023-06-01`, and parse `event:`/`data:` lines. The official API also accepts `x-api-key` for Anthropic SDK clients, but this extension uses one universal Bearer header to keep the transport deterministic.

- [ ] **Step 5: Normalize both error envelopes**

`throwApiError()` must extract messages from both:

```json
{"error":{"type":"authentication_error","message":"..."}}
```

and:

```json
{"success":false,"error":{"code":"UNAUTHORIZED","status":401,"message":"...","docs":"..."}}
```

Map status/code to the Command Code GOAT guidance in the design spec. Include only a bounded response-body excerpt and never include request headers or API keys.

- [ ] **Step 6: Run API tests and compile**

```bash
bun run test -- --runInBand tests/api.test.ts
bun run compile
```

Expected result: PASS.

- [ ] **Step 7: Commit the API client**

```bash
git add src/api.ts src/constants.ts src/types.ts tests/api.test.ts
git commit -m "feat: add Command Code Provider API client"
```

### Task 4: Adapt the OpenAI conversion and streaming path

**Files:**
- Modify: `src/openai-conversion.ts`.
- Modify: `src/streaming/openai.ts`.
- Modify: `src/streaming/shared.ts`.
- Modify: `src/guidance.ts`.
- Modify: `src/announcement.ts` if error or prompt text names OpenCode.
- Modify: `tests/openai-conversion.test.ts`.
- Create: `tests/openai-streaming.test.ts`.

**Interfaces:**
- `convertMessages()` returns Command Code OpenAI messages with text, image blocks, assistant tool calls, tool results, and optional reasoning content.
- `convertTools()` returns OpenAI function tools and `tool_choice` compatible with Command Code.
- `processOpenAIStream()` emits VS Code response parts and accepts `CommandCodeModelInfo` metadata.

- [ ] **Step 1: Add failing conversion and stream tests**

Add conversion coverage for a Japanese text message, a `data:image/png;base64,...` image, a tool call with JSON arguments, and a paired tool result. Add stream coverage using this exact mock body:

```text
data: {"id":"cc-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}

data: {"id":"cc-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":2,"total_tokens":14}}

data: [DONE]
```

Assert that text is emitted, `stop` finalizes the response, usage does not become visible chat text, and an OpenAI native tool call is emitted once after argument fragments are assembled.

Run:

```bash
bun run test -- --runInBand tests/openai-conversion.test.ts tests/openai-streaming.test.ts
```

Expected result: FAIL for the new Command Code expectations until the path is adapted.

- [ ] **Step 2: Remove OpenCode branding and endpoint assumptions**

Rename exported `OcGo` types and parameters to `CommandCode` names. Rewrite guidance to identify the model as Command Code GOAT and remove OpenCode-specific prompt replacement. Keep tool-use grounding and silent retry behavior.

- [ ] **Step 3: Build the Command Code OpenAI request**

Use the converted messages and tools, include `stream_options: { include_usage: true }`, include `reasoning_effort` only for a static catalog entry whose OpenAI route lists that effort, and use per-model fixed sampling values when present. Keep `max_tokens` because Command Code documents the standard OpenAI Chat Completions schema. Do not send `reasoning_effort` to Anthropic models.

- [ ] **Step 4: Parse response and repair tool calls**

Retain the existing incremental SSE state machine. Accept `content`, `reasoning_content`, and fragmented `tool_calls`; map them to `LanguageModelTextPart`, `LanguageModelThinkingPart` where available, and `LanguageModelToolCallPart`. Preserve duplicate suppression, argument repair, action-announcement nudge, truncation detection, and bounded retry count.

- [ ] **Step 5: Run focused tests and commit**

```bash
bun run test -- --runInBand tests/openai-conversion.test.ts tests/openai-streaming.test.ts tests/tool-parser.test.ts tests/tool-repair.test.ts
bun run compile
```

Expected result: PASS.

```bash
git add src/openai-conversion.ts src/streaming/openai.ts src/streaming/shared.ts src/guidance.ts src/announcement.ts tests/openai-conversion.test.ts tests/openai-streaming.test.ts
git commit -m "feat: support Command Code OpenAI streaming"
```

### Task 5: Adapt the Anthropic conversion and streaming path

**Files:**
- Modify: `src/anthropic-conversion.ts`.
- Modify: `src/streaming/anthropic.ts`.
- Modify: `src/streaming/shared.ts`.
- Modify: `tests/anthropic-conversion.test.ts`.
- Create: `tests/anthropic-streaming.test.ts`.

**Interfaces:**
- `convertMessagesToAnthropic()` returns `{ system?: string; messages: AnthropicMessage[] }`.
- `convertToolsToAnthropic()` returns Anthropic tools and tool choice.
- `handleAnthropicRequest()` posts Claude models to `/messages` and emits the same VS Code response parts as the OpenAI path.

- [ ] **Step 1: Add failing Anthropic conversion tests**

Create tests for system extraction, consecutive user/assistant merge, base64 image blocks, `tool_use`, and `tool_result`:

```typescript
test("converts a Claude conversation to Anthropic blocks", () => {
  const result = convertMessagesToAnthropic([
    userMessage("Inspect this image"),
    assistantMessageWithTool("read_file", { path: "README.md" }, "call-1"),
    userMessageWithToolResult("call-1", "file contents"),
  ]);

  expect(result.messages).toHaveLength(3);
  expect(result.messages[1].content).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: "tool_use", id: "call-1" })]),
  );
  expect(result.messages[2].content).toEqual(
    expect.arrayContaining([expect.objectContaining({ type: "tool_result", tool_use_id: "call-1" })]),
  );
});
```

Create the stream test with these events:

```text
event: message_start
data: {"type":"message_start","message":{"id":"msg-1","role":"assistant","content":[]}}

data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"done"}}

data: {"type":"content_block_stop","index":0}

data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}

data: {"type":"message_stop"}
```

- [ ] **Step 2: Remove DeepSeek/OpenCode special cases**

The Command Code model router sends DeepSeek and every non-Claude model through OpenAI. Anthropic conversion therefore treats every caller as a standard Claude-compatible request; do not reuse an `isDeepSeek` branch or add reasoning-only fields for unrelated models.

- [ ] **Step 3: Send standard Anthropic requests**

Set `model`, `messages`, `stream: true`, and a positive `max_tokens`. Send `system` separately when present. Send `tools` and `tool_choice` only when tools are supplied. Use `Authorization: Bearer ${apiKey}`, `anthropic-version: 2023-06-01`, `Content-Type`, `User-Agent`, and optional `x-cmd-zdr` headers. Do not send an unverified `reasoning_effort` or `thinking` field to the Anthropic route; Claude reasoning is automatic in this first release.

- [ ] **Step 4: Parse Anthropic events**

Handle `content_block_start`, `text_delta`, `thinking_delta`, `input_json_delta`, `content_block_stop`, `message_delta`, and `message_stop`. Assemble partial tool JSON before emitting a tool call, forward output usage only to debug state, and preserve silent retries for empty, truncated, reasoning-only, or missing-tool-call responses.

- [ ] **Step 5: Run focused tests and commit**

```bash
bun run test -- --runInBand tests/anthropic-conversion.test.ts tests/anthropic-streaming.test.ts tests/provider.test.ts
bun run compile
```

Expected result: PASS.

```bash
git add src/anthropic-conversion.ts src/streaming/anthropic.ts src/streaming/shared.ts tests/anthropic-conversion.test.ts tests/anthropic-streaming.test.ts
git commit -m "feat: support Command Code Anthropic streaming"
```

### Task 6: Integrate model discovery, provider lifecycle, and SecretStorage

**Files:**
- Modify: `src/provider.ts`.
- Modify: `src/extension.ts`.
- Modify: `tests/provider.test.ts`.
- Modify: `tests/extension.test.ts`.
- Modify: `__mocks__/vscode.ts` if the VS Code mock lacks the required API.

**Interfaces:**
- Produces `CommandCodeChatModelProvider implements vscode.LanguageModelChatProvider`.
- Registers vendor `commandcode-goat` and returns `LanguageModelChatInformation[]` with model-specific input/output limits and capabilities.
- Stores the key under `commandcode-goat.apiKey` and fires model-info refresh after changes.

- [ ] **Step 1: Add failing provider lifecycle tests**

Cover these cases:

```typescript
test("uses the live model list name and context length", async () => {
  mockFetchModels([{ id: "Qwen/Qwen3.8-27B", name: "Qwen 3.8 27B", context_length: 262144 }]);
  const provider = new CommandCodeChatModelProvider(secrets, "test-agent");
  const models = await provider.provideLanguageModelChatInformation({ silent: true }, token);

  expect(models).toEqual([
    expect.objectContaining({
      id: "Qwen/Qwen3.8-27B",
      name: "Qwen 3.8 27B",
      maxInputTokens: expect.any(Number),
      capabilities: { toolCalling: true, imageInput: true },
      isUserSelectable: true,
    }),
  ]);
});

test("marks a live unknown model as display-only", async () => {
  mockFetchModels([{ id: "future/model", name: "Future Model", context_length: 131072 }]);
  const provider = new CommandCodeChatModelProvider(secrets, "test-agent");
  const models = await provider.provideLanguageModelChatInformation({ silent: true }, token);

  expect(models).toEqual([
    expect.objectContaining({ id: "future/model", isUserSelectable: false }),
  ]);
});

test("falls back when model discovery fails", async () => {
  mockFetchModelsFailure();
  const provider = new CommandCodeChatModelProvider(secrets, "test-agent");
  const models = await provider.provideLanguageModelChatInformation({ silent: true }, token);

  expect(models.length).toBeGreaterThan(0);
  expect(models.some((model) => model.id === "deepseek/deepseek-v4-flash")).toBe(true);
});
```

Add tests for API key prompt/store, cancellation, image rejection on a text-only model, and `reasoningEffort` validation.

- [ ] **Step 2: Implement model discovery and merging**

Initialize the model map with `FALLBACK_MODELS`. Fetch `/models` without prompting when `silent` is true. On success, validate and map every API item through `inferModelInfo()` and replace the active list only when the list is non-empty. On failure or an empty list, retain the fallback list and log only status/count/error text.

Set `maxInputTokens` to the model context window minus the smaller of `maxOutput` and the default output budget, then subtract the dynamic safety margin. Return `toolCalling`, `imageInput`, and reasoning configuration fields from the static capability snapshot. Set `isUserSelectable: false` for metadata-unknown models and leave their `apiFormat` undefined.

- [ ] **Step 3: Implement response routing**

In `provideLanguageModelChatResponse()`:

1. Resolve and trim `commandcode-goat.apiKey`.
2. Estimate input tokens and reject over-limit messages before sending.
3. Reject an image-bearing request when `supportsVision` is false with a clear model-switch message.
4. Reject metadata-unknown models before any network request because their `apiFormat` is undefined and they are not user-selectable.
5. Read `reasoningEffort` from model configuration and drop unsupported values; pass it only to a known OpenAI route.
6. Route `apiFormat === "anthropic"` to `handleAnthropicRequest()`; route `apiFormat === "openai"` to `processOpenAIStream()`.
7. Convert abort and timeout errors to `vscode.CancellationError`.
8. Fire `onDidCompleteResponse` in `finally`.

Do not route through Responses API, a vision fallback model, a quota client, or a Command Code CLI process.

- [ ] **Step 4: Implement secure key management**

Use `SecretStorage.get`, `.store`, and `.delete` with the exact key `commandcode-goat.apiKey`. Prompt only during an actual chat request or the explicit management command; never prompt during silent model discovery. Trim input and clear the secret when the user submits an empty value.

- [ ] **Step 5: Register the VS Code provider and commands**

In `activate()`:

```typescript
const provider = new CommandCodeChatModelProvider(context.secrets, userAgent);
context.subscriptions.push(
  vscode.lm.registerLanguageModelChatProvider("commandcode-goat", provider),
);
```

Register `commandcode-goat.manage`, `commandcode-goat.toggleDebugLogging`, and `commandcode-goat.openDebugLog`. Refresh models on SecretStorage changes. Do not register usage or image-analysis language-model tools.

- [ ] **Step 6: Run provider tests and commit**

```bash
bun run test -- --runInBand tests/provider.test.ts tests/extension.test.ts tests/model-catalog.test.ts
bun run compile
```

Expected result: PASS.

```bash
git add src/provider.ts src/extension.ts tests/provider.test.ts tests/extension.test.ts __mocks__/vscode.ts
git commit -m "feat: register Command Code GOAT in Copilot Chat"
```

### Task 7: Remove out-of-scope modules and finish manifest/documentation

**Files:**
- Modify: `package.json`.
- Modify: `README.md`.
- Modify: `CHANGELOG.md`.
- Modify: `.vscodeignore` and `.gitignore` when needed.
- Delete: the Responses, usage, vision, and language-model-tool files listed in the File Map.
- Modify: all remaining source/tests that still import deleted modules or contain `opencode.ai`, `opencode-go`, `OcGo`, or OpenCode Go user-facing copy.

**Interfaces:**
- Produces a package that contains only Command Code GOAT functionality and no stale OpenCode endpoint, command, secret key, usage client, or Responses API import.

- [ ] **Step 1: Remove dead modules after integration imports are gone**

Delete exactly these files:

```text
src/responses-conversion.ts
src/streaming/responses.ts
src/tools.ts
src/usage.ts
src/usage-bar.ts
src/vision.ts
tests/responses-conversion.test.ts
tests/tools.test.ts
tests/usage.test.ts
tests/usage-bar.test.ts
tests/vision.test.ts
```

Then remove every import of those paths and run `bun run compile` to catch stale references.

- [ ] **Step 2: Add the manifest setting and contributions**

Add this configuration entry under `contributes.configuration.properties`:

```json
"commandcode-goat.enableZdr": {
  "type": "boolean",
  "default": false,
  "description": "Send x-cmd-zdr: 1 to request zero data retention from Command Code."
}
```

Keep the provider contribution:

```json
"languageModelChatProviders": [
  {
    "vendor": "commandcode-goat",
    "displayName": "Command Code GOAT",
    "managementCommand": "commandcode-goat.manage"
  }
]
```

Keep VS Code engine `^1.104.0`, compile/test/lint/package scripts, and an empty runtime `dependencies` object.

- [ ] **Step 3: Write the complete README**

Document:

1. Requirements: VS Code 1.104+, GitHub Copilot extension, Command Code GOAT or higher API access.
2. Build: `bun install --ignore-scripts`, `bun run compile`, `bun run package:vsix`.
3. Setup: install VSIX, open Manage Models, choose Command Code GOAT, and enter the key.
4. API key management command and SecretStorage behavior.
5. Dynamic model list and fallback behavior.
6. OpenAI/Anthropic endpoint routing.
7. Tool, image, reasoning, cancellation, retry, and ZDR support.
8. The current known limitation: no GOAT quota status bar because no quota endpoint is part of the documented Provider API.
9. Unofficial integration disclaimer and MIT attribution.

Do not include real keys, `.env` content, or claims of Command Code endorsement.

- [ ] **Step 4: Run stale-reference searches**

Search the tracked source, tests, manifest, and README for these exact strings and remove or replace every remaining match except the attribution URL and NOTICE explanation:

```text
opencode.ai
opencode-go
OpenCode Go
OcGo
responses-conversion
usage-bar
vision.ts
```

Also verify the secret key is exactly `commandcode-goat.apiKey` and the vendor is exactly `commandcode-goat`.

- [ ] **Step 5: Run the full local suite and commit**

```bash
bun run compile
bun run lint
bun run test -- --runInBand
```

Expected result: all commands pass.

```bash
git add package.json README.md CHANGELOG.md .vscodeignore .gitignore src tests
# Include deletions from the preceding step.
git commit -m "chore: finish Command Code GOAT extension packaging"
```

### Task 8: Package and verify the minimal proof artifact

**Files:**
- Modify: `bun.lock` only if Bun resolves the copied manifest to a different lockfile.
- Create: no source files; this task is verification and packaging.

**Interfaces:**
- Produces a locally installable `commandcode-goat-provider-0.1.0.vsix` and reproducible evidence for model discovery, compilation, tests, lint, and package contents.

- [ ] **Step 1: Run the supply-chain check before dependency resolution changes**

If `bun.lock` changed, run:

```bash
osv-scanner --lockfile bun.lock --format sarif --output reports/osv.sarif
```

Inspect the report. Do not override lifecycle scripts or add a dependency to work around a finding. Commit any intentional lockfile change separately:

```bash
git add bun.lock reports/osv.sarif
git commit -m "chore: refresh verified dependency lockfile"
```

- [ ] **Step 2: Build the VSIX**

```bash
bun run package:vsix
```

Expected result: the package script passes its changelog check, TypeScript compilation, and `vsce package`, producing `commandcode-goat-provider-0.1.0.vsix`.

- [ ] **Step 3: Inspect the package contents**

```bash
unzip -l commandcode-goat-provider-0.1.0.vsix
```

Confirm that the VSIX contains `extension/package.json`, compiled `extension/out/`, `README.md`, `LICENSE`, and `NOTICE`, and does not contain `.env`, `.env.keys`, API keys, `node_modules`, `coverage`, or source-only deleted modules.

- [ ] **Step 4: Recheck the unauthenticated live model endpoint**

```bash
curl --fail --silent --show-error https://api.commandcode.ai/provider/v1/models | bun -e 'const body = await Bun.stdin.json(); if (body.object !== "list" || !Array.isArray(body.data) || body.data.length === 0) throw new Error("invalid model list"); console.log(`${body.data.length} models; first=${body.data[0].id}`)' 
```

Expected result: a non-zero model count and a valid first model ID. This check uses no API key.

- [ ] **Step 5: Record live chat verification instructions without running a secret-bearing request**

Add the following safe user-run commands to the README. The user supplies the secret outside the repository; no literal key is written to a file or commit:

```bash
read -r -s COMMANDCODE_GOAT_API_KEY
curl https://api.commandcode.ai/provider/v1/chat/completions \
  -H "Authorization: Bearer ${COMMANDCODE_GOAT_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek/deepseek-v4-flash","messages":[{"role":"user","content":"Reply with OK."}]}'
unset COMMANDCODE_GOAT_API_KEY
```

For Claude, document the `/provider/v1/messages` endpoint with the same Bearer header and `anthropic-version: 2023-06-01`. Do not ask the coding agent to obtain or store the key.

- [ ] **Step 6: Verify Git state and finish the report**

```bash
git status --short --branch
git log --oneline --decorate -8
```

Expected result: the working tree is clean, the design and implementation commits are visible, and the VSIX path is reported. The final report must distinguish verified no-key model discovery from unverified authenticated chat/tool/image calls when no user API key was supplied.
