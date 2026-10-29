import * as vscode from "vscode";
import * as api from "../src/api";
import { resetPreviousEffort } from "../src/auto-router";
import { CommandCodeChatModelProvider } from "../src/provider";
import * as anthropicStream from "../src/streaming/anthropic";
import * as openaiStream from "../src/streaming/openai";
import { FALLBACK_MODELS } from "../src/types";

let mockEnableZdr = false;
let mockAutoPool: string[] = [];

jest.mock("../src/api", () => ({
  fetchModels: jest.fn(),
  streamChatCompletion: jest.fn(),
  fetchWithRetry: jest.fn(),
  requestSystemOne: jest.fn(),
}));

jest.mock("../src/streaming/anthropic", () => ({
  handleAnthropicRequest: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../src/streaming/openai", () => ({
  processOpenAIStream: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("vscode", () => ({
  SecretStorage: class {},
  LanguageModelChatMessageRole: { User: 1, Assistant: 2, System: 0 },
  LanguageModelChatToolMode: { Auto: 1, Required: 2 },
  LanguageModelTextPart: class {
    constructor(public value: string) {}
  },
  LanguageModelToolCallPart: class {
    constructor(
      public callId: string,
      public name: string,
      public input: Record<string, unknown>,
    ) {}
  },
  LanguageModelToolResultPart: class {
    constructor(
      public callId: string,
      public content: unknown[],
    ) {}
  },
  window: {
    createOutputChannel: jest.fn(() => ({
      appendLine: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
    })),
    showInputBox: jest.fn(),
  },
  workspace: {
    getConfiguration: jest.fn((section?: string) => ({
      get: jest.fn((key: string, defaultValue: unknown) => {
        if (section === "commandcode-goat" && key === "enableZdr") return mockEnableZdr;
        if (section === "commandcode-goat" && key === "auto.pool") return mockAutoPool;
        return defaultValue;
      }),
    })),
  },
  CancellationError: class extends Error {
    constructor() {
      super("Canceled");
      this.name = "CancellationError";
    }
  },
  EventEmitter: class {
    private listeners: Array<() => void> = [];
    event = (listener: () => void) => {
      this.listeners.push(listener);
      return { dispose: jest.fn() };
    };
    fire = () => {
      for (const listener of this.listeners) listener();
    };
  },
}));

describe("CommandCodeChatModelProvider", () => {
  let secrets: vscode.SecretStorage;
  let provider: CommandCodeChatModelProvider;

  beforeEach(() => {
    resetPreviousEffort();
    mockEnableZdr = false;
    mockAutoPool = [];
    jest.clearAllMocks();
    secrets = {
      get: jest.fn(async (key: string) =>
        key === "commandcode-goat.apiKey" ? "test-key" : undefined,
      ),
      store: jest.fn(async () => undefined),
      delete: jest.fn(async () => undefined),
      onDidChange: jest.fn(() => ({ dispose: jest.fn() })),
    } as unknown as vscode.SecretStorage;
    (api.fetchModels as jest.Mock).mockResolvedValue([
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", context_length: 1000000 },
      { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro (latest)", context_length: 1000000 },
      { id: "moonshotai/Kimi-K3", name: "Kimi K3", context_length: 1000000 },
      { id: "unknown-future-model", name: "Unknown Future Model", context_length: 200000 },
    ]);
    provider = new CommandCodeChatModelProvider(secrets, "test-ua");
    ((vscode as any).window.showInputBox as jest.Mock).mockResolvedValue(undefined);
  });

  describe("Model discovery and chat information", () => {
    it("returns chat information for bundled catalog and fetched models", async () => {
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      };

      const infos = await provider.provideLanguageModelChatInformation(
        { silent: true } as any,
        token as any,
      );

      expect(infos.length).toBeGreaterThan(0);
      const claude = infos.find((i) => i.id === "claude-sonnet-4-6");
      expect(claude).toBeDefined();
      expect(claude?.name).toBe("Claude Sonnet 4.6");
      expect(claude?.detail).toBe("Command Code GOAT");
      expect(claude?.family).toBe("commandcode-goat");
      expect((claude as any)?.isUserSelectable).toBe(true);

      const unknown = infos.find((i) => i.id === "unknown-future-model");
      expect(unknown).toBeDefined();
      expect((unknown as any)?.isUserSelectable).toBe(false);
    });

    it("syncs configured API key from options", async () => {
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      };

      await provider.provideLanguageModelChatInformation(
        { silent: true, configuration: { apiKey: " configured-key " } } as any,
        token as any,
      );

      expect(secrets.store).toHaveBeenCalledWith("commandcode-goat.apiKey", "configured-key");
    });

    it("clears stored API key when configured key is empty", async () => {
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      };

      await provider.provideLanguageModelChatInformation(
        { silent: true, configuration: { apiKey: "   " } } as any,
        token as any,
      );

      expect(secrets.delete).toHaveBeenCalledWith("commandcode-goat.apiKey");
    });

    it("returns empty array on cancellation", async () => {
      const token = {
        isCancellationRequested: true,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      };

      const infos = await provider.provideLanguageModelChatInformation(
        { silent: true } as any,
        token as any,
      );

      expect(infos).toEqual([]);
    });
  });

  describe("Chat response routing", () => {
    it("reports missing API key guidance when no key is configured", async () => {
      (secrets.get as jest.Mock).mockResolvedValue(undefined);
      const reportedParts: vscode.LanguageModelResponsePart[] = [];
      const progress = { report: (part: any) => reportedParts.push(part) };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      };

      const model = {
        id: "claude-sonnet-4-6",
        maxInputTokens: 900000,
        maxOutputTokens: 65536,
      };

      await provider.provideLanguageModelChatResponse(
        model as any,
        [
          {
            role: vscode.LanguageModelChatMessageRole.User,
            content: [new (vscode as any).LanguageModelTextPart("hi")],
            name: undefined,
          },
        ] as any,
        {} as any,
        progress as any,
        token as any,
      );

      expect(reportedParts).toHaveLength(1);
      expect((reportedParts[0] as any).value).toContain(
        "Command Code GOAT API key is not configured",
      );
    });

    it("routes Claude models to Anthropic streaming", async () => {
      const progress = { report: jest.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      };

      const model = {
        id: "claude-sonnet-4-6",
        maxInputTokens: 900000,
        maxOutputTokens: 65536,
      };

      await provider.provideLanguageModelChatResponse(
        model as any,
        [
          {
            role: vscode.LanguageModelChatMessageRole.User,
            content: [new (vscode as any).LanguageModelTextPart("hi")],
            name: undefined,
          },
        ] as any,
        {} as any,
        progress as any,
        token as any,
      );

      expect(anthropicStream.handleAnthropicRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          modelId: "claude-sonnet-4-6",
          apiKey: "test-key",
        }),
      );
    });

    it("routes OpenAI models to OpenAI streaming", async () => {
      const progress = { report: jest.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      };

      const model = {
        id: "deepseek/deepseek-v4-pro",
        maxInputTokens: 900000,
        maxOutputTokens: 65536,
      };

      await provider.provideLanguageModelChatResponse(
        model as any,
        [
          {
            role: vscode.LanguageModelChatMessageRole.User,
            content: [new (vscode as any).LanguageModelTextPart("hi")],
            name: undefined,
          },
        ] as any,
        {} as any,
        progress as any,
        token as any,
      );

      expect(openaiStream.processOpenAIStream).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "deepseek/deepseek-v4-pro",
        }),
        expect.anything(),
        expect.anything(),
        "test-key",
        expect.anything(),
        undefined,
        undefined,
        FALLBACK_MODELS,
        "test-ua",
        progress,
        token,
        expect.anything(),
        undefined,
        false,
      );
    });

    it("passes enableZdr configuration flag to streaming handlers", async () => {
      mockEnableZdr = true;
      const progress = { report: jest.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      };

      const model = {
        id: "claude-sonnet-4-6",
        maxInputTokens: 900000,
        maxOutputTokens: 65536,
      };

      await provider.provideLanguageModelChatResponse(
        model as any,
        [
          {
            role: vscode.LanguageModelChatMessageRole.User,
            content: [new (vscode as any).LanguageModelTextPart("hi")],
            name: undefined,
          },
        ] as any,
        {} as any,
        progress as any,
        token as any,
      );

      expect(anthropicStream.handleAnthropicRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          enableZdr: true,
        }),
      );
    });

    it("rejects non-selectable or unknown models", async () => {
      const progress = { report: jest.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      };

      const model = {
        id: "unknown-future-model",
        maxInputTokens: 200000,
        maxOutputTokens: 65536,
      };

      await expect(
        provider.provideLanguageModelChatResponse(
          model as any,
          [
            {
              role: vscode.LanguageModelChatMessageRole.User,
              content: [new (vscode as any).LanguageModelTextPart("hi")],
              name: undefined,
            },
          ] as any,
          {} as any,
          progress as any,
          token as any,
        ),
      ).rejects.toThrow("is not supported or not selectable");
    });
  });

  describe("GOAT Auto", () => {
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
    };
    const autoModel = {
      id: "commandcode-goat/auto",
      maxInputTokens: 900000,
      maxOutputTokens: 65536,
    };
    const userMessage = (text: string) => ({
      role: vscode.LanguageModelChatMessageRole.User,
      content: [new (vscode as any).LanguageModelTextPart(text)],
      name: undefined,
    });
    const jevAnswers = (model: string, effort: string) =>
      (api.requestSystemOne as jest.Mock).mockResolvedValue({
        model: "typesafe/jev-1.14.0",
        answers: {
          effort: { type: "choice", choice: effort, confidence: 0.8 },
          model: { type: "choice", choice: model, confidence: 0.7 },
        },
      });
    const listInfos = () =>
      provider.provideLanguageModelChatInformation({ silent: true } as any, token as any);

    it("lists GOAT Auto through the catalog path with a Thinking Effort picker", async () => {
      const infos = await listInfos();
      const autos = infos.filter((i) => i.id === "commandcode-goat/auto");
      expect(autos).toHaveLength(1);
      expect(autos[0]).toMatchObject({
        name: "GOAT Auto",
        detail: "Command Code GOAT",
        family: "commandcode-goat",
        isUserSelectable: true,
        maxInputTokens: 200000 - 65536,
        maxOutputTokens: 65536,
        capabilities: { toolCalling: true, imageInput: true },
      });
      expect((autos[0] as any).configurationSchema.properties.reasoningEffort.enum).toEqual([
        "default",
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
      ]);
      expect(infos.filter((i) => i.id !== "commandcode-goat/auto").length).toBe(4);
    });

    it("lists GOAT Auto before the model fetch completes and when it fails", async () => {
      (api.fetchModels as jest.Mock).mockRejectedValue(new Error("offline"));
      provider = new CommandCodeChatModelProvider(secrets, "test-ua");
      const ids = (await listInfos()).map((i) => i.id);
      expect(ids.filter((id) => id === "commandcode-goat/auto")).toHaveLength(1);
      expect(ids.length).toBe(FALLBACK_MODELS.length + 1);
    });

    it("lists GOAT Auto once even if the API returns its id", async () => {
      (api.fetchModels as jest.Mock).mockResolvedValue([
        { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", context_length: 1000000 },
        { id: "commandcode-goat/auto", name: "Imposter", context_length: 1000 },
      ]);
      provider = new CommandCodeChatModelProvider(secrets, "test-ua");
      const autos = (await listInfos()).filter((i) => i.id === "commandcode-goat/auto");
      expect(autos).toHaveLength(1);
      expect(autos[0].name).toBe("GOAT Auto");
    });

    it("keeps GOAT Auto out of the selectable pool candidates", async () => {
      await listInfos();
      const ids = provider.getSelectableModels().map((m) => m.id);
      expect(ids).not.toContain("commandcode-goat/auto");
      expect(ids).toContain("deepseek/deepseek-v4-pro");
    });

    it("never routes GOAT Auto to itself from a hand-edited pool", async () => {
      mockAutoPool = ["commandcode-goat/auto", "deepseek/deepseek-v4-pro", "moonshotai/Kimi-K3"];
      jevAnswers("deepseek/deepseek-v4-pro", "high");
      await listInfos();

      await provider.provideLanguageModelChatResponse(
        autoModel as any,
        [userMessage("refactor the parser module")] as any,
        {} as any,
        { report: jest.fn() } as any,
        token as any,
      );

      const [, jevBody] = (api.requestSystemOne as jest.Mock).mock.calls[0];
      expect(Object.keys(jevBody.questions.model.criteria)).toEqual([
        "deepseek/deepseek-v4-pro",
        "moonshotai/Kimi-K3",
      ]);
      const call = (openaiStream.processOpenAIStream as jest.Mock).mock.calls[0];
      expect(call[0]).toMatchObject({ id: "deepseek/deepseek-v4-pro" });
    });

    it("reports an empty pool when the pool lists only GOAT Auto", async () => {
      mockAutoPool = ["commandcode-goat/auto"];
      const reported: any[] = [];
      await provider.provideLanguageModelChatResponse(
        autoModel as any,
        [userMessage("hi")] as any,
        {} as any,
        { report: (part: any) => reported.push(part) } as any,
        token as any,
      );
      expect(reported[0].value).toContain("Configure GOAT Auto Pool");
      expect(api.requestSystemOne).not.toHaveBeenCalled();
      expect(openaiStream.processOpenAIStream).not.toHaveBeenCalled();
    });

    it("explains how to configure the pool when it is empty", async () => {
      const reported: any[] = [];
      await provider.provideLanguageModelChatResponse(
        autoModel as any,
        [userMessage("hi")] as any,
        {} as any,
        { report: (part: any) => reported.push(part) } as any,
        token as any,
      );
      expect(reported).toHaveLength(1);
      expect(reported[0].value).toContain("Configure GOAT Auto Pool");
      expect(reported[0].value).toContain("commandcode-goat.auto.pool");
      expect(openaiStream.processOpenAIStream).not.toHaveBeenCalled();
      expect(anthropicStream.handleAnthropicRequest).not.toHaveBeenCalled();
    });

    it("dispatches Jev's model with its effort clamped by the existing rules", async () => {
      mockAutoPool = ["deepseek/deepseek-v4-pro", "moonshotai/Kimi-K3"];
      mockEnableZdr = true;
      jevAnswers("deepseek/deepseek-v4-pro", "xhigh");
      await listInfos();
      const progress = { report: jest.fn() };

      await provider.provideLanguageModelChatResponse(
        autoModel as any,
        [userMessage("refactor the parser module")] as any,
        {} as any,
        progress as any,
        token as any,
      );

      // One Jev call with the user's API key, both questions, ZDR honoured.
      expect(api.requestSystemOne).toHaveBeenCalledTimes(1);
      const [jevKey, jevBody, jevSignal, jevUa, jevZdr] = (api.requestSystemOne as jest.Mock).mock
        .calls[0];
      expect(jevKey).toBe("test-key");
      expect(jevBody).toMatchObject({
        model: "typesafe/jev-1.14.0",
        state: { prompt: "refactor the parser module", previousEffort: expect.any(String) },
      });
      expect(Object.keys(jevBody.questions)).toEqual(["effort", "model"]);
      expect(Object.keys(jevBody.questions.model.criteria)).toEqual([
        "deepseek/deepseek-v4-pro",
        "moonshotai/Kimi-K3",
      ]);
      expect(jevSignal).toBeInstanceOf(AbortSignal);
      expect(jevUa).toBe("test-ua");
      expect(jevZdr).toBe(true);
      expect(api.streamChatCompletion).not.toHaveBeenCalled();

      // xhigh is not supported by DeepSeek V4 Pro (high, max) → mapped to max.
      const call = (openaiStream.processOpenAIStream as jest.Mock).mock.calls[0];
      expect(call[0]).toMatchObject({ id: "deepseek/deepseek-v4-pro", maxOutputTokens: 131072 });
      expect(call[12]).toBe("max");
    });

    it("routes to an anthropic-format pool model without passing an effort", async () => {
      mockAutoPool = ["claude-sonnet-4-6", "deepseek/deepseek-v4-pro"];
      jevAnswers("claude-sonnet-4-6", "high");
      await listInfos();

      await provider.provideLanguageModelChatResponse(
        autoModel as any,
        [userMessage("review this design")] as any,
        {} as any,
        { report: jest.fn() } as any,
        token as any,
      );

      expect(anthropicStream.handleAnthropicRequest).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: "claude-sonnet-4-6", apiKey: "test-key" }),
      );
      expect(openaiStream.processOpenAIStream).not.toHaveBeenCalled();
    });

    it("escalates to the largest pool model when input exceeds the chosen model", async () => {
      (api.fetchModels as jest.Mock).mockResolvedValue([
        { id: "moonshotai/Kimi-K2.7-Code", name: "Kimi K2.7 Code", context_length: 256000 },
        { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", context_length: 1000000 },
      ]);
      provider = new CommandCodeChatModelProvider(secrets, "test-ua");
      mockAutoPool = ["moonshotai/Kimi-K2.7-Code", "deepseek/deepseek-v4-pro"];
      jevAnswers("moonshotai/Kimi-K2.7-Code", "low");
      await listInfos();

      await provider.provideLanguageModelChatResponse(
        autoModel as any,
        [userMessage("a".repeat(400000))] as any,
        {} as any,
        { report: jest.fn() } as any,
        token as any,
      );

      // ~200k tokens do not fit Kimi K2.7 Code (256k); DeepSeek V4 Pro gets it, and "low"
      // is re-clamped against DeepSeek's supported efforts (high, max) → dropped.
      const call = (openaiStream.processOpenAIStream as jest.Mock).mock.calls[0];
      expect(call[0]).toMatchObject({ id: "deepseek/deepseek-v4-pro" });
      expect(call[12]).toBeUndefined();
    });

    it("falls back to the heuristic when the Jev request fails", async () => {
      mockAutoPool = ["deepseek/deepseek-v4-pro", "moonshotai/Kimi-K3"];
      (api.requestSystemOne as jest.Mock).mockRejectedValue(
        new Error("Jev request failed (503): unavailable"),
      );
      await listInfos();

      await provider.provideLanguageModelChatResponse(
        autoModel as any,
        [userMessage("debug the flaky login test")] as any,
        {} as any,
        { report: jest.fn() } as any,
        token as any,
      );

      // Heuristic: debugging keyword → strongest pool model (largest context, tie by id).
      const call = (openaiStream.processOpenAIStream as jest.Mock).mock.calls[0];
      expect(call[0]).toMatchObject({ id: "deepseek/deepseek-v4-pro" });
      expect(call[12]).toBe("high");
    });

    it("lets a Thinking Effort pick override the router's effort, still clamped", async () => {
      mockAutoPool = ["deepseek/deepseek-v4-pro", "moonshotai/Kimi-K3"];
      jevAnswers("deepseek/deepseek-v4-pro", "low");
      await listInfos();

      await provider.provideLanguageModelChatResponse(
        autoModel as any,
        [userMessage("refactor the parser module")] as any,
        { modelConfiguration: { reasoningEffort: "xhigh" } } as any,
        { report: jest.fn() } as any,
        token as any,
      );

      // The router still picks the model; xhigh → max for DeepSeek V4 Pro (high, max).
      const call = (openaiStream.processOpenAIStream as jest.Mock).mock.calls[0];
      expect(call[0]).toMatchObject({ id: "deepseek/deepseek-v4-pro" });
      expect(call[12]).toBe("max");
    });

    it("keeps the router's effort when Thinking Effort is Default", async () => {
      mockAutoPool = ["deepseek/deepseek-v4-pro", "moonshotai/Kimi-K3"];
      jevAnswers("deepseek/deepseek-v4-pro", "high");
      await listInfos();

      await provider.provideLanguageModelChatResponse(
        autoModel as any,
        [userMessage("refactor the parser module")] as any,
        { modelConfiguration: { reasoningEffort: "default" } } as any,
        { report: jest.fn() } as any,
        token as any,
      );

      const call = (openaiStream.processOpenAIStream as jest.Mock).mock.calls[0];
      expect(call[12]).toBe("high");
    });
  });

  describe("Token counting", () => {
    it("estimates token counts for string text", async () => {
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: jest.fn(() => ({ dispose: jest.fn() })),
      };

      const count = await provider.provideTokenCount(
        {} as any,
        "Hello world from Command Code GOAT",
        token as any,
      );

      expect(count).toBeGreaterThan(0);
    });
  });
});
