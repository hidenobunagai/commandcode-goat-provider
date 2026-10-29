// auto-router.ts — GOAT Auto: per-turn model + reasoning-effort selection from a user pool.
//
// Pure module: no vscode runtime dependency. The provider adapts VS Code messages into
// RouterMessage values and injects the judge call, so everything here is unit-testable.
import { createHash } from "node:crypto";
import type { CommandCodeModelInfo } from "./types";

export const AUTO_MODEL_ID = "commandcode-goat/auto";

/** Context window assumed for the GOAT Auto picker entry while the pool is empty. */
export const AUTO_DEFAULT_CONTEXT_WINDOW = 200000;

/** Effort levels the judge may return. Per-model clamping happens in the provider. */
export const AUTO_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AutoEffort = (typeof AUTO_EFFORT_LEVELS)[number];

export const AUTO_JUDGE_TIMEOUT_MS = 4000;
const DECISION_CACHE_MAX_ENTRIES = 50;
const JUDGE_TASK_MAX_CHARS = 2000;
const JUDGE_RECENT_TURNS = 4;
const JUDGE_RECENT_TURN_MAX_CHARS = 300;

export interface RouterMessage {
  role: "user" | "assistant" | "other";
  /** Concatenated top-level text parts (tool calls/results excluded). */
  text: string;
  hasImage: boolean;
}

export interface AutoDecision {
  modelId: string;
  effort: AutoEffort | undefined;
  via: "judge" | "heuristic" | "cache";
  /** Extra context for the decision log (e.g. vision fail-open, judge failure reason). */
  note?: string;
}

export interface JudgeRequest {
  judgeModel: CommandCodeModelInfo;
  system: string;
  user: string;
  signal: AbortSignal;
}

/** Performs one chat completion and returns the raw reply text. */
export type JudgeFn = (request: JudgeRequest) => Promise<string>;

export interface RouteInput {
  messages: readonly RouterMessage[];
  pool: readonly CommandCodeModelInfo[];
  /** Model used as judge, or undefined to skip judging (heuristic only). */
  judgeModel: CommandCodeModelInfo | undefined;
  signal?: AbortSignal;
}

/** Pool ids → dispatchable model infos (unknown, non-selectable, or format-less ids dropped). */
export function resolvePool(
  poolIds: readonly string[],
  modelMap: ReadonlyMap<string, CommandCodeModelInfo>,
): CommandCodeModelInfo[] {
  const pool: CommandCodeModelInfo[] = [];
  const seen = new Set<string>();
  for (const id of poolIds) {
    if (typeof id !== "string" || id === AUTO_MODEL_ID || seen.has(id)) continue;
    const info = modelMap.get(id);
    if (!info || info.isUserSelectable === false || !info.apiFormat) continue;
    seen.add(id);
    pool.push(info);
  }
  return pool;
}

/**
 * Judge choice: an explicitly configured openai-format model wins; otherwise the first
 * openai-format pool model whose id contains "flash", then the first openai-format pool
 * model. No openai-format candidate → undefined (skip judging).
 */
export function selectJudgeModel(
  judgeModelId: string | undefined,
  pool: readonly CommandCodeModelInfo[],
  modelMap: ReadonlyMap<string, CommandCodeModelInfo>,
): CommandCodeModelInfo | undefined {
  const configured = judgeModelId?.trim() ? modelMap.get(judgeModelId.trim()) : undefined;
  if (configured?.apiFormat === "openai" && configured.isUserSelectable !== false) {
    return configured;
  }
  const openai = pool.filter((m) => m.apiFormat === "openai");
  return openai.find((m) => m.id.toLowerCase().includes("flash")) ?? openai[0];
}

function userTexts(messages: readonly RouterMessage[]): string[] {
  // Tool results arrive as user-role messages without top-level text; skip them so an
  // agent-mode tool round keeps the same first/last user text.
  return messages.filter((m) => m.role === "user" && m.text.trim() !== "").map((m) => m.text);
}

/** Turn key: hash of (first user text, last user text). Shared by all requests of one turn. */
export function computeTurnKey(messages: readonly RouterMessage[]): string {
  const texts = userTexts(messages);
  const first = texts[0] ?? "";
  const last = texts[texts.length - 1] ?? "";
  return createHash("sha256").update(first).update("\u0000").update(last).digest("hex");
}

