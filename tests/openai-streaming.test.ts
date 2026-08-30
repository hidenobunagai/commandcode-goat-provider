import * as vscode from "vscode";
import { processOpenAIStream } from "../src/streaming/openai";
import { CommandCodeModelInfo } from "../src/types";

describe("processOpenAIStream", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("emits text and finalizes on stop without leaking usage to chat text", async () => {
    const sseBody = [
      'data: {"id":"cc-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"ok"},"finish_reason":null}]}',
      "",
      'data: {"id":"cc-1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":12,"completion_tokens":2,"total_tokens":14}}',
      "",
      "data: [DONE]",
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
      id: "deepseek/deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      displayName: "DeepSeek V4 Flash",
      contextWindow: 1000000,
      maxOutput: 131072,
      supportsTools: true,
      supportsVision: false,
      supportsThinking: true,
      apiFormat: "openai",
      isUserSelectable: true,
    };

    const messages = [
      {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [new vscode.LanguageModelTextPart("Hello")],
      },
    ];

    const token = new vscode.CancellationTokenSource().token;
    const abortController = new AbortController();

    await processOpenAIStream(
      { id: modelInfo.id, modelInfo, maxOutputTokens: 131072 },
      messages as any,
      { tools: [] } as any,
      "test-key",
      4096,
      undefined,
      undefined,
      [modelInfo],
      "test-agent",
      progress,
      token,
      abortController,
    );

    const textParts = reportedParts.filter(
      (part): part is vscode.LanguageModelTextPart => part instanceof vscode.LanguageModelTextPart,
    );
    const combinedText = textParts.map((p) => p.value).join("");
    expect(combinedText).toBe("ok");
    expect(combinedText).not.toContain("prompt_tokens");
    expect(combinedText).not.toContain("completion_tokens");
    expect(combinedText).not.toContain("14");
  });

  it("assembles fragmented tool call arguments and emits tool call once", async () => {
    const sseBody = [
      'data: {"id":"cc-2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"read_file","arguments":"{\\"path\\""}}]},"finish_reason":null}]}',
      "",
      'data: {"id":"cc-2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\"README.md\\"}"}}]},"finish_reason":null}]}',
      "",
      'data: {"id":"cc-2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}',
      "",
      "data: [DONE]",
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
      id: "deepseek/deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      displayName: "DeepSeek V4 Flash",
      contextWindow: 1000000,
      maxOutput: 131072,
      supportsTools: true,
      supportsVision: false,
      supportsThinking: true,
      apiFormat: "openai",
      isUserSelectable: true,
    };

    const messages = [
      {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [new vscode.LanguageModelTextPart("Read the readme")],
      },
    ];

    const token = new vscode.CancellationTokenSource().token;
    const abortController = new AbortController();

    await processOpenAIStream(
      { id: modelInfo.id, modelInfo, maxOutputTokens: 131072 },
      messages as any,
      {
        tools: [
          {
            name: "read_file",
            description: "Read file",
            inputSchema: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
      } as any,
      "test-key",
      4096,
      undefined,
      undefined,
      [modelInfo],
      "test-agent",
      progress,
      token,
      abortController,
    );

    const toolCalls = reportedParts.filter(
      (part): part is vscode.LanguageModelToolCallPart =>
        part instanceof vscode.LanguageModelToolCallPart,
    );
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].callId).toBe("call_abc");
    expect(toolCalls[0].name).toBe("read_file");
    expect(toolCalls[0].input).toEqual({ path: "README.md" });
  });
});
