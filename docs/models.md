# Supported Models

Command Code GOAT Provider supports 60+ models across Anthropic, OpenAI, DeepSeek, Moonshot, Zhipu, MiniMax, Alibaba, Xiaomi, Google, xAI, Meta, and partner labs.

## Catalog Authority

At runtime, the extension fetches the dynamic model list from `GET https://api.commandcode.ai/provider/v1/models`. The static catalog in `src/constants.ts` (synced from `commandcode-goat-dsh-provider/src/catalog/data.ts` via `commandcode.ai/docs`) provides authoritative capability flags, wire protocol assignment, and safety margins:

- **Claude Models (`claude-*`)**: Routed to `/provider/v1/messages` (Anthropic Messages API).
- **Other Models**: Routed to `/provider/v1/chat/completions` (OpenAI Chat Completions).
- **Unknown Models**: Included with `isUserSelectable: false` and capabilities disabled to protect against unsupported payloads.

## Model Lineup Overview

| Model ID | Display Name | Context Window | Max Output | Wire Protocol | Thinking | Vision |
|---|---|---|---|---|---|---|
| `gpt-5.6-luna` | GPT-5.6 Luna | 1,050,000 | 128,000 | ✓ | low, medium, high, xhigh, max | ✓ (`low,medium,high,xhigh,max`) |
| `gpt-5.6-sol` | GPT-5.6 Sol | 1.05M | 65,536 | OpenAI | low, medium, high, xhigh, max | Yes |
| `google/gemini-3.8-flash` | Gemini 3.8 Flash | 1M | 65,536 | OpenAI | low, medium, high | Yes |
| `google/gemini-3.7-flash` | Gemini 3.7 Flash | 1M | 65,536 | OpenAI | low, medium, high | Yes |
| `xai/grok-4.6` | Grok 4.6 | 500,000 | 500,000 | ✓ | low, medium, high, xhigh | ✓ (`low,medium,high,xhigh`) |
| `deepseek/deepseek-v4-pro` | DeepSeek V4 Pro | 1,000,000 | 384,000 | ✗ | high, max | ✓ (`high,max`) |
| `deepseek/deepseek-v4-flash` | DeepSeek V4 Flash | 1,000,000 | 384,000 | ✗ | high, max | ✓ (`low,high,max`) |
| `deepseek/deepseek-v4-flash-fast` | DeepSeek V4 Flash Fast | 1M | 65,536 | OpenAI | high, max | No |
| `moonshotai/Kimi-K3` | Kimi K3 | 1,048,576 | 131,072 | ✓ | - | ✓ (`max`) |
| `moonshotai/Kimi-K2.7-Code` | Kimi K2.7 Code | 262,144 | 262,144 | ✓ | - | Yes |
| `Qwen/Qwen3.8-Max` | Qwen 3.8 Max | 1M | 65,536 | OpenAI | low, medium, xhigh | Yes |
| `Qwen/Qwen3.8-Max-0902` | Qwen 3.8 Max 0902 | 1M | 65,536 | OpenAI | low, medium, xhigh | Yes |
| `Qwen/Qwen3.8-Flash` | Qwen 3.8 Flash | 1M | 65,536 | OpenAI | low, medium, xhigh | Yes |
| `Qwen/Qwen3.8-27B` | Qwen 3.8 27B | 262K | 65,536 | OpenAI | low, medium, xhigh | Yes |
| `z-ai/glm-5.3-flash` | GLM-5.3 Flash | 1M | 65,536 | OpenAI | low, high, max | Yes |
| `zai-org/GLM-5.3` | GLM-5.3 | 1,000,000 | 131,072 | ✗ | low, high, max | ✓ (`low,high,max`) |
| `MiniMaxAI/MiniMax-M3` | MiniMax M3 | 1,000,000 | 131,072 | ✓ | - | Yes |
| `xai/grok-4.5` | Grok 4.5 | 500K | 65,536 | OpenAI | low, medium, high | Yes |
| `meta/muse-spark-1.3` | Muse Spark 1.3 | 1M | 65,536 | OpenAI | - | Yes |
| `meta/muse-spark-1.3-contributor` | Muse Spark 1.3 Contributor | 1,048,576 | 131,072 | ✓ | - | ✓ (`minimal,low,medium,high,xhigh`) |
| `meta/muse-spark-1.2` | Muse Spark 1.2 | 1M | 65,536 | OpenAI | - | Yes |
| `meta/muse-spark-1.2-contributor` | Muse Spark 1.2 Contributor | 1,048,576 | 131,072 | ✓ | - | ✓ (`minimal,low,medium,high,xhigh`) |
| `stepfun/Step-3.7-Flash` | Step 3.7 Flash | 256K | 65,536 | OpenAI | - | Yes |
| `tencent/hy4-preview` | Tencent Hy4 Preview | 1M | 65,536 | OpenAI | - | No |
| `xiaomi/mimo-v2.5-pro` | MiMo V2.5 Pro | 1,048,576 | 128,000 | ✗ | - | No |
| `Qwen/Qwen3.7-Flash` | Qwen 3.7 Flash | 1M | 65,536 | OpenAI | - | Yes |
| `stepfun/Step-3.5-Flash` | Step 3.5 Flash | 256K | 65,536 | OpenAI | - | Yes |
| `xiaomi/mimo-v2.5` | MiMo V2.5 | 1,000,000 | 128,000 | ✓ | - | Yes |
| `tencent/hy3-paid` | Hy3 Paid | 1M | 65,536 | OpenAI | - | No |
| `Qwen/Qwen3.7-Plus` | Qwen 3.7 Plus | 1M | 65,536 | OpenAI | - | Yes |
| `Qwen/Qwen3.6-Plus` | Qwen 3.6 Plus | 1M | 65,536 | OpenAI | - | Yes |
| `moonshotai/Kimi-K2.5` | Kimi K2.5 | 1M | 65,536 | OpenAI | - | Yes |
| `nvidia/nemotron-3-ultra-550b-a55b` | Nemotron 3 Ultra | 1M | 65,536 | OpenAI | - | No |
| `zai-org/GLM-5` | GLM-5 | 1M | 65,536 | OpenAI | - | No |
| `thinkingmachines/inkling` | Inkling | 1M | 65,536 | OpenAI | - | Yes |
| `Qwen/Qwen3.6-Max-Preview` | Qwen 3.6 Max Preview | 1M | 65,536 | OpenAI | - | No |
| `zai-org/GLM-5.1` | GLM-5.1 | 202,752 | 32,768 | ✗ | - | No |
| `zai-org/GLM-5.2` | GLM-5.2 | 1,000,000 | 131,072 | ✗ | high, max | ✓ (`high,max`) |
| `moonshotai/Kimi-K2.6` | Kimi K2.6 | 262,144 | 65,536 | ✓ | - | ✗ |
| `moonshotai/Kimi-K2.7-Code-Highspeed` | Kimi K2.7 Code Highspeed | 256K | 65,536 | OpenAI | - | No |
| `Qwen/Qwen3.7-Max` | Qwen 3.7 Max | 1M | 65,536 | OpenAI | - | No |
| `zai-org/GLM-5.2-Fast` | GLM-5.2 Fast | 1M | 65,536 | OpenAI | - | No |
| `thinkingmachines/inkling-small` | Inkling Small | 1M | 65,536 | OpenAI | - | Yes |
| `MiniMaxAI/MiniMax-M2.5` | MiniMax M2.5 | 1M | 65,536 | OpenAI | - | Yes |
| `MiniMaxAI/MiniMax-M2.7` | MiniMax M2.7 | 204,800 | 131,072 | ✗ | - | Yes |
| `deepseek/deepseek-v4-flash-vision-exp` | DeepSeek V4 Flash Vision Exp | 1,000,000 | 384,000 | ✓ | high, max | ✓ (`low,high,max`) |
| `poolside/laguna-s-2.1-free` | Laguna S 2.1 Free | 256K | 65,536 | OpenAI | - | No |
| `claude-fable-5-1` | Claude Fable 5.1 | 1M | 65,536 | Anthropic | low, medium, high, xhigh, max | Yes |
| `claude-fable-5` | Claude Fable 5 | 1M | 65,536 | Anthropic | low, medium, high, xhigh, max | Yes |
| `claude-opus-4-7` | Claude Opus 4.7 | 1M | 65,536 | Anthropic | low, medium, high, xhigh, max | Yes |
| `google/gemini-3.1-flash-lite` | Gemini 3.1 Flash Lite | 1M | 65,536 | OpenAI | low, medium, high | Yes |
| `google/gemini-3.5-flash` | Gemini 3.5 Flash | 1M | 65,536 | OpenAI | low, medium, high | Yes |
| `google/gemini-3.5-flash-lite` | Gemini 3.5 Flash Lite | 1M | 65,536 | OpenAI | low, medium, high | Yes |
| `gpt-5.3-codex` | GPT-5.3 Codex | 400K | 65,536 | OpenAI | low, medium, high, xhigh | Yes |
| `gpt-5.4` | GPT-5.4 | 400K | 65,536 | OpenAI | low, medium, high, xhigh | Yes |
| `gpt-5.4-mini` | GPT-5.4 Mini | 400K | 65,536 | OpenAI | low, medium, high | Yes |
| `meta/muse-spark-1.1` | Muse Spark 1.1 | 1M | 65,536 | OpenAI | - | Yes |
| `claude-sonnet-5` | Claude Sonnet 5 | 1M | 65,536 | Anthropic | low, medium, high, xhigh, max | Yes |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | 1M | 65,536 | Anthropic | low, medium, high, xhigh, max | Yes |
| `claude-opus-5` | Claude Opus 5 | 1M | 65,536 | Anthropic | low, medium, high, xhigh, max | Yes |
| `claude-opus-4-8` | Claude Opus 4.8 | 1M | 65,536 | Anthropic | low, medium, high, xhigh, max | Yes |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 | 200K | 65,536 | Anthropic | - | Yes |
| `gpt-5.6-terra` | GPT-5.6 Terra | 1.05M | 65,536 | OpenAI | low, medium, high, xhigh, max | Yes |
| `gpt-5.5` | GPT-5.5 | 400K | 65,536 | OpenAI | low, medium, high, xhigh | Yes |
| `google/gemini-3.6-flash` | Gemini 3.6 Flash | 1M | 65,536 | OpenAI | low, medium, high | Yes |
| `sakana/fugu-ultra` | Fugu Ultra | 1M | 65,536 | OpenAI | high, xhigh | Yes |
| `meituan/LongCat-2.0:free` | LongCat 2.0 | 1,000,000 | 131,072 | ✗ | - | No |
