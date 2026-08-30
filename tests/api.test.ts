import { fetchModels, fetchWithRetry, streamChatCompletion, throwApiError } from "../src/api";
import { BASE_URL } from "../src/constants";
import { OcGoStreamResponse } from "../src/types";

describe("fetchWithRetry", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the response on success", async () => {
    const response = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
    } as any;
    global.fetch = jest.fn().mockResolvedValue({
      ...response,
    });

    const result = await fetchWithRetry(`${BASE_URL}/models`, {
      method: "GET",
      headers: { Authorization: "Bearer test-key" },
    });
    expect(result).toEqual(response);
    expect(fetch).toHaveBeenCalledWith(
      `${BASE_URL}/models`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-key" }),
      }),
    );
  });

  it("returns the first non-retryable failure response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    } as any);

    const result = await fetchWithRetry(`${BASE_URL}/models`, { method: "GET" });
    expect(result.status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("fetchModels", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reads the unauthenticated live-list shape", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: "list",
          data: [{ id: "Qwen/Qwen3.8-27B", name: "Qwen 3.8 27B", context_length: 262144 }],
        }),
        { status: 200 },
      ),
    );

    await expect(fetchModels("test-agent")).resolves.toEqual([
      { id: "Qwen/Qwen3.8-27B", name: "Qwen 3.8 27B", context_length: 262144 },
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.commandcode.ai/provider/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "User-Agent": "test-agent" }),
      }),
    );
  });

  it.each([
    { object: "list", data: [] },
    { object: "object", data: [{ id: "model", name: "Model", context_length: 1 }] },
    { object: "list", data: [{ id: "", name: "Model", context_length: 1 }] },
    { object: "list", data: [{ id: "model", name: "", context_length: 1 }] },
    { object: "list", data: [{ id: "model", name: "Model", context_length: 0 }] },
    { object: "list", data: [{ id: "model", name: "Model", context_length: -100 }] },
    { object: "list", data: [{ id: "model", name: "Model", context_length: NaN }] },
    { object: "list", data: "not-an-array" },
  ])("rejects invalid model catalog %#", async (body) => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await expect(fetchModels()).rejects.toThrow();
  });

  it("throws on non-200 status", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response("Service Unavailable", { status: 503, statusText: "Service Unavailable" }),
    );
    await expect(fetchModels()).rejects.toThrow();
  });
});

describe("throwApiError", () => {
  it("normalizes standard error envelope", async () => {
    const response = new Response(
      JSON.stringify({
        error: { type: "authentication_error", message: "Invalid API key" },
      }),
      { status: 401, statusText: "Unauthorized" },
    );

    await expect(throwApiError(response, "Command Code API error")).rejects.toThrow(
      "authentication failed",
    );
  });

  it("normalizes Command Code success-false authentication errors", async () => {
    const response = new Response(
      JSON.stringify({
        success: false,
        error: { code: "UNAUTHORIZED", status: 401, message: "Invalid token" },
      }),
      { status: 401, statusText: "Unauthorized" },
    );

    await expect(throwApiError(response, "Command Code API error")).rejects.toThrow(
      "authentication failed",
    );
  });

  it("includes manage command in 401 guidance", async () => {
    const response = new Response(
      JSON.stringify({
        error: { message: "Invalid key" },
      }),
      { status: 401, statusText: "Unauthorized" },
    );

    await expect(throwApiError(response, "Command Code API error")).rejects.toThrow(
      "Command Code GOAT: Manage API Key",
    );
  });

  it("normalizes 422 cmd_zdr_no_providers errors", async () => {
    const response = new Response(
      JSON.stringify({
        error: { code: "cmd_zdr_no_providers", message: "No upstream provider supports ZDR for this model" },
      }),
      { status: 422, statusText: "Unprocessable Entity" },
    );

    await expect(throwApiError(response, "Command Code API error")).rejects.toThrow(
      "ZDR",
    );
  });
});

