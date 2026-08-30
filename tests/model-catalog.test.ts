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
  expect(FALLBACK_MODELS.length).toBe(62);
  expect(FALLBACK_MODELS.every((model) => model.isUserSelectable)).toBe(true);
});
