// auto-router.ts — GOAT Auto: per-turn model + reasoning-effort selection from a user pool.
//
// Pure module: no vscode runtime dependency. The provider adapts VS Code messages into
// RouterMessage values and injects the Jev call, so everything here is unit-testable.
// Judgment semantics (effort question, state shape, follow-up floor, timeout) follow DSH's
// Jev router (dsh-jev lib/router.js).
import { createHash } from "node:crypto";
import type { CommandCodeModelInfo } from "./types";

export const AUTO_MODEL_ID = "commandcode-goat/auto";

/** Context window advertised by the GOAT Auto catalog entry. */
export const AUTO_DEFAULT_CONTEXT_WINDOW = 200000;

/** Effort levels Jev may return, lowest first. Per-model clamping happens in the provider. */
export const AUTO_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AutoEffort = (typeof AUTO_EFFORT_LEVELS)[number];

export const JEV_MODEL = "typesafe/jev-1.14.0";
/** Jev budget per judged turn, as in DSH. */
export const AUTO_JEV_TIMEOUT_MS = 3500;
const DECISION_CACHE_MAX_ENTRIES = 50;
const PROMPT_MAX_CHARS = 8000;
const HISTORY_TURNS = 6;
const HISTORY_TURN_MAX_CHARS = 600;
/** Short replies ("ok, do it") inherit the effort of the task they continue. */
export const FOLLOW_UP_MAX_CHARS = 80;
export const FIRST_TURN_PREVIOUS_EFFORT = "none (first turn)";

/** The Jev effort question, verbatim from DSH's EFFORT_QUESTION. */
export const EFFORT_QUESTION = {
  type: "choice",
  instructions:
    "Rate the reasoning effort needed for the assistant's NEXT response to `prompt`. " +
    "`prompt` may be a short follow-up; read `recentConversation` to see what it refers to, " +
    "and use `previousEffort` (the level chosen for the previous user turn) as a reference point.",
  criteria: {
    low: "Simple status checks, reading/grepping logs, single shell commands, quick lookups, trivial answers, small talk",
    medium: "Routine single-file edits, straightforward configs, clear instructions, minor updates",
    high: "Multi-component config changes (systemd/launchd/network), new feature implementations, nontrivial debugging",
    xhigh:
      "Complex architectural design, deep root-cause investigation, high-risk migrations, heavy multi-step planning",
    max: "Hardest problems: a bug or incident that earlier attempts failed to fix, security- or data-loss-critical changes, novel algorithms, or the user explicitly asks for the deepest, most careful thinking",
  },
} as const;

const MODEL_QUESTION_INSTRUCTIONS =
  "Choose the single best model from the criteria keys to handle `prompt`. Harder, high-risk, " +
  "or ambiguous tasks need the strongest model; simple or routine tasks should use the fast model.";

export interface RouterMessage {
  role: "user" | "assistant" | "other";
  /** Concatenated top-level text parts (tool calls/results excluded). */
  text: string;
  hasImage: boolean;
}

export type FieldSource = "jev" | "heuristic";

export interface AutoDecision {
  modelId: string;
  effort: AutoEffort | undefined;
  /** "jev" when Jev supplied the model, the effort, or both; see modelVia/effortVia. */
  via: "jev" | "heuristic" | "cache";
  /** Per-field sources of a fresh (non-cache) decision. */
  modelVia?: FieldSource;
  effortVia?: FieldSource;
  /** Extra context for the decision log (e.g. vision fail-open, Jev failure reason). */
  note?: string;
}

export interface JevState {
  prompt: string;
  recentConversation: { role: "user" | "assistant"; text: string }[];
  previousEffort: string;
}

export interface JevRequestBody {
  model: string;
  state: JevState;
  questions: Record<string, unknown>;
}

/** Performs one System One call and returns the parsed JSON response body. */
export type JevFn = (body: JevRequestBody, signal: AbortSignal) => Promise<unknown>;

export interface RouteInput {
  messages: readonly RouterMessage[];
  pool: readonly CommandCodeModelInfo[];
  signal?: AbortSignal;
}

/** Effort chosen for the previous judged user turn (feeds previousEffort and the floor). */
let previousEffort: AutoEffort | undefined;

