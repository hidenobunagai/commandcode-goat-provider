import {
  applyFollowUpFloor,
  AUTO_MODEL_ID,
  AutoRouter,
  buildJevRequest,
  buildJevState,
  computeTurnKey,
  EFFORT_QUESTION,
  escalateForInput,
  filterPoolForVision,
  heuristicDecision,
  type JevFn,
  type JevRequestBody,
  parseJevAnswers,
  resetPreviousEffort,
  resolvePool,
  type RouterMessage,
} from "../src/auto-router";
import type { CommandCodeModelInfo } from "../src/types";

function model(id: string, overrides: Partial<CommandCodeModelInfo> = {}): CommandCodeModelInfo {
  return {
    id,
    name: id,
    displayName: id,
    contextWindow: 200000,
    maxOutput: 65536,
    supportsTools: true,
    supportsVision: false,
    apiFormat: "openai",
    supportsThinking: true,
    supportedReasoningEfforts: ["low", "medium", "high"],
    isUserSelectable: true,
    ...overrides,
  };
}

const flash = model("vendor/fast-flash", { contextWindow: 262144 });
const pro = model("vendor/big-pro", { contextWindow: 1000000 });
const claude = model("claude-x", { apiFormat: "anthropic", supportsVision: true });
const pool = [pro, flash, claude];

function user(text: string, hasImage = false): RouterMessage {
  return { role: "user", text, hasImage };
}
function assistant(text: string): RouterMessage {
  return { role: "assistant", text, hasImage: false };
}

/** A Jev response body as the systemone endpoint returns it. */
function jevBody(answers: { model?: unknown; effort?: unknown }): unknown {
  const answer = (choice: unknown) => ({ type: "choice", choice, confidence: 0.9 });
  return {
    model: "typesafe/jev-1.14.0",
    answers: {
      ...(answers.model !== undefined ? { model: answer(answers.model) } : {}),
      ...(answers.effort !== undefined ? { effort: answer(answers.effort) } : {}),
    },
  };
}

function jevReturning(answers: { model?: unknown; effort?: unknown }): jest.Mock {
  return jest.fn(async () => jevBody(answers)) as jest.Mock;
}

beforeEach(() => resetPreviousEffort());

describe("resolvePool", () => {
  it("keeps known dispatchable models in order and drops the rest", () => {
    const modelMap = new Map<string, CommandCodeModelInfo>([
      [pro.id, pro],
      [flash.id, flash],
      ["hidden", model("hidden", { isUserSelectable: false })],
      ["formatless", model("formatless", { apiFormat: undefined })],
    ]);
    expect(
      resolvePool(
        [flash.id, "unknown", pro.id, "hidden", "formatless", flash.id, AUTO_MODEL_ID],
        modelMap,
      ).map((m) => m.id),
    ).toEqual([flash.id, pro.id]);
  });
});

describe("computeTurnKey", () => {
  it("ignores tool-result user messages without text", () => {
    const base = [user("fix the bug")];
    const withToolRound = [
      user("fix the bug"),
      assistant(""),
      { role: "user" as const, text: "", hasImage: false },
    ];
    expect(computeTurnKey(withToolRound)).toBe(computeTurnKey(base));
  });

  it("changes when the last user prompt changes", () => {
    const first = [user("hello"), assistant("hi"), user("one")];
    const second = [user("hello"), assistant("hi"), user("two")];
    expect(computeTurnKey(first)).not.toBe(computeTurnKey(second));
  });
});

describe("filterPoolForVision", () => {
  it("restricts to vision models when images are present", () => {
    expect(filterPoolForVision(pool, [user("look", true)]).pool.map((m) => m.id)).toEqual([
      claude.id,
    ]);
  });

  it("keeps the full pool when no model supports vision (fail open)", () => {
    const result = filterPoolForVision([pro, flash], [user("look", true)]);
    expect(result.pool.map((m) => m.id)).toEqual([pro.id, flash.id]);
    expect(result.note).toContain("no vision model");
  });

  it("leaves the pool alone without images", () => {
    expect(filterPoolForVision(pool, [user("text")]).pool).toBe(pool);
  });
});

