import { version } from "../package.json";
import type { CommandCodeApiModel, CommandCodeModelInfo, ReasoningEffort } from "./types";

export const BASE_URL = "https://api.commandcode.ai/provider/v1";
export const EXTENSION_VERSION: string = version;

/** Compute a dynamic safety margin: 1% of context window, minimum 2048 tokens.
 * Larger models need proportionally larger margins for system overhead. */
export function getContextWindowSafetyMargin(contextWindow: number): number {
  return Math.max(2048, Math.floor(contextWindow * 0.01));
}

/** Default token limit if model info is unknown */
export const DEFAULT_MAX_OUTPUT_TOKENS = 65536;

/** Maximum retry delay in milliseconds */
export const MAX_RETRY_DELAY_MS = 30000;

/** Base retry delay in milliseconds */
export const BASE_RETRY_DELAY_MS = 1000;

/** Request timeout in milliseconds */
export const REQUEST_TIMEOUT_MS = 120000;

/**
 * Per-read timeout for SSE stream reads (milliseconds).
 * Prevents infinite hangs when the server pauses mid-stream or the
 * connection silently drops.  The reader races against this timeout;
 * if it fires, the stream is cancelled and the generator exits so
 * the retry loop can re-establish a new connection.
 */
export const STREAM_READ_TIMEOUT_MS = 60000;

/** Max tool result characters for Anthropic API */
export const ANTHROPIC_MAX_TOOL_RESULT_CHARS = 20000;

/** Explicit model IDs that require the reasoning_content workaround. */
const REASONING_CONTENT_WORKAROUND_STATIC_SET = new Set([
  "kimi-k2.6",
  "kimi-k2.7-code",
  "kimi-k3",
  "moonshotai/Kimi-K2.6",
  "moonshotai/Kimi-K2.7-Code",
  "moonshotai/Kimi-K2.7-Code-Highspeed",
  "moonshotai/Kimi-K3",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-v4-flash-vision-exp",
  "deepseek/deepseek-v4-flash-fast",
  "ox-alpha-free",
]);

/**
 * Models that internally reason even though they do not need the
 * reasoning_content workaround (e.g. Responses API models).  They still
 * consume part of the output budget on reasoning, so they get the same
 * minimum output budget floor as workaround models.
 */
const THINKING_MODEL_STATIC_SET = new Set(["gpt-5.6-luna", "meta/muse-spark-1.2-contributor"]);

/** Models that require the reasoning_content workaround */
export const REASONING_CONTENT_WORKAROUND_MODELS = {
  has(modelId: string): boolean {
    if (REASONING_CONTENT_WORKAROUND_STATIC_SET.has(modelId)) {
      return true;
    }
    const lower = modelId.toLowerCase();
    if (lower.includes("kimi")) {
      return !lower.includes("k2.5");
    }
    if (lower.includes("deepseek")) {
      const match = lower.match(/deepseek-v(\d+)/);
      if (match) {
        const version = parseInt(match[1], 10);
        return version >= 4;
      }
      return lower.includes("-r1") || lower.includes("-r2");
    }
    return false;
  },
};

/** Models with internal reasoning that need a minimum output budget */
export const THINKING_MODELS = {
  has(modelId: string): boolean {
    return (
      THINKING_MODEL_STATIC_SET.has(modelId) || REASONING_CONTENT_WORKAROUND_MODELS.has(modelId)
    );
  },
};

