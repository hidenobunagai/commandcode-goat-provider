#!/usr/bin/env bun
/**
 * Live-probe how a model reacts to each reasoning_effort rung on Command Code's gateway.
 *
 *   bun scripts/probe-efforts.ts <model-id> [<model-id> ...]
 *
 * Supplementary evidence only (see docs/model-sync.md "Thinking efforts"): the gateway
 * accepts the same enum (off|low|medium|high|xhigh|max) for every model, so HTTP 200 proves
 * nothing about the ladder. What it does establish: whether the model reasons by default, and
 * whether thinking can be turned off (the gateway rejects `off` per model). Reasoning-token
 * counts per rung are printed but are too noisy from one sample to pick rungs from; take the
 * ladder from vendor docs.
 *
 * claude-* ids use /provider/v1/messages (budget-based thinking) and are skipped.
 * Key: COMMANDCODE_API_KEY, else ~/.dsh/.credentials.yaml. Each run spends a few requests per model.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

const RUNGS = ["off", "low", "medium", "high", "xhigh", "max"] as const;
const URL = "https://api.commandcode.ai/provider/v1/chat/completions";
const PROMPT = "What is the sum of the digits of 2^50? Reply with the number only.";

function apiKey(): string {
  if (process.env.COMMANDCODE_API_KEY) return process.env.COMMANDCODE_API_KEY;
  const f = `${homedir()}/.dsh/.credentials.yaml`;
  const m = existsSync(f) && readFileSync(f, "utf8").match(/COMMANDCODE_API_KEY:\s*"?([^"\s#]+)/);
  if (!m) throw new Error("COMMANDCODE_API_KEY not found (env or ~/.dsh/.credentials.yaml)");
  return m[1];
}

type Result = { rung: string; status: number; reasoning?: number; error?: string };

async function call(key: string, model: string, rung?: string): Promise<Result> {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: "user", content: PROMPT }],
    max_tokens: 8192,
  };
  if (rung) body.reasoning_effort = rung;
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  }).catch((e) => ({ status: 0, text: async () => String(e) }) as Response);
  const text = await res.text();
  if (res.status !== 200)
    return { rung: rung ?? "(omitted)", status: res.status, error: text.slice(0, 300) };
  const j = JSON.parse(text);
  const d = j.usage?.completion_tokens_details?.reasoning_tokens;
  const r = j.choices?.[0]?.message?.reasoning_content ?? j.choices?.[0]?.message?.reasoning;
  // Some vendors omit reasoning_tokens; fall back to a rough count of the returned reasoning text.
  return {
    rung: rung ?? "(omitted)",
    status: 200,
    reasoning: d ?? (r ? Math.round(r.length / 4) : 0),
  };
}

async function probe(key: string, model: string) {
  const results: Result[] = [];
  for (const rung of [undefined, ...RUNGS]) {
    const r = await call(key, model, rung); // sequential: gentle on quota/rate limits
    results.push(r);
    console.log(
      `  ${r.rung.padEnd(10)} ${r.status} ${r.status === 200 ? `reasoning=${r.reasoning}` : (r.error ?? "").replace(/\s+/g, " ").slice(0, 160)}`,
    );
  }
  const omitted = results[0];
  const off = results.find((r) => r.rung === "off");
  const enumMsg = results
    .map((r) => r.error?.match(/expected one of ([^}\]]+)/i)?.[1])
    .find(Boolean);
  // Only facts the probe can establish. Token counts per rung are printed above for the
  // reader, but one sample is too noisy to derive a ladder from (2026-10-02: mimo-v2.6-pro
  // went low=293, medium=534, high=332, xhigh=2645, max=508).
  const verdict = [
    omitted.status !== 200
      ? `default request failed (${omitted.status})`
      : (omitted.reasoning ?? 0) > 0
        ? "thinks by default (reasoning model)"
        : "no reasoning tokens by default",
    off?.status === 200 ? "thinking can be turned off" : "thinking cannot be turned off",
  ].join("; ");
  return { model, results, gatewayEnum: enumMsg, verdict };
}

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error("usage: bun scripts/probe-efforts.ts <model-id> [...]");
  process.exit(2);
}
const key = apiKey();
for (const id of ids) {
  if (id.startsWith("claude-")) {
    console.log(`\n## ${id}\n  skip (anthropic protocol — curate thinking from vendor docs)`);
    continue;
  }
  console.log(`\n## ${id}`);
  const p = await probe(key, id);
  if (p.gatewayEnum) console.log(`  gateway enum: ${p.gatewayEnum}`);
  console.log(`  VERDICT: ${p.verdict}`);
}