/** Images present → vision-capable pool models only; if none, keep the full pool (fail open). */
export function filterPoolForVision(
  pool: readonly CommandCodeModelInfo[],
  messages: readonly RouterMessage[],
): { pool: readonly CommandCodeModelInfo[]; note?: string } {
  if (!messages.some((m) => m.hasImage)) return { pool };
  const vision = pool.filter((m) => m.supportsVision);
  if (vision.length === 0) {
    return { pool, note: "images present but no vision model in pool; using full pool" };
  }
  return { pool: vision };
}

/** Largest contextWindow wins; ties broken by id for determinism. */
function strongestModel(pool: readonly CommandCodeModelInfo[]): CommandCodeModelInfo {
  return [...pool].sort((a, b) => b.contextWindow - a.contextWindow || a.id.localeCompare(b.id))[0];
}

/** "flash" first; lite/mini/haiku only as whole id segments (so "gemini" is not "mini"). */
function fastestModel(pool: readonly CommandCodeModelInfo[]): CommandCodeModelInfo {
  return (
    pool.find((m) => /flash/i.test(m.id)) ??
    pool.find((m) => /(^|[-_/.])(lite|mini|haiku)($|[-_/.])/i.test(m.id)) ??
    pool[0]
  );
}

const COMPLEX_TASK_PATTERN =
  /architect|migrat|root[\s-]?cause|debug|設計|移行|根本原因|デバッグ|障害/i;
const LONG_PROMPT_CHARS = 500;
const SIMPLE_PROMPT_MAX_CHARS = 120;

/**
 * Deterministic fallback when the judge is unavailable or returns something unusable.
 * Rules, applied to the last user prompt in order:
 *   1. Complex: longer than 500 chars, or mentions architecture/migration/root cause/debugging
 *      (English or 設計・移行・根本原因・デバッグ・障害) → strongest pool model (largest context
 *      window). Effort xhigh when the prompt is both long and keyword-matched, else high.
 *   2. Simple: a single line of at most 120 chars (lookup or command-like) → low effort on a
 *      fast pool model (id contains "flash", else a lite/mini/haiku id segment, else the first
 *      pool entry).
 *   3. Otherwise → medium effort on the first pool entry.
 */
export function heuristicDecision(
  messages: readonly RouterMessage[],
  pool: readonly CommandCodeModelInfo[],
): AutoDecision {
  const texts = userTexts(messages);
  const prompt = (texts[texts.length - 1] ?? "").trim();
  const isLong = prompt.length > LONG_PROMPT_CHARS;
  const hasComplexKeyword = COMPLEX_TASK_PATTERN.test(prompt);
  if (isLong || hasComplexKeyword) {
    return {
      modelId: strongestModel(pool).id,
      effort: isLong && hasComplexKeyword ? "xhigh" : "high",
      via: "heuristic",
    };
  }
  if (prompt.length <= SIMPLE_PROMPT_MAX_CHARS && !prompt.includes("\n")) {
    return { modelId: fastestModel(pool).id, effort: "low", via: "heuristic" };
  }
  return { modelId: pool[0].id, effort: "medium", via: "heuristic" };
}

