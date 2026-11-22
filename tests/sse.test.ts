import { readSseLines, SseReadTimeoutError } from "../src/streaming/sse";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const lines: string[] = [];
  for await (const line of gen) {
    lines.push(line);
  }
  return lines;
}

describe("readSseLines", () => {
  it("yields complete lines and flushes a final line without a trailing newline", async () => {
    const lines = await collect(readSseLines(streamFromChunks(["data: a\nda", "ta: b\ndata: c"])));
    expect(lines).toEqual(["data: a", "data: b", "data: c"]);
  });

  it("returns normally on an empty stream", async () => {
    const lines = await collect(readSseLines(streamFromChunks([])));
    expect(lines).toEqual([""]);
  });

  it("throws SseReadTimeoutError instead of ending silently when the stream stalls", async () => {
    const encoder = new TextEncoder();
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: first\n"));
        // Never enqueue or close again: the next read stalls forever.
      },
    });

    const lines: string[] = [];
    await expect(
      (async () => {
        for await (const line of readSseLines(stalled, 20)) {
          lines.push(line);
        }
      })(),
    ).rejects.toBeInstanceOf(SseReadTimeoutError);

    // Lines delivered before the stall are still yielded first.
    expect(lines).toEqual(["data: first"]);
  });

  it("exposes the timeout on the error so callers can log or branch on it", async () => {
    const stalled = new ReadableStream<Uint8Array>({
      start() {
        // Stall from the very first read.
      },
    });

    const error = await collect(readSseLines(stalled, 15)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SseReadTimeoutError);
    expect((error as SseReadTimeoutError).name).toBe("SseReadTimeoutError");
    expect((error as SseReadTimeoutError).timeoutMs).toBe(15);
    expect((error as Error).message).toContain("15ms");
  });
});