/** Forget the previous turn's effort (tests). */
export function resetPreviousEffort(): void {
  previousEffort = undefined;
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
 * Deterministic fallback when Jev is unavailable or returns something unusable.
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

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Jev state with DSH semantics: the last user prompt (cut to 8000 chars), the last six
 * user/assistant text turns before it (each cut to 600 chars), and the previous turn's effort.
 */
export function buildJevState(
  messages: readonly RouterMessage[],
  previous: AutoEffort | undefined,
): JevState {
  const conversational = messages.filter(
    (m): m is RouterMessage & { role: "user" | "assistant" } =>
      m.role !== "other" && m.text.trim() !== "",
  );
  let lastUserIndex = -1;
  for (let i = conversational.length - 1; i >= 0; i--) {
    if (conversational[i].role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  const prompt = lastUserIndex >= 0 ? conversational[lastUserIndex].text : "";
  const recentConversation = conversational
    .slice(0, Math.max(0, lastUserIndex))
    .slice(-HISTORY_TURNS)
    .map((m) => ({ role: m.role, text: truncate(m.text.trim(), HISTORY_TURN_MAX_CHARS) }));
  return {
    prompt: prompt.slice(0, PROMPT_MAX_CHARS),
    recentConversation,
    previousEffort: previous ?? FIRST_TURN_PREVIOUS_EFFORT,
  };
}

/** Factual capability summary of a pool model for the Jev model question. */
export function describeModel(m: CommandCodeModelInfo): string {
  const efforts = m.supportsThinking
    ? m.supportedReasoningEfforts?.length
      ? m.supportedReasoningEfforts.join(", ")
      : "default only"
    : "none";
  return [
    m.displayName,
    `context window ${m.contextWindow} tokens`,
    `vision ${m.supportsVision ? "yes" : "no"}`,
    `tool calling ${m.supportsTools ? "yes" : "no"}`,
    `reasoning efforts: ${efforts}`,
  ].join("; ");
}

export function buildJevRequest(
  state: JevState,
  pool: readonly CommandCodeModelInfo[],
): JevRequestBody {
  return {
    model: JEV_MODEL,
    state,
    questions: {
      effort: EFFORT_QUESTION,
      model: {
        type: "choice",
        instructions: MODEL_QUESTION_INSTRUCTIONS,
        criteria: Object.fromEntries(pool.map((m) => [m.id, describeModel(m)])),
      },
    },
  };
}

/** Jev's choices, each validated independently; an invalid or missing field is undefined. */
export function parseJevAnswers(
  body: unknown,
  pool: readonly CommandCodeModelInfo[],
): { modelId?: string; effort?: AutoEffort } {
  const answers =
    body && typeof body === "object" ? (body as { answers?: unknown }).answers : undefined;
  if (!answers || typeof answers !== "object") {
    throw new Error("Jev response is missing answers");
  }
  const choiceOf = (key: string): unknown => {
    const answer = (answers as Record<string, unknown>)[key];
    return answer && typeof answer === "object"
      ? (answer as { choice?: unknown }).choice
      : undefined;
  };
  const model = choiceOf("model");
  const effort = choiceOf("effort");
  return {
    modelId: typeof model === "string" && pool.some((m) => m.id === model) ? model : undefined,
    effort:
      typeof effort === "string" && (AUTO_EFFORT_LEVELS as readonly string[]).includes(effort)
        ? (effort as AutoEffort)
        : undefined,
  };
}

/** A prompt of at most 80 chars never drops below the previous turn's level. */
export function applyFollowUpFloor(
  prompt: string,
  judged: AutoEffort,
  previous: AutoEffort | undefined,
): AutoEffort {
  if (prompt.trim().length > FOLLOW_UP_MAX_CHARS || previous === undefined) return judged;
  return AUTO_EFFORT_LEVELS.indexOf(previous) > AUTO_EFFORT_LEVELS.indexOf(judged)
    ? previous
    : judged;
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
      reject(new Error(`Jev timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  return Promise.race([run(signal), timeout]).finally(() => clearTimeout(timer));
}

export class AutoRouter {
  private readonly cache = new Map<string, AutoDecision>();

  constructor(
    private readonly jev: JevFn,
    private readonly timeoutMs: number = AUTO_JEV_TIMEOUT_MS,
  ) {}

  /** Never throws: any failure degrades to the heuristic decision. Pool must be non-empty. */
  async route(input: RouteInput): Promise<AutoDecision> {
    const { messages, signal } = input;
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

      const previous = previousEffort;
      const state = buildJevState(messages, previous);
      let answers: { modelId?: string; effort?: AutoEffort } = {};
      try {
        const body = await withTimeout(
          (jevSignal) => this.jev(buildJevRequest(state, pool), jevSignal),
          this.timeoutMs,
          signal,
        );
        answers = parseJevAnswers(body, pool);
        if (answers.modelId === undefined) notes.push("Jev model answer missing or not in pool");
        if (answers.effort === undefined) notes.push("Jev effort answer missing or invalid");
      } catch (error) {
        notes.push(`Jev failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      const heuristic = heuristicDecision(messages, pool);
      const modelVia: FieldSource = answers.modelId !== undefined ? "jev" : "heuristic";
      const effortVia: FieldSource = answers.effort !== undefined ? "jev" : "heuristic";
      const judged = answers.effort ?? heuristic.effort ?? "medium";
      const effort = applyFollowUpFloor(state.prompt, judged, previous);
      if (effort !== judged) notes.push(`follow-up floor raised effort ${judged} -> ${effort}`);
      previousEffort = effort;

      const decision: AutoDecision = {
        modelId: answers.modelId ?? heuristic.modelId,
        effort,
        via: modelVia === "jev" || effortVia === "jev" ? "jev" : "heuristic",
        modelVia,
        effortVia,
      };
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
