import {
  AUTO_MODEL_ID,
  AutoRouter,
  buildJudgePrompt,
  computeTurnKey,
  escalateForInput,
  filterPoolForVision,
  heuristicDecision,
  type JudgeFn,
  parseJudgeReply,
  resolvePool,
  type RouterMessage,
  selectJudgeModel,
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

function judgeReturning(reply: string): jest.Mock {
  return jest.fn(async () => reply) as jest.Mock;
}

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

describe("selectJudgeModel", () => {
  const modelMap = new Map(pool.map((m) => [m.id, m]));

  it("uses the configured judge when it is openai-format", () => {
    const outside = model("outside/judge");
    modelMap.set(outside.id, outside);
    expect(selectJudgeModel("outside/judge", pool, modelMap)?.id).toBe("outside/judge");
  });

  it("ignores an anthropic-format configured judge and prefers a flash pool model", () => {
    expect(selectJudgeModel("claude-x", pool, modelMap)?.id).toBe(flash.id);
    expect(selectJudgeModel("", pool, modelMap)?.id).toBe(flash.id);
  });

  it("falls back to the first openai-format pool model, or none", () => {
    expect(selectJudgeModel("", [claude, pro], modelMap)?.id).toBe(pro.id);
    expect(selectJudgeModel("", [claude], modelMap)).toBeUndefined();
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

describe("parseJudgeReply", () => {
  it("accepts a valid reply embedded in prose", () => {
    expect(
      parseJudgeReply('Sure: {"model": "vendor/big-pro", "effort": "high"} done', pool),
    ).toEqual({ modelId: pro.id, effort: "high" });
  });

  it.each([
    ["garbage", "no json here"],
    ["broken json", '{"model": "vendor/big-pro", "effort": }'],
    ["out-of-pool model", '{"model": "other/model", "effort": "high"}'],
    ["invalid effort", '{"model": "vendor/big-pro", "effort": "extreme"}'],
    ["missing effort", '{"model": "vendor/big-pro"}'],
  ])("rejects %s", (_label, reply) => {
    expect(parseJudgeReply(reply, pool)).toBeUndefined();
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

describe("buildJudgePrompt", () => {
  it("includes the pool table, recent turns, and truncated task", () => {
    const longTask = "x".repeat(2500);
    const { system, user: content } = buildJudgePrompt(
      [user("earlier question"), assistant("earlier answer"), user(longTask)],
      [pro],
    );
    expect(system).toContain('{"model"');
    expect(content).toContain("vendor/big-pro | vendor/big-pro | context 1000000");
    expect(content).toContain("user: earlier question");
    expect(content).toContain("assistant: earlier answer");
    expect(content).toContain(`${"x".repeat(2000)}…`);
    expect(content).not.toContain("x".repeat(2001));
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
  it("returns the judge's choice, then serves the same turn from cache", async () => {
    const judge = judgeReturning('{"model": "vendor/big-pro", "effort": "high"}');
    const router = new AutoRouter(judge as unknown as JudgeFn);
    const messages = [user("refactor the parser")];

    expect(await router.route({ messages, pool, judgeModel: flash })).toEqual({
      modelId: pro.id,
      effort: "high",
      via: "judge",
    });
    const toolRound = [
      ...messages,
      assistant(""),
      { role: "user" as const, text: "", hasImage: false },
    ];
    expect(await router.route({ messages: toolRound, pool, judgeModel: flash })).toEqual({
      modelId: pro.id,
      effort: "high",
      via: "cache",
    });
    expect(judge).toHaveBeenCalledTimes(1);
    expect(judge.mock.calls[0][0]).toMatchObject({ judgeModel: flash });
  });

  it("re-judges when the last user message changes", async () => {
    const judge = judgeReturning('{"model": "vendor/fast-flash", "effort": "low"}');
    const router = new AutoRouter(judge as unknown as JudgeFn);
    await router.route({ messages: [user("a")], pool, judgeModel: flash });
    const second = await router.route({
      messages: [user("a"), assistant("ok"), user("b")],
      pool,
      judgeModel: flash,
    });
    expect(second.via).toBe("judge");
    expect(judge).toHaveBeenCalledTimes(2);
  });

  it("re-routes when the cached model left the pool", async () => {
    const judge = judgeReturning('{"model": "vendor/big-pro", "effort": "high"}');
    const router = new AutoRouter(judge as unknown as JudgeFn);
    await router.route({ messages: [user("task")], pool, judgeModel: flash });
    const decision = await router.route({
      messages: [user("task")],
      pool: [flash],
      judgeModel: flash,
    });
    expect(decision).toMatchObject({ modelId: flash.id, via: "heuristic" });
  });

  it("only offers vision models to the judge when images are present", async () => {
    const judge = judgeReturning('{"model": "claude-x", "effort": "medium"}');
    const router = new AutoRouter(judge as unknown as JudgeFn);
    const decision = await router.route({
      messages: [user("what is in this screenshot?", true)],
      pool,
      judgeModel: flash,
    });
    expect(decision).toMatchObject({ modelId: claude.id, via: "judge" });
    const prompt = (judge.mock.calls[0][0] as { user: string }).user;
    expect(prompt).toContain("claude-x");
    expect(prompt).not.toContain("vendor/big-pro");
  });

  it("falls back to the heuristic when the judge picks a model outside the vision pool", async () => {
    const judge = judgeReturning('{"model": "vendor/big-pro", "effort": "high"}');
    const router = new AutoRouter(judge as unknown as JudgeFn);
    const decision = await router.route({
      messages: [user("describe this", true)],
      pool,
      judgeModel: flash,
    });
    expect(decision).toMatchObject({ modelId: claude.id, via: "heuristic" });
  });

  it("notes a vision fail-open when the pool has no vision model", async () => {
    const router = new AutoRouter(judgeReturning("") as unknown as JudgeFn);
    const decision = await router.route({
      messages: [user("describe this", true)],
      pool: [pro, flash],
      judgeModel: undefined,
    });
    expect(decision.note).toContain("no vision model");
  });

  it("degrades to the heuristic on garbage judge output", async () => {
    const router = new AutoRouter(judgeReturning("I think pro is best") as unknown as JudgeFn);
    const decision = await router.route({
      messages: [user("list files")],
      pool,
      judgeModel: flash,
    });
    expect(decision).toMatchObject({ modelId: flash.id, effort: "low", via: "heuristic" });
    expect(decision.note).toContain("judge reply unusable");
  });

  it("degrades to the heuristic when the judge throws", async () => {
    const judge = jest.fn(async () => {
      throw new Error("HTTP 500");
    });
    const router = new AutoRouter(judge as unknown as JudgeFn);
    const decision = await router.route({
      messages: [user("debug the login failure")],
      pool,
      judgeModel: flash,
    });
    expect(decision).toMatchObject({ modelId: pro.id, effort: "high", via: "heuristic" });
    expect(decision.note).toContain("HTTP 500");
  });

  it("times out a judge that never answers and aborts its signal", async () => {
    let judgeSignal: AbortSignal | undefined;
    const judge: JudgeFn = ({ signal }) => {
      judgeSignal = signal;
      return new Promise<string>(() => undefined);
    };
    const router = new AutoRouter(judge, 20);
    const decision = await router.route({
      messages: [user("list files")],
      pool,
      judgeModel: flash,
    });
    expect(decision.via).toBe("heuristic");
    expect(decision.note).toContain("timed out");
    expect(judgeSignal?.aborted).toBe(true);
  });

  it("skips judging without a judge model", async () => {
    const judge = judgeReturning('{"model": "vendor/big-pro", "effort": "high"}');
    const router = new AutoRouter(judge as unknown as JudgeFn);
    const decision = await router.route({
      messages: [user("list files")],
      pool,
      judgeModel: undefined,
    });
    expect(decision.via).toBe("heuristic");
    expect(judge).not.toHaveBeenCalled();
  });

  it("evicts the oldest cache entries beyond 50 turns", async () => {
    const judge = judgeReturning('{"model": "vendor/big-pro", "effort": "high"}');
    const router = new AutoRouter(judge as unknown as JudgeFn);
    for (let i = 0; i < 51; i++) {
      await router.route({ messages: [user(`prompt ${i}`)], pool, judgeModel: flash });
    }
    expect(
      (await router.route({ messages: [user("prompt 50")], pool, judgeModel: flash })).via,
    ).toBe("cache");
    expect(
      (await router.route({ messages: [user("prompt 0")], pool, judgeModel: flash })).via,
    ).toBe("judge");
  });
});
