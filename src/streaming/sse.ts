// streaming/sse.ts — shared SSE response body reader
import { STREAM_READ_TIMEOUT_MS } from "../constants";
import { debugLog } from "../output-channel";

/** 1 MB safety cap on the line assembly buffer. */
const MAX_SSE_BUFFER_SIZE = 1024 * 1024;

/**
 * Thrown when no chunk arrives within the per-read timeout.
 *
 * A stalled stream must not be mistaken for a clean end-of-stream: callers
 * previously saw a normal generator return, so a response cut off mid-way
 * was finalized as if it had completed (or surfaced as a generic
 * "no visible response" fallback) and the handlers' retry logic — which
 * keys off errors and finish reasons — never got the chance to run.
 * Throwing lets the OpenAI / Anthropic handlers treat the stall as the
 * failed attempt it is.  The name is deliberately distinct from
 * "AbortError" / "TimeoutError" so user cancellation handling does not
 * swallow it.
 */
export class SseReadTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`SSE stream stalled: no data received within ${timeoutMs}ms`);
    this.name = "SseReadTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Read an SSE response body line by line.
 *
 * Shared by the OpenAI and Anthropic streaming paths.  Handles the per-read
 * timeout (a stalled stream is cancelled and surfaced as an
 * {@link SseReadTimeoutError} so the caller can treat the attempt as
 * failed instead of complete), the buffer safety cap, and final-buffer
 * flushing.  Yields raw lines; callers are responsible for interpreting
 * `data:` prefixes, `[DONE]` markers, and JSON parsing.
 */
export async function* readSseLines(
  body: ReadableStream<Uint8Array>,
  timeoutMs: number = STREAM_READ_TIMEOUT_MS,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      // Race reader.read() against a per-read timeout so the generator
      // never hangs indefinitely on a stalled connection.
      let readTimedOut = false;
      const readPromise = reader.read();
      const timeoutId = setTimeout(() => {
        readTimedOut = true;
        reader.cancel().catch(() => {});
      }, timeoutMs);

      const { done, value } = await readPromise;
      clearTimeout(timeoutId);

      if (readTimedOut) {
        debugLog("readSseLines", "Stream read timed out — cancelling");
        throw new SseReadTimeoutError(timeoutMs);
      }

      if (done) break;

      const text = decoder.decode(value, { stream: true });
      if (buffer.length + text.length > MAX_SSE_BUFFER_SIZE) {
        debugLog("readSseLines", "SSE buffer exceeded 1 MB — flushing");
        buffer = "";
      }
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        yield line;
      }
    }

    // Flush decoder internal state and emit any remaining lines
    buffer += decoder.decode();
    for (const line of buffer.split("\n")) {
      yield line;
    }
  } finally {
    reader.releaseLock();
  }
}
