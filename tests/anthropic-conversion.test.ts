import * as vscode from "vscode";
import { convertMessagesToAnthropic, convertToolsToAnthropic } from "../src/anthropic-conversion";

const userMessage = (text: string) => ({
  role: vscode.LanguageModelChatMessageRole.User,
  content: [new vscode.LanguageModelTextPart(text)],
});
const assistantMessageWithTool = (name: string, input: Record<string, unknown>, callId: string) => ({
  role: vscode.LanguageModelChatMessageRole.Assistant,
  content: [new vscode.LanguageModelToolCallPart(callId, name, input)],
});
const userMessageWithToolResult = (callId: string, text: string) => ({
  role: vscode.LanguageModelChatMessageRole.User,
  content: [new vscode.LanguageModelToolResultPart(callId, [new vscode.LanguageModelTextPart(text)])],
});

describe("convertMessagesToAnthropic", () => {
  test("extracts system message separately", () => {
    const result = convertMessagesToAnthropic([
      {
        role: (vscode as any).LanguageModelChatMessageRole.System,
        content: [new vscode.LanguageModelTextPart("You are Claude.")],
      },
      userMessage("Hello"),
    ] as any);

    expect(result.system).toBe("You are Claude.");
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
  });

  test("consecutive same-role messages are merged", () => {
    const result = convertMessagesToAnthropic([
      userMessage("Part 1"),
      userMessage("Part 2"),
    ] as any);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].role).toBe("user");
  });

  test("converts an image to an Anthropic base64 block", () => {
    const result = convertMessagesToAnthropic([
      {
        role: vscode.LanguageModelChatMessageRole.User,
        content: [
          new vscode.LanguageModelTextPart("Inspect this image"),
          { mimeType: "image/png", data: new Uint8Array([1, 2, 3]) },
        ],
      },
    ] as any);

    expect(result.messages[0].content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "image",
          source: expect.objectContaining({ media_type: "image/png", data: "AQID" }),
        }),
      ]),
    );
  });

  test("converts a Claude conversation to Anthropic tool blocks", () => {
    const result = convertMessagesToAnthropic([
      userMessage("Inspect this file"),
      assistantMessageWithTool("read_file", { path: "README.md" }, "call-1"),
      userMessageWithToolResult("call-1", "file contents"),
    ] as any);

    expect(result.messages).toHaveLength(3);
    expect(result.messages[1].content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "tool_use", id: "call-1", name: "read_file" })]),
    );
    expect(result.messages[2].content).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "tool_result", tool_use_id: "call-1" })]),
    );
  });
});

describe("convertToolsToAnthropic", () => {
  test("converts VS Code tools to Anthropic schema", () => {
    const result = convertToolsToAnthropic({
      tools: [
        {
          name: "fetch_weather",
          description: "Get weather for a city",
          inputSchema: { type: "object", properties: { city: { type: "string" } } },
        },
      ],
    } as any);

    expect(result.tools).toHaveLength(1);
    expect(result.tools?.[0].name).toBe("fetch_weather");
    expect(result.tool_choice).toBe("auto");
  });
});