describe("parseJevAnswers", () => {
  it("returns both valid choices", () => {
    expect(parseJevAnswers(jevBody({ model: pro.id, effort: "xhigh" }), pool)).toEqual({
      modelId: pro.id,
      effort: "xhigh",
    });
  });

  it("validates each field independently", () => {
    expect(parseJevAnswers(jevBody({ model: "other/model", effort: "high" }), pool)).toEqual({
      modelId: undefined,
      effort: "high",
    });
    expect(parseJevAnswers(jevBody({ model: pro.id, effort: "extreme" }), pool)).toEqual({
      modelId: pro.id,
      effort: undefined,
    });
    expect(parseJevAnswers(jevBody({ effort: 3 }), pool)).toEqual({
      modelId: undefined,
      effort: undefined,
    });
  });

  it.each([
    ["null", null],
    ["a string", "oops"],
    ["no answers", { model: "typesafe/jev-1.14.0" }],
    ["null answers", { answers: null }],
  ])("throws on a malformed body (%s)", (_label, body) => {
    expect(() => parseJevAnswers(body, pool)).toThrow("missing answers");
  });
});

describe("heuristicDecision", () => {
  it("routes short command-like prompts to a fast model with low effort", () => {
    expect(heuristicDecision([user("list files in src")], pool)).toEqual({
      modelId: flash.id,
      effort: "low",
      via: "heuristic",
    });
  });

  it("prefers flash, and does not mistake gemini for a mini model", () => {
    const argon = model("google/gemini-4-argon");
    const haiku = model("claude-haiku-5-5");
    const dsFlash = model("deepseek/deepseek-v4-flash");
    expect(heuristicDecision([user("list files")], [argon, haiku, dsFlash]).modelId).toBe(
      dsFlash.id,
    );
    const gptMini = model("gpt-5.4-mini");
    expect(heuristicDecision([user("list files")], [argon, gptMini]).modelId).toBe(gptMini.id);
  });

  it("routes complex keywords to the strongest model with high effort", () => {
    expect(heuristicDecision([user("find the root cause of this crash")], pool)).toMatchObject({
      modelId: pro.id,
      effort: "high",
    });
    expect(heuristicDecision([user("認証まわりの設計を見直したい")], pool)).toMatchObject({
      modelId: pro.id,
      effort: "high",
    });
  });

  it("uses xhigh for long prompts that also match complex keywords", () => {
    const prompt = `Plan the database migration.\n${"details ".repeat(80)}`;
    expect(heuristicDecision([user(prompt)], pool)).toMatchObject({
      modelId: pro.id,
      effort: "xhigh",
    });
  });

  it("defaults to the first pool entry with medium effort", () => {
    const prompt = "Write a function that parses the config file.\nKeep it small and add tests.";
    expect(heuristicDecision([user(prompt)], pool)).toEqual({
      modelId: pro.id,
      effort: "medium",
      via: "heuristic",
    });
  });

  it("breaks strength ties by id", () => {
    const a = model("b-model", { contextWindow: 500000 });
    const b = model("a-model", { contextWindow: 500000 });
    expect(heuristicDecision([user("debug this")], [a, b]).modelId).toBe("a-model");
  });
});