export const REASONING_EFFORT_ORDER: readonly ReasoningEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const OFFICIAL_MODELS: Array<[string, string, number]> = [
  ["gpt-5.6-luna", "GPT-5.6 Luna", 1050000],
  ["gpt-5.6-sol", "GPT-5.6 Sol", 1050000],
  ["google/gemini-3.7-flash", "Gemini 3.7 Flash", 1048576],
  ["xai/grok-4.6", "Grok 4.6", 500000],
  ["deepseek/deepseek-v4-pro", "DeepSeek V4 Pro", 1000000],
  ["deepseek/deepseek-v4-flash", "DeepSeek V4 Flash", 1000000],
  ["deepseek/deepseek-v4-flash-fast", "DeepSeek V4 Flash Fast", 1000000],
  ["moonshotai/Kimi-K3", "Kimi K3", 1000000],
  ["moonshotai/Kimi-K2.7-Code", "Kimi K2.7 Code", 256000],
  ["Qwen/Qwen3.8-Max", "Qwen 3.8 Max", 1000000],
  ["Qwen/Qwen3.8-Flash", "Qwen 3.8 Flash", 1000000],
  ["Qwen/Qwen3.8-27B", "Qwen 3.8 27B", 262144],
  ["z-ai/glm-5.3-flash", "GLM-5.3 Flash", 1048576],
  ["zai-org/GLM-5.3", "GLM-5.3", 1000000],
  ["MiniMaxAI/MiniMax-M3", "MiniMax M3", 1000000],
  ["minimax/minimax-m3-free", "MiniMax M3 (Free)", 1000000],
  ["xai/grok-4.5", "Grok 4.5", 500000],
  ["meta/muse-spark-1.2", "Muse Spark 1.2", 1048576],
  ["meta/muse-spark-1.2-contributor", "Muse Spark 1.2 Contributor", 1048576],
  ["stepfun/Step-3.7-Flash", "Step 3.7 Flash", 256000],
  ["tencent/hy4-preview", "Tencent Hy4 Preview", 1048576],
  ["xiaomi/mimo-v2.5-pro", "MiMo V2.5 Pro", 1000000],
  ["Qwen/Qwen3.7-Flash", "Qwen 3.7 Flash", 1000000],
  ["stepfun/Step-3.5-Flash", "Step 3.5 Flash", 256000],
  ["xiaomi/mimo-v2.5", "MiMo V2.5", 1000000],
  ["tencent/hy3-paid", "Hy3 Paid", 1000000],
  ["Qwen/Qwen3.7-Plus", "Qwen 3.7 Plus", 1000000],
  ["Qwen/Qwen3.6-Plus", "Qwen 3.6 Plus", 1000000],
  ["moonshotai/Kimi-K2.5", "Kimi K2.5", 1000000],
  ["nvidia/nemotron-3-ultra-550b-a55b", "Nemotron 3 Ultra", 1000000],
  ["zai-org/GLM-5", "GLM-5", 1000000],
  ["thinkingmachines/inkling", "Inkling", 1000000],
  ["Qwen/Qwen3.6-Max-Preview", "Qwen 3.6 Max Preview", 1000000],
  ["zai-org/GLM-5.1", "GLM-5.1", 1000000],
  ["zai-org/GLM-5.2", "GLM-5.2", 1000000],
  ["moonshotai/Kimi-K2.6", "Kimi K2.6", 1000000],
  ["moonshotai/Kimi-K2.7-Code-Highspeed", "Kimi K2.7 Code Highspeed", 256000],
  ["Qwen/Qwen3.7-Max", "Qwen 3.7 Max", 1000000],
  ["zai-org/GLM-5.2-Fast", "GLM-5.2 Fast", 1000000],
  ["thinkingmachines/inkling-small", "Inkling Small", 1000000],
  ["MiniMaxAI/MiniMax-M2.5", "MiniMax M2.5", 1000000],
  ["MiniMaxAI/MiniMax-M2.7", "MiniMax M2.7", 1000000],
  ["deepseek/deepseek-v4-flash-vision-exp", "DeepSeek V4 Flash Vision Exp", 1000000],
  ["poolside/laguna-s-2.1-free", "Laguna S 2.1 Free", 256000],
  ["minimax/minimax-m2.7-free", "MiniMax M2.7 Free", 1000000],
  ["claude-fable-5", "Claude Fable 5", 1000000],
  ["claude-opus-4-7", "Claude Opus 4.7", 1000000],
  ["google/gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite", 1000000],
  ["google/gemini-3.5-flash", "Gemini 3.5 Flash", 1000000],
  ["google/gemini-3.5-flash-lite", "Gemini 3.5 Flash Lite", 1000000],
  ["gpt-5.3-codex", "GPT-5.3 Codex", 400000],
  ["gpt-5.4", "GPT-5.4", 400000],
  ["gpt-5.4-mini", "GPT-5.4 Mini", 400000],
  ["meta/muse-spark-1.1", "Muse Spark 1.1", 1048576],
  ["claude-sonnet-5", "Claude Sonnet 5", 1000000],
  ["claude-sonnet-4-6", "Claude Sonnet 4.6", 1000000],
  ["claude-opus-5", "Claude Opus 5", 1000000],
  ["claude-opus-4-8", "Claude Opus 4.8", 1000000],
  ["claude-haiku-4-5-20251001", "Claude Haiku 4.5", 200000],
  ["gpt-5.6-terra", "GPT-5.6 Terra", 1050000],
  ["gpt-5.5", "GPT-5.5", 400000],
  ["google/gemini-3.6-flash", "Gemini 3.6 Flash", 1000000],
  ["sakana/fugu-ultra", "Fugu Ultra", 1000000],
];

