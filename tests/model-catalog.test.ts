import { inferModelInfo, REASONING_EFFORT_ORDER, FALLBACK_MODELS } from "../src/types";

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

test("includes DeepSeek V4 Flash Fast as a selectable OpenAI model with reasoning", () => {
  const info = inferModelInfo({
    id: "deepseek/deepseek-v4-flash-fast",
    name: "DeepSeek V4 Flash Fast",
    context_length: 1_000_000,
  });

  expect(info.id).toBe("deepseek/deepseek-v4-flash-fast");
  expect(info.displayName).toBe("DeepSeek V4 Flash Fast");
  expect(info.apiFormat).toBe("openai");
  expect(info.contextWindow).toBe(1_000_000);
  expect(info.supportsThinking).toBe(true);
  expect(info.supportedReasoningEfforts).toEqual(["high", "max"]);
  expect(info.supportsVision).toBe(false);
  expect(info.isUserSelectable).toBe(true);
});

test("includes DeepSeek V4.1 Flash as a selectable OpenAI model with reasoning and vision", () => {
  const info = inferModelInfo({
    id: "deepseek/deepseek-v4.1-flash",
    name: "DeepSeek V4.1 Flash",
    context_length: 1_000_000,
  });

  expect(info.id).toBe("deepseek/deepseek-v4.1-flash");
  expect(info.displayName).toBe("DeepSeek V4.1 Flash");
  expect(info.apiFormat).toBe("openai");
  expect(info.contextWindow).toBe(1_000_000);
  expect(info.supportsVision).toBe(true);
  expect(info.supportsThinking).toBe(true);
  expect(info.supportedReasoningEfforts).toEqual(["low", "high", "max"]);
  expect(info.isUserSelectable).toBe(true);
});

test("includes the 2026-10-02 new models with curated capabilities", () => {
  // Claude Sonnet 5.5: anthropic protocol, vision on, full five-rung ladder
  // (pi-ai anthropic explicit low..max; GOAT tier on commandcode.ai).
  const sonnet = inferModelInfo({
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    context_length: 1_000_000,
  });
  expect(sonnet.apiFormat).toBe("anthropic");
  expect(sonnet.supportsVision).toBe(true);
  expect(sonnet.supportedReasoningEfforts).toEqual(["low", "medium", "high", "xhigh", "max"]);

  // GPT-6.1 Sol: five-rung ladder, probed 2026-10-02 (thinks by default,
  // off rejected 400).
  const sol = inferModelInfo({
    id: "gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    context_length: 1_050_000,
  });
  expect(sol.apiFormat).toBe("openai");
  expect(sol.supportsVision).toBe(true);
  expect(sol.supportedReasoningEfforts).toEqual(["low", "medium", "high", "xhigh", "max"]);

  // DeepSeek V4.1 Flash Fast: vendor low/high/max ladder, vision on.
  const fast = inferModelInfo({
    id: "deepseek/deepseek-v4.1-flash-fast",
    name: "DeepSeek V4.1 Flash Fast",
    context_length: 1_000_000,
  });
  expect(fast.supportsVision).toBe(true);
  expect(fast.supportedReasoningEfforts).toEqual(["low", "high", "max"]);

  // Ling 3.1 Flash (free): text-only, no effort picker — no Reasons badge
  // on commandcode.ai, so no invented ladder.
  const ling = inferModelInfo({
    id: "inclusionai/ling-3.1-flash:free",
    name: "Ling 3.1 Flash",
    context_length: 262_144,
  });
  expect(ling.apiFormat).toBe("openai");
  expect(ling.supportsVision).toBe(false);
  expect(ling.supportsThinking).toBe(false);
  expect(ling.isUserSelectable).toBe(true);
});

test("applies the researched 2026-10-02 effort ladders", () => {
  // DeepSeek vendor docs: low/high/max (low aliases the default high on V4).
  const v4 = inferModelInfo({
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash (latest)",
    context_length: 1_000_000,
  });
  expect(v4.supportedReasoningEfforts).toEqual(["high", "max"]);

  // Kimi K3: vendor low/high/max; Kimi K2.7-Code: low/high/xhigh
  // (medium rejected 400 by the Moonshot route, max rejected on the base id).
  const k3 = inferModelInfo({ id: "moonshotai/Kimi-K3", name: "K", context_length: 1_000_000 });
  expect(k3.supportedReasoningEfforts).toEqual(["low", "high", "max"]);
  const k27 = inferModelInfo({
    id: "moonshotai/Kimi-K2.7-Code",
    name: "K",
    context_length: 256_000,
  });
  expect(k27.supportedReasoningEfforts).toEqual(["low", "high", "xhigh"]);

  // Qwen3.8 family: high rung restored (low,medium,high,xhigh).
  const qwen = inferModelInfo({
    id: "Qwen/Qwen3.8-Max-0902",
    name: "Q",
    context_length: 1_000_000,
  });
  expect(qwen.supportedReasoningEfforts).toEqual(["low", "medium", "high", "xhigh"]);

  // Fugu Ultra gains max; GPT-5.4 Mini gains xhigh.
  const fugu = inferModelInfo({ id: "sakana/fugu-ultra", name: "F", context_length: 1_000_000 });
  expect(fugu.supportedReasoningEfforts).toEqual(["high", "xhigh", "max"]);
  const mini = inferModelInfo({ id: "gpt-5.4-mini", name: "G", context_length: 400_000 });
  expect(mini.supportedReasoningEfforts).toEqual(["low", "medium", "high", "xhigh"]);
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

test("orders reasoning efforts from least to most intensive", () => {
  expect(REASONING_EFFORT_ORDER).toEqual(["minimal", "low", "medium", "high", "xhigh", "max"]);
});

test("provides every official catalog model as a selectable fallback", () => {
  expect(FALLBACK_MODELS.length).toBe(85);
  expect(FALLBACK_MODELS.every((model) => model.isUserSelectable)).toBe(true);
});

test("offers the effort picker for Muse Spark with the probed gateway ladder", () => {
  // Probed 2026-09-23 on /provider/v1/chat/completions: listed rungs all 200
  // with differentiated reasoning_tokens; minimal/ultra/none rejected 400.
  // Contributor tier drops `max` (dev.meta.ai/docs/reasoning: standard-tier
  // muse-spark-1.3 only; probing shows contributor max == xhigh in effect).
  const withoutMax = ["meta/muse-spark-1.3-contributor", "meta/muse-spark-1.2-contributor"];
  for (const id of withoutMax) {
    const info = inferModelInfo({ id, name: id, context_length: 1_048_576 });
    expect(info.supportsThinking).toBe(true);
    expect(info.supportedReasoningEfforts).toEqual(["low", "medium", "high", "xhigh"]);
  }
  for (const id of ["meta/muse-spark-1.3", "meta/muse-spark-1.1"]) {
    const info = inferModelInfo({ id, name: id, context_length: 1_048_576 });
    expect(info.supportsThinking).toBe(true);
    expect(info.supportedReasoningEfforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
  }
});

test("offers the effort picker for Space Bunny Alpha with probed reasoning ladder", () => {
  // Probed 2026-09-25 on /provider/v1/chat/completions: low..max all 200,
  // unknown value rejected 400. Reasoning streamed in delta.reasoning.
  const info = inferModelInfo({
    id: "stealth/space-bunny-alpha",
    name: "Space Bunny Alpha",
    context_length: 1_000_000,
  });
  expect(info.supportsThinking).toBe(true);
  expect(info.supportedReasoningEfforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
});