describe("buildJevState", () => {
  it("uses the last user prompt cut to 8000 chars and the first-turn previousEffort", () => {
    const state = buildJevState([user("y".repeat(9000))], undefined);
    expect(state.prompt).toBe("y".repeat(8000));
    expect(state.recentConversation).toEqual([]);
    expect(state.previousEffort).toBe("none (first turn)");
  });

  it("keeps the last six text turns before the prompt, each cut to 600 chars", () => {
    const messages: RouterMessage[] = [
      user("turn 1"),
      assistant("turn 2"),
      user("turn 3"),
      { role: "other", text: "system context", hasImage: false },
      assistant("z".repeat(700)),
      { role: "user", text: "", hasImage: false },
      user("turn 5"),
      assistant("turn 6"),
      user("turn 7"),
      assistant("turn 8"),
      user("current prompt"),
    ];
    const state = buildJevState(messages, "high");
    expect(state.prompt).toBe("current prompt");
    expect(state.previousEffort).toBe("high");
    expect(state.recentConversation).toEqual([
      { role: "user", text: "turn 3" },
      { role: "assistant", text: `${"z".repeat(600)}…` },
      { role: "user", text: "turn 5" },
      { role: "assistant", text: "turn 6" },
      { role: "user", text: "turn 7" },
      { role: "assistant", text: "turn 8" },
    ]);
  });

  it("excludes agent tool-round messages after the prompt", () => {
    const state = buildJevState(
      [user("before"), assistant("reply"), user("fix it"), assistant("calling a tool")],
      undefined,
    );
    expect(state.prompt).toBe("fix it");
    expect(state.recentConversation.map((t) => t.text)).toEqual(["before", "reply"]);
  });
});

describe("buildJevRequest", () => {
  it("asks the verbatim effort question and a model question keyed by pool id", () => {
    const state = buildJevState([user("hello")], undefined);
    const body = buildJevRequest(state, [pro, claude]);
    expect(body.model).toBe("typesafe/jev-1.14.0");
    expect(body.state).toBe(state);
    expect(body.questions.effort).toBe(EFFORT_QUESTION);
    expect(EFFORT_QUESTION.instructions).toContain(
      "use `previousEffort` (the level chosen for the previous user turn) as a reference point.",
    );
    expect(Object.keys(EFFORT_QUESTION.criteria)).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(body.questions.model).toEqual({
      type: "choice",
      instructions: expect.stringContaining("Choose the single best model from the criteria keys"),
      criteria: {
        [pro.id]:
          "vendor/big-pro; context window 1000000 tokens; vision no; tool calling yes; reasoning efforts: low, medium, high",
        [claude.id]:
          "claude-x; context window 200000 tokens; vision yes; tool calling yes; reasoning efforts: low, medium, high",
      },
    });
  });
});

describe("applyFollowUpFloor", () => {
  it("keeps a short follow-up at or above the previous level", () => {
    expect(applyFollowUpFloor("ok, do it", "low", "xhigh")).toBe("xhigh");
    expect(applyFollowUpFloor("ok, do it", "max", "high")).toBe("max");
  });

  it("does not apply to long prompts or the first turn", () => {
    expect(applyFollowUpFloor("x".repeat(81), "low", "xhigh")).toBe("low");
    expect(applyFollowUpFloor("ok", "low", undefined)).toBe("low");
  });
});

describe("escalateForInput", () => {
  const limit = (m: CommandCodeModelInfo) => m.contextWindow - 10000;

  it("keeps the chosen model when input fits", () => {
    expect(escalateForInput(flash, pool, 1000, limit)).toBe(flash);
  });

  it("escalates to the largest-input pool model when input does not fit", () => {
    expect(escalateForInput(flash, pool, 300000, limit)).toBe(pro);
    expect(escalateForInput(flash, pool, 5000000, limit)).toBe(pro);
  });
});