// Synced from commandcode-goat-dsh-provider/src/catalog/data.ts (commandcode.ai/docs via pnpm generate:knowledge) — do not hand-edit modalities/efforts/protocol
const VISION_SET = new Set([
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "google/gemini-3.7-flash",
  "xai/grok-4.6",
  "moonshotai/Kimi-K3",
  "moonshotai/Kimi-K2.7-Code",
  "Qwen/Qwen3.8-Max",
  "Qwen/Qwen3.8-Flash",
  "Qwen/Qwen3.8-27B",
  "z-ai/glm-5.3-flash",
  "MiniMaxAI/MiniMax-M3",
  "minimax/minimax-m3-free",
  "xai/grok-4.5",
  "meta/muse-spark-1.2",
  "meta/muse-spark-1.2-contributor",
  "stepfun/Step-3.7-Flash",
  "Qwen/Qwen3.7-Flash",
  "stepfun/Step-3.5-Flash",
  "xiaomi/mimo-v2.5",
  "Qwen/Qwen3.7-Plus",
  "Qwen/Qwen3.6-Plus",
  "moonshotai/Kimi-K2.5",
  "thinkingmachines/inkling",
  "moonshotai/Kimi-K2.6",
  "thinkingmachines/inkling-small",
  "MiniMaxAI/MiniMax-M2.5",
  "MiniMaxAI/MiniMax-M2.7",
  "deepseek/deepseek-v4-flash-vision-exp",
  "claude-fable-5",
  "claude-opus-4-7",
  "google/gemini-3.1-flash-lite",
  "google/gemini-3.5-flash",
  "google/gemini-3.5-flash-lite",
  "gpt-5.3-codex",
  "gpt-5.4",
  "gpt-5.4-mini",
  "meta/muse-spark-1.1",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-haiku-4-5-20251001",
  "gpt-5.6-terra",
  "gpt-5.5",
  "google/gemini-3.6-flash",
  "sakana/fugu-ultra",
]);
const EFFORTS_MAP = new Map<string, ReasoningEffort[]>([
  ["gpt-5.6-luna", ["low", "medium", "high", "xhigh", "max"]],
  ["gpt-5.6-sol", ["low", "medium", "high", "xhigh", "max"]],
  ["google/gemini-3.7-flash", ["low", "medium", "high"]],
  ["xai/grok-4.6", ["low", "medium", "high", "xhigh"]],
  ["deepseek/deepseek-v4-pro", ["high", "max"]],
  ["deepseek/deepseek-v4-flash", ["high", "max"]],
  ["deepseek/deepseek-v4-flash-fast", ["high", "max"]],
  ["Qwen/Qwen3.8-Max", ["low", "medium", "xhigh"]],
  ["Qwen/Qwen3.8-Flash", ["low", "medium", "xhigh"]],
  ["Qwen/Qwen3.8-27B", ["low", "medium", "xhigh"]],
  ["z-ai/glm-5.3-flash", ["low", "high", "max"]],
  ["zai-org/GLM-5.3", ["low", "high", "max"]],
  ["xai/grok-4.5", ["low", "medium", "high"]],
  ["zai-org/GLM-5.2", ["high", "max"]],
  ["deepseek/deepseek-v4-flash-vision-exp", ["high", "max"]],
  ["claude-fable-5", ["low", "medium", "high", "xhigh", "max"]],
  ["claude-opus-4-7", ["low", "medium", "high", "xhigh", "max"]],
  ["google/gemini-3.1-flash-lite", ["low", "medium", "high"]],
  ["google/gemini-3.5-flash", ["low", "medium", "high"]],
  ["google/gemini-3.5-flash-lite", ["low", "medium", "high"]],
  ["gpt-5.3-codex", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.4", ["low", "medium", "high", "xhigh"]],
  ["gpt-5.4-mini", ["low", "medium", "high"]],
  ["claude-sonnet-5", ["low", "medium", "high", "xhigh", "max"]],
  ["claude-sonnet-4-6", ["low", "medium", "high", "xhigh", "max"]],
  ["claude-opus-5", ["low", "medium", "high", "xhigh", "max"]],
  ["claude-opus-4-8", ["low", "medium", "high", "xhigh", "max"]],
  ["gpt-5.6-terra", ["low", "medium", "high", "xhigh", "max"]],
  ["gpt-5.5", ["low", "medium", "high", "xhigh"]],
  ["google/gemini-3.6-flash", ["low", "medium", "high"]],
  ["sakana/fugu-ultra", ["high", "xhigh"]],
]);
const PROTOCOL_MAP = new Map<string, "openai" | "anthropic">([
  ["gpt-5.6-luna", "openai"],
  ["gpt-5.6-sol", "openai"],
  ["google/gemini-3.7-flash", "openai"],
  ["xai/grok-4.6", "openai"],
  ["deepseek/deepseek-v4-pro", "openai"],
  ["deepseek/deepseek-v4-flash", "openai"],
  ["deepseek/deepseek-v4-flash-fast", "openai"],
  ["moonshotai/Kimi-K3", "openai"],
  ["moonshotai/Kimi-K2.7-Code", "openai"],
  ["Qwen/Qwen3.8-Max", "openai"],
  ["Qwen/Qwen3.8-Flash", "openai"],
  ["Qwen/Qwen3.8-27B", "openai"],
  ["z-ai/glm-5.3-flash", "openai"],
  ["zai-org/GLM-5.3", "openai"],
  ["MiniMaxAI/MiniMax-M3", "openai"],
  ["minimax/minimax-m3-free", "openai"],
  ["xai/grok-4.5", "openai"],
  ["meta/muse-spark-1.2", "openai"],
  ["meta/muse-spark-1.2-contributor", "openai"],
  ["stepfun/Step-3.7-Flash", "openai"],
  ["tencent/hy4-preview", "openai"],
  ["xiaomi/mimo-v2.5-pro", "openai"],
  ["Qwen/Qwen3.7-Flash", "openai"],
  ["stepfun/Step-3.5-Flash", "openai"],
  ["xiaomi/mimo-v2.5", "openai"],
  ["tencent/hy3-paid", "openai"],
  ["Qwen/Qwen3.7-Plus", "openai"],
  ["Qwen/Qwen3.6-Plus", "openai"],
  ["moonshotai/Kimi-K2.5", "openai"],
  ["nvidia/nemotron-3-ultra-550b-a55b", "openai"],
  ["zai-org/GLM-5", "openai"],
  ["thinkingmachines/inkling", "openai"],
  ["Qwen/Qwen3.6-Max-Preview", "openai"],
  ["zai-org/GLM-5.1", "openai"],
  ["zai-org/GLM-5.2", "openai"],
  ["moonshotai/Kimi-K2.6", "openai"],
  ["moonshotai/Kimi-K2.7-Code-Highspeed", "openai"],
  ["Qwen/Qwen3.7-Max", "openai"],
  ["zai-org/GLM-5.2-Fast", "openai"],
  ["thinkingmachines/inkling-small", "openai"],
  ["MiniMaxAI/MiniMax-M2.5", "openai"],
  ["MiniMaxAI/MiniMax-M2.7", "openai"],
  ["deepseek/deepseek-v4-flash-vision-exp", "openai"],
  ["poolside/laguna-s-2.1-free", "openai"],
  ["minimax/minimax-m2.7-free", "openai"],
  ["claude-fable-5", "anthropic"],
  ["claude-opus-4-7", "anthropic"],
  ["google/gemini-3.1-flash-lite", "openai"],
  ["google/gemini-3.5-flash", "openai"],
  ["google/gemini-3.5-flash-lite", "openai"],
  ["gpt-5.3-codex", "openai"],
  ["gpt-5.4", "openai"],
  ["gpt-5.4-mini", "openai"],
  ["meta/muse-spark-1.1", "openai"],
  ["claude-sonnet-5", "anthropic"],
  ["claude-sonnet-4-6", "anthropic"],
  ["claude-opus-5", "anthropic"],
  ["claude-opus-4-8", "anthropic"],
  ["claude-haiku-4-5-20251001", "anthropic"],
  ["gpt-5.6-terra", "openai"],
  ["gpt-5.5", "openai"],
  ["google/gemini-3.6-flash", "openai"],
  ["sakana/fugu-ultra", "openai"],
]);
const vision = (id: string) => VISION_SET.has(id);
const thinking = (id: string) => EFFORTS_MAP.has(id);
const efforts = (id: string): ReasoningEffort[] | undefined => EFFORTS_MAP.get(id);
const protocolFor = (id: string): "openai" | "anthropic" => PROTOCOL_MAP.get(id) ?? "openai";
const staticInfo = new Map(
  OFFICIAL_MODELS.map(
    ([id, name, contextWindow]) =>
      [
        id,
        {
          id,
          name,
          displayName: name,
          contextWindow,
          maxOutput: /claude|Qwen|Kimi|gemini/i.test(id) ? 65536 : 131072,
          supportsTools: true,
          supportsVision: vision(id),
          apiFormat: protocolFor(id),
          fixedTemperature: /Qwen/i.test(id) ? 0.55 : /Kimi/i.test(id) ? 1 : undefined,
          fixedTopP: /Qwen/i.test(id) ? 1 : /Kimi-K2.5/i.test(id) ? 0.95 : undefined,
          supportsThinking: thinking(id),
          supportedReasoningEfforts: efforts(id),
          isUserSelectable: true,
        },
      ] satisfies [string, CommandCodeModelInfo],
  ),
);

export const FALLBACK_MODELS: CommandCodeModelInfo[] = [...staticInfo.values()];

export function inferModelInfo(model: CommandCodeApiModel | string): CommandCodeModelInfo {
  const apiModel: CommandCodeApiModel = typeof model === "string" ? { id: model } : model;
  if (!apiModel.id) throw new Error("model id must be non-empty");
  const known = staticInfo.get(apiModel.id);
  if (!known)
    return {
      id: apiModel.id,
      name: apiModel.name || apiModel.id,
      displayName: apiModel.name || apiModel.id,
      contextWindow:
        apiModel.context_length && apiModel.context_length > 0 ? apiModel.context_length : 262144,
      maxOutput: 65536,
      supportsTools: false,
      supportsVision: false,
      supportsThinking: false,
      isUserSelectable: false,
    };
  return {
    ...known,
    name: apiModel.name || known.name,
    displayName: apiModel.name || known.displayName,
    contextWindow:
      apiModel.context_length && apiModel.context_length > 0
        ? apiModel.context_length
        : known.contextWindow,
  };
}
