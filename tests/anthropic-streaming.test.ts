import * as vscode from "vscode";
import { handleAnthropicRequest } from "../src/streaming/anthropic";
import { CommandCodeModelInfo } from "../src/types";

describe("handleAnthropicRequest", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("processes Anthropic SSE stream and emits text parts", async () => {
    const sseBody = [
      "event: message_start",
      'data: {"type":"message_start","message":{"id":"msg-1","role":"assistant","content":[]}}',
      "",
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
      "",
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"done"}}',
      "",
      'data: {"type":"content_block_stop","index":0}',
      "",
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}',
      "",
      'data: {"type":"message_stop"}',
      "",
    ].join("\n");

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody));
        controller.close();
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: stream,
    } as any);

    const reportedParts: vscode.LanguageModelResponsePart[] = [];
    const progress: vscode.Progress<vscode.LanguageModelResponsePart> = {
      report: (part) => reportedParts.push(part),
    };

    const modelInfo: CommandCodeModelInfo = {
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      displayName: "Claude Sonnet 4.6",
      contextWindow: 1000000,
      maxOutput: 65536,
      supportsTools: true,
      supportsVision: true,
      supportsThinking: false,
      apiFormat: "anthropic",
      isUserSelectable: true,
    };

    const messages = [
      {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [new vscode.LanguageModelTextPart("Hello Claude")],
      },
    ];

    const token = new vscode.CancellationTokenSource().token;
    const abortController = new AbortController();

    await handleAnthropicRequest({
      modelId: modelInfo.id,
      messages: messages as any,
      options: { tools: [] } as any,
      apiKey: "test-anthropic-key",
      requestedMaxTokens: 4096,
      temperatureVal: undefined,
      progress,
      token,
      abortController,
      fallbackModels: [modelInfo],
      userAgent: "test-agent",
      enableZdr: true,
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.commandcode.ai/provider/v1/messages",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-anthropic-key",
          "anthropic-version": "2023-06-01",
          "x-cmd-zdr": "1",
        }),
      }),
    );

    const textParts = reportedParts.filter(
      (part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart,
    );
    const combinedText = textParts.map((p) => p.value).join("");
    expect(combinedText).toBe("done");
  });

  it("assembles partial JSON tool calls and emits tool call part", async () => {
    const sseBody = [
      "event: message_start",
      'data: {"type":"message_start","message":{"id":"msg-2","role":"assistant","content":[]}}',
      "",
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_123","name":"read_file","input":{}}}',
      "",
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\": \\"package.json\\"}"}}',
      "",
      'data: {"type":"content_block_stop","index":0}',
      "",
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}',
      "",
      'data: {"type":"message_stop"}',
      "",
    ].join("\n");

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sseBody));
        controller.close();
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: stream,
    } as any);

    const reportedParts: vscode.LanguageModelResponsePart[] = [];
    const progress: vscode.Progress<vscode.LanguageModelResponsePart> = {
      report: (part) => reportedParts.push(part),
    };

    const modelInfo: CommandCodeModelInfo = {
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6",
      displayName: "Claude Sonnet 4.6",
      contextWindow: 1000000,
      maxOutput: 65536,
      supportsTools: true,
      supportsVision: true,
      supportsThinking: false,
      apiFormat: "anthropic",
      isUserSelectable: true,
    };

    const messages = [
      {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [new vscode.LanguageModelTextPart("Check package.json")],
      },
    ];

    const token = new vscode.CancellationTokenSource().token;
    const abortController = new AbortController();

    await handleAnthropicRequest({
      modelId: modelInfo.id,
      messages: messages as any,
      options: {
        tools: [
          {
            name: "read_file",
            description: "Read file contents",
            inputSchema: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
      } as any,
      apiKey: "test-anthropic-key",
      requestedMaxTokens: 4096,
      temperatureVal: undefined,
      progress,
      token,
      abortController,
      fallbackModels: [modelInfo],
      userAgent: "test-agent",
    });

    const toolCalls = reportedParts.filter(
      (part): part is vscode.LanguageModelToolCallPart =>
        part instanceof vscode.LanguageModelToolCallPart,
    );
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].callId).toBe("call_123");
    expect(toolCalls[0].name).toBe("read_file");
    expect(toolCalls[0].input).toEqual({ path: "package.json" });
  });
});
