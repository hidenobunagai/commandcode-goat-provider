import { version } from "../package.json";
import type { CommandCodeApiModel, CommandCodeModelInfo, ReasoningEffort } from "./types";

export const BASE_URL = "https://opencode.ai/zen/go/v1";
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
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "ox-alpha-free",
]);

/**
 * Models that internally reason even though they do not need the
 * reasoning_content workaround (e.g. Responses API models).  They still
 * consume part of the output budget on reasoning, so they get the same
 * minimum output budget floor as workaround models.
 */
const THINKING_MODEL_STATIC_SET = new Set(["gpt-5.6-luna", "muse-spark-1.2-contributor"]);

/** Models that require the reasoning_content workaround */
export const REASONING_CONTENT_WORKAROUND_MODELS = {
  has(modelId: string): boolean {
    if (REASONING_CONTENT_WORKAROUND_STATIC_SET.has(modelId)) {
      return true;
    }
    if (modelId.startsWith("kimi-")) {
      return !modelId.includes("k2.5");
    }
    if (modelId.startsWith("deepseek-")) {
      const match = modelId.match(/deepseek-v(\d+)/);
      if (match) {
        const version = parseInt(match[1], 10);
        return version >= 4;
      }
      return modelId.includes("-r1") || modelId.includes("-r2");
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

export const REASONING_EFFORT_ORDER: readonly ReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh", "max"];

const OFFICIAL_MODELS: Array<[string, string, number]> = [
  ["claude-sonnet-5", "Claude Sonnet 5", 1000000], ["claude-sonnet-4-6", "Claude Sonnet 4.6", 1000000], ["claude-fable-5", "Claude Fable 5", 1000000], ["claude-opus-5", "Claude Opus 5", 1000000], ["claude-opus-4-8", "Claude Opus 4.8", 1000000], ["claude-opus-4-7", "Claude Opus 4.7", 1000000], ["claude-haiku-4-5-20251001", "Claude Haiku 4.5", 200000],
  ["gpt-5.6-sol", "GPT-5.6 Sol", 1050000], ["gpt-5.6-terra", "GPT-5.6 Terra", 1050000], ["gpt-5.6-luna", "GPT-5.6 Luna", 1050000], ["gpt-5.5", "GPT-5.5", 400000], ["gpt-5.4", "GPT-5.4", 400000], ["gpt-5.3-codex", "GPT-5.3 Codex", 400000], ["gpt-5.4-mini", "GPT-5.4 Mini", 400000],
  ["deepseek/deepseek-v4-pro", "DeepSeek V4 Pro (latest)", 1000000], ["deepseek/deepseek-v4-flash", "DeepSeek V4 Flash (latest)", 1000000], ["deepseek/deepseek-v4-flash-vision-exp", "DeepSeek V4 Flash Vision (exp)", 1000000],
  ["moonshotai/Kimi-K3", "Kimi K3", 1000000], ["moonshotai/Kimi-K2.7-Code", "Kimi K2.7 Code", 256000], ["moonshotai/Kimi-K2.7-Code-Highspeed", "Kimi K2.7 Code HighSpeed", 262000], ["moonshotai/Kimi-K2.6", "Kimi K2.6", 256000], ["moonshotai/Kimi-K2.5", "Kimi K2.5", 256000],
  ["z-ai/glm-5.3-flash", "GLM-5.3 Flash", 1048576], ["zai-org/GLM-5.3", "GLM-5.3", 1000000], ["zai-org/GLM-5.2", "GLM-5.2", 1000000], ["zai-org/GLM-5.2-Fast", "GLM-5.2 Fast", 1000000], ["zai-org/GLM-5.1", "GLM-5.1", 200000], ["zai-org/GLM-5", "GLM-5", 200000],
  ["MiniMaxAI/MiniMax-M3", "MiniMax M3", 1000000], ["MiniMaxAI/MiniMax-M2.7", "MiniMax M2.7", 200000], ["minimax/minimax-m3-free", "MiniMax M3", 1000000], ["minimax/minimax-m2.7-free", "MiniMax M2.7", 197000], ["MiniMaxAI/MiniMax-M2.5", "MiniMax M2.5", 200000],
  ["xiaomi/mimo-v2.5-pro", "MiMo V2.5 Pro", 1000000], ["xiaomi/mimo-v2.5", "MiMo V2.5", 1000000],
  ["Qwen/Qwen3.8-Max", "Qwen 3.8 Max", 1000000], ["Qwen/Qwen3.8-27B", "Qwen 3.8 27B", 262144], ["Qwen/Qwen3.8-Flash", "Qwen 3.8 Flash", 1000000], ["Qwen/Qwen3.7-Max", "Qwen 3.7 Max", 1000000], ["Qwen/Qwen3.7-Plus", "Qwen 3.7 Plus", 1000000], ["Qwen/Qwen3.7-Flash", "Qwen 3.7 Flash", 1000000], ["Qwen/Qwen3.6-Max-Preview", "Qwen 3.6 Max Preview", 200000], ["Qwen/Qwen3.6-Plus", "Qwen 3.6 Plus", 200000],
  ["stepfun/Step-3.7-Flash", "Step 3.7 Flash", 256000], ["stepfun/Step-3.5-Flash", "Step 3.5 Flash", 1000000], ["tencent/hy3-paid", "Tencent Hy3", 262144], ["tencent/hy4-preview", "Tencent Hy4 Preview", 1048576],
  ["google/gemini-3.7-flash", "Gemini 3.7 Flash", 1048576], ["google/gemini-3.6-flash", "Gemini 3.6 Flash", 1000000], ["google/gemini-3.5-flash", "Gemini 3.5 Flash", 1000000], ["google/gemini-3.5-flash-lite", "Gemini 3.5 Flash Lite", 1000000], ["google/gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite", 1000000], ["sakana/fugu-ultra", "Fugu Ultra", 1000000], ["nvidia/nemotron-3-ultra-550b-a55b", "Nemotron 3 Ultra", 1000000], ["thinkingmachines/inkling", "Inkling", 256000], ["thinkingmachines/inkling-small", "Inkling Small", 1000000], ["poolside/laguna-s-2.1-free", "Laguna S 2.1", 256000], ["meta/muse-spark-1.1", "Muse Spark 1.1", 1048576], ["meta/muse-spark-1.2", "Muse Spark 1.2", 1048576], ["meta/muse-spark-1.2-contributor", "Muse Spark 1.2 Contributor", 1048576], ["xai/grok-4.5", "Grok 4.5", 500000], ["xai/grok-4.6", "Grok 4.6", 500000],
];

const vision = (id: string) => /Qwen|Kimi|gemini|gpt-|deepseek-v4-flash-vision|MiniMax-M3|mimo-v2\.5$|muse|grok|fugu|inkling/i.test(id);
const thinking = (id: string) => !/claude|MiniMax|gemini|fugu|nemotron|laguna/i.test(id);
const efforts = (id: string): ReasoningEffort[] | undefined => {
  if (!thinking(id)) return undefined;
  if (/deepseek.*pro|Kimi-K3|glm-5(?:\\.1|\\.2)?$/i.test(id)) return ["high", "max"];
  if (/deepseek|Kimi|Qwen|mimo|gpt-|grok|muse/i.test(id)) return ["low", "medium", "high"];
  return undefined;
};
const staticInfo = new Map(OFFICIAL_MODELS.map(([id, name, contextWindow]) => [id, { id, name, displayName: name, contextWindow, maxOutput: /claude|Qwen|Kimi|gemini/i.test(id) ? 65536 : 131072, supportsTools: true, supportsVision: vision(id), apiFormat: id.startsWith("claude-") ? "anthropic" as const : "openai" as const, fixedTemperature: /Qwen/i.test(id) ? 0.55 : /Kimi/i.test(id) ? 1 : undefined, fixedTopP: /Qwen/i.test(id) ? 1 : /Kimi-K2.5/i.test(id) ? 0.95 : undefined, supportsThinking: thinking(id), supportedReasoningEfforts: efforts(id), isUserSelectable: true }] satisfies [string, CommandCodeModelInfo]));

export const FALLBACK_MODELS: CommandCodeModelInfo[] = [...staticInfo.values()];

export function inferModelInfo(model: CommandCodeApiModel | string): CommandCodeModelInfo {
  const apiModel: CommandCodeApiModel = typeof model === "string" ? { id: model } : model;
  if (!apiModel.id) throw new Error("model id must be non-empty");
  const known = staticInfo.get(apiModel.id);
  if (!known) return { id: apiModel.id, name: apiModel.name || apiModel.id, displayName: apiModel.name || apiModel.id, contextWindow: apiModel.context_length && apiModel.context_length > 0 ? apiModel.context_length : 262144, maxOutput: 65536, supportsTools: false, supportsVision: false, supportsThinking: false, isUserSelectable: false };
  return { ...known, name: apiModel.name || known.name, displayName: apiModel.name || known.displayName, contextWindow: apiModel.context_length && apiModel.context_length > 0 ? apiModel.context_length : known.contextWindow };
}