describe("AutoRouter", () => {
  it("uses both Jev answers, then serves the same turn from cache", async () => {
    const jev = jevReturning({ model: pro.id, effort: "high" });
    const router = new AutoRouter(jev as unknown as JevFn);
    const messages = [user("refactor the parser")];

    expect(await router.route({ messages, pool })).toEqual({
      modelId: pro.id,
      effort: "high",
      via: "jev",
      modelVia: "jev",
      effortVia: "jev",
    });
    const toolRound = [
      ...messages,
      assistant(""),
      { role: "user" as const, text: "", hasImage: false },
    ];
    expect(await router.route({ messages: toolRound, pool })).toEqual({
      modelId: pro.id,
      effort: "high",
      via: "jev",
      modelVia: "jev",
      effortVia: "jev",
    });
    expect(jev).toHaveBeenCalledTimes(1);
    const [body, signal] = jev.mock.calls[0] as [JevRequestBody, AbortSignal];
    expect(body.state).toEqual({
      prompt: "refactor the parser",
      recentConversation: [],
      previousEffort: "none (first turn)",
    });
    expect(Object.keys(body.questions)).toEqual(["effort", "model"]);
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("keeps Jev's effort but uses the heuristic model when the model is out of pool", async () => {
    const router = new AutoRouter(
      jevReturning({ model: "other/model", effort: "xhigh" }) as unknown as JevFn,
    );
    const decision = await router.route({ messages: [user("list files")], pool });
    expect(decision).toMatchObject({
      modelId: flash.id,
      effort: "xhigh",
      via: "jev",
      modelVia: "heuristic",
      effortVia: "jev",
    });
    expect(decision.note).toContain("Jev model answer");
  });

  it("keeps Jev's model but uses the heuristic effort when the effort is invalid", async () => {
    const router = new AutoRouter(
      jevReturning({ model: pro.id, effort: "extreme" }) as unknown as JevFn,
    );
    const decision = await router.route({ messages: [user("list files")], pool });
    expect(decision).toMatchObject({
      modelId: pro.id,
      effort: "low",
      via: "jev",
      modelVia: "jev",
      effortVia: "heuristic",
    });
    expect(decision.note).toContain("Jev effort answer");
  });

  it("re-judges when the last user message changes and passes the previous effort", async () => {
    const jev = jevReturning({ model: flash.id, effort: "medium" });
    const router = new AutoRouter(jev as unknown as JevFn);
    await router.route({ messages: [user("a")], pool });
    const second = await router.route({
      messages: [user("a"), assistant("ok"), user("b")],
      pool,
    });
    expect(second.via).toBe("jev");
    expect(jev).toHaveBeenCalledTimes(2);
    const body = jev.mock.calls[1][0] as JevRequestBody;
    expect(body.state.previousEffort).toBe("medium");
    expect(body.state.recentConversation).toEqual([
      { role: "user", text: "a" },
      { role: "assistant", text: "ok" },
    ]);
  });

  it("applies the follow-up floor to a short prompt after a higher-effort turn", async () => {
    const jev = jest
      .fn()
      .mockResolvedValueOnce(jevBody({ model: pro.id, effort: "xhigh" }))
      .mockResolvedValueOnce(jevBody({ model: flash.id, effort: "low" }));
    const router = new AutoRouter(jev as unknown as JevFn);
    await router.route({ messages: [user("design the new storage layer")], pool });
    const followUp = await router.route({
      messages: [user("design the new storage layer"), assistant("plan..."), user("ok, do it")],
      pool,
    });
    expect(followUp).toMatchObject({ modelId: flash.id, effort: "xhigh", via: "jev" });
    expect(followUp.note).toContain("follow-up floor raised effort low -> xhigh");
  });

  it("does not floor a long prompt", async () => {
    const jev = jest
      .fn()
      .mockResolvedValueOnce(jevBody({ model: pro.id, effort: "xhigh" }))
      .mockResolvedValueOnce(jevBody({ model: flash.id, effort: "low" }));
    const router = new AutoRouter(jev as unknown as JevFn);
    await router.route({ messages: [user("design the new storage layer")], pool });
    const next = await router.route({
      messages: [
        user("design the new storage layer"),
        assistant("plan..."),
        user(`Now just tell me the current date, nothing else. ${"please ".repeat(10)}`),
      ],
      pool,
    });
    expect(next.effort).toBe("low");
    expect(next.note).toBeUndefined();
  });

  it("applies the follow-up floor to heuristic efforts too", async () => {
    const jev = jest
      .fn()
      .mockResolvedValueOnce(jevBody({ model: pro.id, effort: "max" }))
      .mockRejectedValueOnce(new Error("HTTP 503"));
    const router = new AutoRouter(jev as unknown as JevFn);
    await router.route({ messages: [user("fix the data-loss bug")], pool });
    const followUp = await router.route({
      messages: [user("fix the data-loss bug"), assistant("done?"), user("continue")],
      pool,
    });
    expect(followUp).toMatchObject({ modelId: flash.id, effort: "max", via: "heuristic" });
  });

  it("re-routes when the cached model left the pool", async () => {
    const router = new AutoRouter(
      jevReturning({ model: pro.id, effort: "high" }) as unknown as JevFn,
    );
    await router.route({ messages: [user("task")], pool });
    const decision = await router.route({ messages: [user("task")], pool: [flash] });
    expect(decision).toMatchObject({ modelId: flash.id, modelVia: "heuristic" });
  });

  it("only offers vision models to Jev when images are present", async () => {
    const jev = jevReturning({ model: claude.id, effort: "medium" });
    const router = new AutoRouter(jev as unknown as JevFn);
    const decision = await router.route({
      messages: [user("what is in this screenshot?", true)],
      pool,
    });
    expect(decision).toMatchObject({ modelId: claude.id, via: "jev" });
    const body = jev.mock.calls[0][0] as JevRequestBody;
    expect(Object.keys((body.questions.model as { criteria: object }).criteria)).toEqual([
      claude.id,
    ]);
  });

  it("uses the heuristic model when Jev picks a model outside the vision pool", async () => {
    const router = new AutoRouter(
      jevReturning({ model: pro.id, effort: "high" }) as unknown as JevFn,
    );
    const decision = await router.route({ messages: [user("describe this", true)], pool });
    expect(decision).toMatchObject({ modelId: claude.id, effort: "high", modelVia: "heuristic" });
  });

  it("notes a vision fail-open when the pool has no vision model", async () => {
    const router = new AutoRouter(jevReturning({}) as unknown as JevFn);
    const decision = await router.route({
      messages: [user("describe this", true)],
      pool: [pro, flash],
    });
    expect(decision.note).toContain("no vision model");
  });

  it("degrades to the heuristic on a malformed Jev body", async () => {
    const router = new AutoRouter(jest.fn(async () => "not json") as unknown as JevFn);
    const decision = await router.route({ messages: [user("list files")], pool });
    expect(decision).toMatchObject({ modelId: flash.id, effort: "low", via: "heuristic" });
    expect(decision.note).toContain("missing answers");
  });

  it("degrades to the heuristic when the Jev call fails", async () => {
    const jev = jest.fn(async () => {
      throw new Error("Jev request failed (500): boom");
    });
    const router = new AutoRouter(jev as unknown as JevFn);
    const decision = await router.route({ messages: [user("debug the login failure")], pool });
    expect(decision).toMatchObject({
      modelId: pro.id,
      effort: "high",
      via: "heuristic",
      modelVia: "heuristic",
      effortVia: "heuristic",
    });
    expect(decision.note).toContain("Jev request failed (500)");
  });

  it("times out a Jev call that never answers and aborts its signal", async () => {
    let jevSignal: AbortSignal | undefined;
    const jev: JevFn = (_body, signal) => {
      jevSignal = signal;
      return new Promise<unknown>(() => undefined);
    };
    const router = new AutoRouter(jev, 20);
    const decision = await router.route({ messages: [user("list files")], pool });
    expect(decision.via).toBe("heuristic");
    expect(decision.note).toContain("timed out");
    expect(jevSignal?.aborted).toBe(true);
  });

  it("evicts the oldest cache entries beyond 50 turns", async () => {
    const router = new AutoRouter(
      jevReturning({ model: pro.id, effort: "high" }) as unknown as JevFn,
    );
    for (let i = 0; i < 51; i++) {
      await router.route({ messages: [user(`prompt ${i}`)], pool });
    }
    expect((await router.route({ messages: [user("prompt 50")], pool })).via).toBe("jev");
    expect((await router.route({ messages: [user("prompt 0")], pool })).via).toBe("jev");
  });
});