describe("streamChatCompletion", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sends ZDR only when enabled", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response("data: [DONE]\n\n", { status: 200 }),
    );

    for await (const _chunk of streamChatCompletion(
      "secret",
      { model: "deepseek/deepseek-v4-flash", messages: [], stream: true },
      undefined,
      "test-agent",
      true,
    )) {
      void _chunk;
    }

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.commandcode.ai/provider/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer secret",
          "x-cmd-zdr": "1",
        }),
      }),
    );
  });

  it("does not send ZDR when disabled", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response("data: [DONE]\n\n", { status: 200 }),
    );

    for await (const _chunk of streamChatCompletion(
      "secret",
      { model: "deepseek/deepseek-v4-flash", messages: [], stream: true },
      undefined,
      "test-agent",
      false,
    )) {
      void _chunk;
    }

    const headers = (global.fetch as jest.Mock).mock.calls[0][1].headers;
    expect(headers["x-cmd-zdr"]).toBeUndefined();
  });

  it("yields parsed SSE chunks", async () => {
    const chunk: OcGoStreamResponse = {
      id: "1",
      object: "chat.completion.chunk",
      created: 1,
      model: "deepseek/deepseek-v4-flash",
      choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
    };
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: stream,
    } as any);

    const gen = streamChatCompletion("key", { model: "deepseek/deepseek-v4-flash", messages: [], stream: true });
    const results: OcGoStreamResponse[] = [];
    for await (const item of gen) {
      results.push(item);
    }

    expect(results).toHaveLength(1);
    expect(results[0].choices[0].delta.content).toBe("Hello");
  });

  it("throws on non-ok response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "Server error",
    } as any);

    const gen = streamChatCompletion("key", { model: "deepseek/deepseek-v4-flash", messages: [], stream: true });
    await expect(gen.next()).rejects.toThrow("Command Code GOAT server error (500)");
  });

  it("throws authentication error on 401", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Invalid key",
    } as any);

    const gen = streamChatCompletion("key", { model: "deepseek/deepseek-v4-flash", messages: [], stream: true });
    await expect(gen.next()).rejects.toThrow("Command Code GOAT API authentication failed (401)");
  });

  it("retries on 429 and eventually throws after exhausting retries", async () => {
    const originalSetTimeout = global.setTimeout;
    global.setTimeout = ((cb: () => void) => cb()) as any;

    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      headers: { get: (name: string) => (name === "retry-after" ? "0" : null) },
      text: async () => "Rate limited",
    } as any);

    try {
      const gen = streamChatCompletion("key", { model: "deepseek/deepseek-v4-flash", messages: [], stream: true });
      await expect(gen.next()).rejects.toThrow("HTTP 429");
      expect(fetch).toHaveBeenCalledTimes(5);
    } finally {
      global.setTimeout = originalSetTimeout;
    }
  });

  it("retries on network failure and succeeds", async () => {
    const response = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
    } as any;
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce(response);

    const result = await fetchWithRetry(`${BASE_URL}/models`, { method: "GET" });
    expect(result).toEqual(response);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries up to 3 times then throws", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

    await expect(fetchWithRetry(`${BASE_URL}/models`, { method: "GET" })).rejects.toThrow(
      "Network error",
    );
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("retries on 429 with Retry-After then succeeds", async () => {
    const response = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
    } as any;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: { get: (name: string) => (name === "retry-after" ? "1" : null) },
      } as any)
      .mockResolvedValueOnce(response);

    const result = await fetchWithRetry(`${BASE_URL}/models`, { method: "GET" });
    expect(result).toEqual(response);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("retries on 503 then succeeds", async () => {
    const response = {
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
    } as any;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: { get: () => null },
      } as any)
      .mockResolvedValueOnce(response);

    const result = await fetchWithRetry(`${BASE_URL}/models`, { method: "GET" });
    expect(result).toEqual(response);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry on 401", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    } as any);

    const result = await fetchWithRetry(`${BASE_URL}/models`, { method: "GET" });
    expect(result.status).toBe(401);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("handles partial lines across chunks", async () => {
    const chunk: OcGoStreamResponse = {
      id: "1",
      object: "chat.completion.chunk",
      created: 1,
      model: "deepseek/deepseek-v4-flash",
      choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
    };
    const encoder = new TextEncoder();
    const jsonStr = JSON.stringify(chunk);
    const part1 = `data: ${jsonStr.slice(0, 10)}`;
    const part2 = `${jsonStr.slice(10)}\n\n`;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(part1));
        controller.enqueue(encoder.encode(part2));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: stream,
    } as any);

    const gen = streamChatCompletion("key", { model: "deepseek/deepseek-v4-flash", messages: [], stream: true });
    const results: OcGoStreamResponse[] = [];
    for await (const item of gen) {
      results.push(item);
    }

    expect(results).toHaveLength(1);
    expect(results[0].choices[0].delta.content).toBe("Hello");
  });

  it("skips malformed JSON lines", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: {invalid json}\n\n"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      body: stream,
    } as any);

    const gen = streamChatCompletion("key", { model: "deepseek/deepseek-v4-flash", messages: [], stream: true });
    const results: OcGoStreamResponse[] = [];
    for await (const item of gen) {
      results.push(item);
    }

    expect(results).toHaveLength(0);
  });

  it("detects token limit errors in 400 responses", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () =>
        JSON.stringify({
          error: {
            message: "Token limit exceeded. Max tokens: 65536",
            type: "token_limit_exceeded",
          },
        }),
    } as any);

    const gen = streamChatCompletion("key", { model: "deepseek/deepseek-v4-flash", messages: [], stream: true });
    await expect(gen.next()).rejects.toThrow("token limit exceeded");
  });

  it("parses structured JSON error bodies for detail", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => JSON.stringify({ error: { message: "Model not found: unknown-model" } }),
    } as any);

    const gen = streamChatCompletion("key", { model: "deepseek/deepseek-v4-flash", messages: [], stream: true });
    await expect(gen.next()).rejects.toThrow("Model not found");
  });
});

