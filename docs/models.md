# Supported Models

Command Code GOAT Provider supports 60+ models across Anthropic, OpenAI, DeepSeek, Moonshot, Zhipu, MiniMax, Alibaba, Xiaomi, Google, xAI, Meta, and partner labs.

## Catalog Authority

At runtime, the extension fetches the dynamic model list from `GET https://api.commandcode.ai/provider/v1/models`. The static catalog in `src/constants.ts` provides authoritative capability flags, wire protocol assignment, and safety margins:

- **Claude Models (`claude-*`)**: Routed to `/provider/v1/messages` (Anthropic Messages API). Thinking is handled natively.
- **Other Models**: Routed to `/provider/v1/chat/completions` (OpenAI Chat Completions).
- **Unknown Models**: Included with `isUserSelectable: false` and capabilities disabled to protect against unsupported payloads.

## Model Lineup Overview

| Model ID | Display Name | Context Window | Max Output | Wire Protocol | Thinking | Vision |
|---|---|---|---|---|---|---|
| `claude-sonnet-5` | Claude Sonnet 5 | 1M | 65,536 | Anthropic | Native | No |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | 1M | 65,536 | Anthropic | Native | Yes |
| `claude-fable-5` | Claude Fable 5 | 1M | 65,536 | Anthropic | Native | No |
| `claude-opus-5` | Claude Opus 5 | 1M | 65,536 | Anthropic | Native | No |
| `claude-opus-4-8` | Claude Opus 4.8 | 1M | 65,536 | Anthropic | Native | No |
| `claude-opus-4-7` | Claude Opus 4.7 | 1M | 65,536 | Anthropic | Native | No |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 | 200K | 65,536 | Anthropic | Native | No |
| `gpt-5.6-sol` | GPT-5.6 Sol | 1.05M | 131,072 | OpenAI | Configurable | Yes |
| `gpt-5.6-terra` | GPT-5.6 Terra | 1.05M | 131,072 | OpenAI | Configurable | Yes |
| `gpt-5.6-luna` | GPT-5.6 Luna | 1.05M | 131,072 | OpenAI | Configurable | Yes |
| `gpt-5.5` | GPT-5.5 | 400K | 131,072 | OpenAI | Configurable | Yes |
| `gpt-5.4` | GPT-5.4 | 400K | 131,072 | OpenAI | Configurable | Yes |
| `gpt-5.3-codex` | GPT-5.3 Codex | 400K | 131,072 | OpenAI | Configurable | Yes |
| `gpt-5.4-mini` | GPT-5.4 Mini | 400K | 131,072 | OpenAI | Configurable | Yes |
| `deepseek/deepseek-v4-pro` | DeepSeek V4 Pro | 1M | 131,072 | OpenAI | Configurable | No |
| `deepseek/deepseek-v4-flash` | DeepSeek V4 Flash | 1M | 131,072 | OpenAI | Configurable | No |
| `deepseek/deepseek-v4-flash-vision-exp` | DeepSeek V4 Flash Vision | 1M | 131,072 | OpenAI | Configurable | Yes |
| `moonshotai/Kimi-K3` | Kimi K3 | 1M | 131,072 | OpenAI | Configurable | Yes |
| `moonshotai/Kimi-K2.7-Code` | Kimi K2.7 Code | 256K | 131,072 | OpenAI | Configurable | Yes |
| `moonshotai/Kimi-K2.7-Code-Highspeed` | Kimi K2.7 Code HighSpeed | 262K | 131,072 | OpenAI | Configurable | Yes |
| `moonshotai/Kimi-K2.6` | Kimi K2.6 | 256K | 131,072 | OpenAI | Configurable | Yes |
| `moonshotai/Kimi-K2.5` | Kimi K2.5 | 256K | 131,072 | OpenAI | Configurable | Yes |
| `z-ai/glm-5.3-flash` | GLM-5.3 Flash | 1.048M | 131,072 | OpenAI | Configurable | No |
| `zai-org/GLM-5.3` | GLM-5.3 | 1M | 131,072 | OpenAI | Configurable | No |
| `zai-org/GLM-5.2` | GLM-5.2 | 1M | 131,072 | OpenAI | Configurable | No |
| `zai-org/GLM-5.2-Fast` | GLM-5.2 Fast | 1M | 131,072 | OpenAI | Configurable | No |
| `zai-org/GLM-5.1` | GLM-5.1 | 200K | 131,072 | OpenAI | Configurable | No |
| `zai-org/GLM-5` | GLM-5 | 200K | 131,072 | OpenAI | Configurable | No |
| `MiniMaxAI/MiniMax-M3` | MiniMax M3 | 1M | 131,072 | OpenAI | Default | Yes |
| `MiniMaxAI/MiniMax-M2.7` | MiniMax M2.7 | 200K | 131,072 | OpenAI | Default | No |
| `minimax/minimax-m3-free` | MiniMax M3 (free) | 1M | 131,072 | OpenAI | Default | Yes |
| `minimax/minimax-m2.7-free` | MiniMax M2.7 (free) | 197K | 131,072 | OpenAI | Default | No |
| `MiniMaxAI/MiniMax-M2.5` | MiniMax M2.5 | 200K | 131,072 | OpenAI | Default | No |
| `xiaomi/mimo-v2.5-pro` | MiMo V2.5 Pro | 1M | 131,072 | OpenAI | Configurable | No |
| `xiaomi/mimo-v2.5` | MiMo V2.5 | 1M | 131,072 | OpenAI | Configurable | Yes |
| `Qwen/Qwen3.8-Max` | Qwen 3.8 Max | 1M | 65,536 | OpenAI | Configurable | Yes |
| `Qwen/Qwen3.8-27B` | Qwen 3.8 27B | 262K | 65,536 | OpenAI | Configurable | Yes |
| `Qwen/Qwen3.8-Flash` | Qwen 3.8 Flash | 1M | 65,536 | OpenAI | Configurable | Yes |
| `Qwen/Qwen3.7-Max` | Qwen 3.7 Max | 1M | 65,536 | OpenAI | Configurable | Yes |
| `Qwen/Qwen3.7-Plus` | Qwen 3.7 Plus | 1M | 65,536 | OpenAI | Configurable | Yes |
| `Qwen/Qwen3.7-Flash` | Qwen 3.7 Flash | 1M | 65,536 | OpenAI | Configurable | Yes |
| `Qwen/Qwen3.6-Max-Preview` | Qwen 3.6 Max Preview | 200K | 65,536 | OpenAI | Configurable | Yes |
| `Qwen/Qwen3.6-Plus` | Qwen 3.6 Plus | 200K | 65,536 | OpenAI | Configurable | Yes |
| `stepfun/Step-3.7-Flash` | Step 3.7 Flash | 256K | 131,072 | OpenAI | Configurable | No |
| `stepfun/Step-3.5-Flash` | Step 3.5 Flash | 1M | 131,072 | OpenAI | Configurable | No |
| `tencent/hy3-paid` | Tencent Hy3 | 262K | 131,072 | OpenAI | Configurable | No |
| `tencent/hy4-preview` | Tencent Hy4 Preview | 1.048M | 131,072 | OpenAI | Configurable | No |
| `google/gemini-3.7-flash` | Gemini 3.7 Flash | 1.048M | 65,536 | OpenAI | Default | Yes |
| `google/gemini-3.6-flash` | Gemini 3.6 Flash | 1M | 65,536 | OpenAI | Default | Yes |
| `google/gemini-3.5-flash` | Gemini 3.5 Flash | 1M | 65,536 | OpenAI | Default | Yes |
| `google/gemini-3.5-flash-lite` | Gemini 3.5 Flash Lite | 1M | 65,536 | OpenAI | Default | Yes |
| `google/gemini-3.1-flash-lite` | Gemini 3.1 Flash Lite | 1M | 65,536 | OpenAI | Default | Yes |
| `sakana/fugu-ultra` | Fugu Ultra | 1M | 131,072 | OpenAI | Default | Yes |
| `nvidia/nemotron-3-ultra-550b-a55b` | Nemotron 3 Ultra | 1M | 131,072 | OpenAI | Default | No |
| `thinkingmachines/inkling` | Inkling | 256K | 131,072 | OpenAI | Configurable | Yes |
| `thinkingmachines/inkling-small` | Inkling Small | 1M | 131,072 | OpenAI | Configurable | Yes |
| `poolside/laguna-s-2.1-free` | Laguna S 2.1 | 256K | 131,072 | OpenAI | Default | No |
| `meta/muse-spark-1.1` | Muse Spark 1.1 | 1.048M | 131,072 | OpenAI | Configurable | Yes |
| `meta/muse-spark-1.2` | Muse Spark 1.2 | 1.048M | 131,072 | OpenAI | Configurable | Yes |
| `meta/muse-spark-1.2-contributor` | Muse Spark 1.2 Contributor | 1.048M | 131,072 | OpenAI | Configurable | Yes |
| `xai/grok-4.5` | Grok 4.5 | 500K | 131,072 | OpenAI | Configurable | Yes |
| `xai/grok-4.6` | Grok 4.6 | 500K | 131,072 | OpenAI | Configurable | Yes |
