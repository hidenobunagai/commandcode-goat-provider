# Architecture

[![Command Code GOAT Provider Architecture](../images/architecture.png)](https://hidenobunagai.github.io/commandcode-goat-provider/)

> 🌐 **[View Interactive Architecture Diagram (GitHub Pages)](https://hidenobunagai.github.io/commandcode-goat-provider/)**

## Overview

The Command Code GOAT Provider is a VS Code extension that registers a custom `LanguageModelChatProvider` ("commandcode-goat") for Copilot Chat. It translates Copilot Chat's internal message format into Command Code's Anthropic-compatible or OpenAI-compatible requests, routes them to `https://api.commandcode.ai/provider/v1`, and streams responses back through VS Code's language model API.

```
Copilot Chat
  └─ LanguageModelChatProvider (commandcode-goat)
       ├─ Anthropic Conversion  (Claude models)
       │    └─ POST /provider/v1/messages  (Anthropic-compatible)
       └─ OpenAI Conversion  (all other models)
            └─ POST /provider/v1/chat/completions  (OpenAI-compatible)
                    │
                    ├─ Retry logic (exponential backoff + jitter)
                    ├─ SSE stream parsing
                    ├─ Tool call detection & repair
                    ├─ Token counting
                    └─ Zero Data Retention (x-cmd-zdr: 1)
```

## Module Map

| Module | Responsibility |
|---|---|
| `extension.ts` | Entry point. Registers the provider and debug commands. |
| `provider.ts` | `CommandCodeChatModelProvider` implements `LanguageModelChatProvider`. Orchestrates model listing, API key management, message conversion, and streaming. |
| `types.ts` | Shared types (`CommandCodeModelInfo`, `CommandCodeChatMessage`, `CommandCodeToolCall`) and catalog definitions. |
| `constants.ts` | API base URL, timeout values, context window safety margins, static catalog authority, and workaround model sets. |
| `api.ts` | HTTP client with retry logic. Handles `fetchModels`, `throwApiError` normalization, status codes, rate limiting, and SSE streaming. |
| `openai-conversion.ts` | Converts Copilot Chat `LanguageModelChatMessage[]` → OpenAI `/chat/completions` request format. |
| `streaming/openai.ts` | Parses OpenAI-compatible SSE streams into `LanguageModelResponsePart[]`. |
| `anthropic-conversion.ts` | Converts Copilot Chat messages → Anthropic `/messages` request format (used by Claude models). |
| `streaming/anthropic.ts` | Parses Anthropic-compatible SSE streams. |
| `streaming/sse.ts` | Shared SSE response body reader (`readSseLines`): per-read timeout, 1 MB buffer cap, final-buffer flush. |
| `message-parts.ts` | Type guards (`hasTextValue`, `isToolCallPart`, `isToolResultPart`) and extraction helpers for `LanguageModelInputPart`. |
| `tokenizer.ts` | Lightweight token estimator (CJK ~1 token/char, other ~2 chars/token). No WASM/tiktoken dependency. |
| `tool-parser.ts` | Parses text-embedded and XML-style tool calls from streaming model output. Includes `ToolCallScanner` for incremental parsing. |
| `announcement.ts` | Detects responses that end by announcing an action (JA/EN/ZH) without emitting the tool call, and builds the nudge message used to continue the turn. |
| `tool-repair.ts` | Deduplicates tool calls, repairs missing arguments from chat context, and coerces argument types using `inputSchema`. |
| `guidance.ts` | Builds system-prompt guidance: provider identity, tool-use instructions, and DeepSeek-specific prompt sanitization. |
| `output-channel.ts` | Centralized debug logging via `vscode.OutputChannel`. |

## Data Flow

### 1. Model Discovery

The provider dynamically fetches the current model list from the Command Code API (`GET /provider/v1/models`) and maps each model with `inferModelInfo()`. The static catalog in `src/constants.ts` remains the authoritative source for model capabilities, wire format, and token limits. Unknown models are included with `isUserSelectable: false` and capabilities disabled to protect users from sending unsupported payloads.

### 2. Request Lifecycle

1. **Copilot Chat** calls `provideLanguageModelChatResponse(messages, options, token)`.
2. The provider reads the API key from `SecretStorage` (`commandcode-goat.apiKey`).
3. System prompt guidance is injected (`guidance.ts`):
   - Provider identity ("You are GitHub Copilot using Command Code GOAT...")
   - Tool-use grounding instructions
   - DeepSeek-specific prompt sanitization
4. Messages are converted to API-specific format:
   - **Anthropic format** (`apiFormat: "anthropic"`): `anthropic-conversion.ts` → `POST /provider/v1/messages`
   - **OpenAI format** (`apiFormat: "openai"`): `openai-conversion.ts` → `POST /provider/v1/chat/completions`
5. Optional Zero Data Retention (`commandcode-goat.enableZdr`) sets `x-cmd-zdr: 1`.
6. The response is streamed back as SSE, parsed into `LanguageModelResponsePart[]`, and yielded to Copilot Chat.

### 3. Tool Execution

- **Native tool calling**: Assembles fragmented JSON tool call arguments incrementally.
- **Text-embedded tool calls**: Parsed from streaming output by `tool-parser.ts` (`ToolCallScanner`).
- **Tool call repair**: `tool-repair.ts` deduplicates tool calls and repairs missing/invalid arguments using `inputSchema` and chat context.

### 4. Error Handling & Retry

`api.ts` implements exponential backoff with full jitter:
- Retries on `429` (rate limit), `502`, `503`, `504`
- Respects `Retry-After` headers
- Per-read SSE timeout (60s) to detect silent connection drops
- Request-level timeout (120s)
- Error normalization handles both standard error objects and `{ success: false, error: { message, status } }` envelopes.