const JUDGE_SYSTEM_PROMPT =
  "You are a model router. Pick the single best model from the pool and a reasoning effort " +
  "for the user's task: cheap/fast models and low effort for simple lookups or edits, strong " +
  "models and high effort for complex design, debugging, or multi-step work. Reply with ONLY " +
  'a JSON object: {"model": "<pool id>", "effort": "<low|medium|high|xhigh|max>"}';

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function buildJudgePrompt(
  messages: readonly RouterMessage[],
  pool: readonly CommandCodeModelInfo[],
): { system: string; user: string } {
  const table = pool
    .map((m) => {
      const efforts = m.supportsThinking
        ? (m.supportedReasoningEfforts?.join(",") ?? "default")
        : "none";
      return `- ${m.id} | ${m.name} | context ${m.contextWindow} | vision ${m.supportsVision ? "yes" : "no"} | tools ${m.supportsTools ? "yes" : "no"} | efforts ${efforts}`;
    })
    .join("\n");

  const conversational = messages.filter((m) => m.role !== "other" && m.text.trim() !== "");
  let lastUserIndex = -1;
  for (let i = conversational.length - 1; i >= 0; i--) {
    if (conversational[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  const task = lastUserIndex >= 0 ? conversational[lastUserIndex].text : "";
  const recent = conversational
    .slice(Math.max(0, lastUserIndex - JUDGE_RECENT_TURNS), Math.max(0, lastUserIndex))
    .map((m) => `${m.role}: ${truncate(m.text.trim(), JUDGE_RECENT_TURN_MAX_CHARS)}`)
    .join("\n");

  const user = [
    `Pool:\n${table}`,
    recent ? `Recent turns:\n${recent}` : "",
    `Task:\n${truncate(task.trim(), JUDGE_TASK_MAX_CHARS)}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { system: JUDGE_SYSTEM_PROMPT, user };
}

/** Extract and validate the judge's JSON reply. Undefined means "use the heuristic". */
export function parseJudgeReply(
  reply: string,
  pool: readonly CommandCodeModelInfo[],
): { modelId: string; effort: AutoEffort } | undefined {
  const match = /\{[^{}]*\}/.exec(reply);
  if (!match) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const { model, effort } = parsed as { model?: unknown; effort?: unknown };
  if (typeof model !== "string" || !pool.some((m) => m.id === model)) return undefined;
  if (typeof effort !== "string" || !(AUTO_EFFORT_LEVELS as readonly string[]).includes(effort)) {
    return undefined;
  }
  return { modelId: model, effort: effort as AutoEffort };
}

/**
 * If the input does not fit the chosen model, escalate to the pool model with the largest
 * input limit. "Largest that fits" and "none fits" both resolve to that model; when nothing
 * fits, the caller's existing token-limit error fires against it.
 */
export function escalateForInput(
  chosen: CommandCodeModelInfo,
  pool: readonly CommandCodeModelInfo[],
  inputTokens: number,
  inputLimit: (model: CommandCodeModelInfo) => number,
): CommandCodeModelInfo {
  if (inputTokens <= inputLimit(chosen) || pool.length === 0) return chosen;
  return [...pool].sort((a, b) => inputLimit(b) - inputLimit(a) || a.id.localeCompare(b.id))[0];
}

function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  outer?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const signal = outer ? AbortSignal.any([outer, controller.signal]) : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`judge timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([run(signal), timeout]).finally(() => clearTimeout(timer));
}

export class AutoRouter {
  private readonly cache = new Map<string, AutoDecision>();

  constructor(
    private readonly judge: JudgeFn,
    private readonly timeoutMs: number = AUTO_JUDGE_TIMEOUT_MS,
  ) {}

  /** Never throws: any failure degrades to the heuristic decision. Pool must be non-empty. */
  async route(input: RouteInput): Promise<AutoDecision> {
    const { messages, judgeModel, signal } = input;
    const { pool, note: visionNote } = filterPoolForVision(input.pool, messages);
    const notes = visionNote ? [visionNote] : [];
    const withNotes = (decision: AutoDecision): AutoDecision =>
      notes.length > 0 ? { ...decision, note: notes.join("; ") } : decision;

    let key: string | undefined;
    try {
      key = computeTurnKey(messages);
      const cached = this.cache.get(key);
      if (cached && pool.some((m) => m.id === cached.modelId)) {
        return withNotes({ modelId: cached.modelId, effort: cached.effort, via: "cache" });
      }

      let decision: AutoDecision | undefined;
      if (judgeModel) {
        try {
          const prompt = buildJudgePrompt(messages, pool);
          const reply = await withTimeout(
            (judgeSignal) =>
              this.judge({
                judgeModel,
                system: prompt.system,
                user: prompt.user,
                signal: judgeSignal,
              }),
            this.timeoutMs,
            signal,
          );
          const parsed = parseJudgeReply(reply, pool);
          if (parsed) {
            decision = { ...parsed, via: "judge" };
          } else {
            notes.push(`judge reply unusable: ${truncate(reply.trim(), 200)}`);
          }
        } catch (error) {
          notes.push(`judge failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else {
        notes.push("no openai-format judge model available");
      }

      decision ??= heuristicDecision(messages, pool);
      this.remember(key, decision);
      return withNotes(decision);
    } catch (error) {
      notes.push(`routing error: ${error instanceof Error ? error.message : String(error)}`);
      return withNotes(heuristicDecision(messages, pool));
    }
  }

  private remember(key: string, decision: AutoDecision): void {
    this.cache.delete(key);
    this.cache.set(key, decision);
    while (this.cache.size > DECISION_CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
