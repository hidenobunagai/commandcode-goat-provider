import * as vscode from "vscode";
import * as api from "../src/api";
import { CommandCodeChatModelProvider } from "../src/provider";
import * as anthropicStream from "../src/streaming/anthropic";
import * as openaiStream from "../src/streaming/openai";
import { FALLBACK_MODELS } from "../src/types";

let mockEnableZdr = false;

jest.mock("../src/api", () => ({
  fetchModels: jest.fn(),
  streamChatCompletion: jest.fn(),
  fetchWithRetry: jest.fn(),
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
    mockEnableZdr = false;
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
