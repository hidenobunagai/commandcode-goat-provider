import { BASE_RETRY_DELAY_MS, BASE_URL, MAX_RETRY_DELAY_MS, REQUEST_TIMEOUT_MS } from "./constants";
import { debugLog } from "./output-channel";
import { readSseLines } from "./streaming/sse";
import {
  CommandCodeApiModel,
  OcGoChatCompletionResponse,
  OcGoChatRequest,
  OcGoStreamResponse,
} from "./types";

/**
 * Determine whether an HTTP status code is safe to retry.
 * Retries on 429 (rate limit), 502, 503, 504 (server errors).
 * Never retries on 400, 401, 403, 404, 422 (client errors).
 */
function isRetryableHttpError(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Read Retry-After header value in milliseconds.
 * Supports both seconds (integer) and HTTP-date formats.
 */
function getRetryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw) return undefined;

  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }

  const httpDate = Date.parse(raw);
  if (Number.isFinite(httpDate)) {
    const delay = httpDate - Date.now();
    return delay > 0 ? delay : undefined;
  }

  return undefined;
}

/**
 * Calculate delay with exponential backoff and full jitter.
 * This prevents thundering herd when multiple clients retry simultaneously.
 */
function calculateRetryDelay(attempt: number, retryAfter?: number): number {
  if (retryAfter !== undefined && retryAfter > 0) {
    // Add jitter to server-provided retry-after (±25%)
    // Do not cap server-provided retry-after with MAX_RETRY_DELAY_MS
    const jitter = retryAfter * 0.25 * (Math.random() * 2 - 1);
    return Math.max(Math.round(retryAfter + jitter), 0);
  }

  const exponentialDelay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
  const cappedDelay = Math.min(exponentialDelay, MAX_RETRY_DELAY_MS);
  // Full jitter: random delay between 0 and cappedDelay
  return Math.round(Math.random() * cappedDelay);
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 3,
): Promise<Response> {
  let lastError: Error | undefined;
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, init);
      if (response.ok || !isRetryableHttpError(response.status)) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
      if (i < retries - 1) {
        const retryAfter = getRetryAfterMs(response);
        const delay = calculateRetryDelay(i, retryAfter);
        debugLog(
          "fetchWithRetry",
          `Attempt ${i + 1} failed with ${response.status}, retrying after ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.name === "AbortError") {
        throw lastError;
      }
      if (i < retries - 1) {
        const delay = calculateRetryDelay(i);
        debugLog(
          "fetchWithRetry",
          `Attempt ${i + 1} failed with network error, retrying after ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError ?? new Error("Network request failed after retries");
}

export async function fetchModels(userAgent?: string): Promise<CommandCodeApiModel[]> {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), 10000);

  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(userAgent ? { "User-Agent": userAgent } : {}),
    };

    const response = await fetch(`${BASE_URL}/models`, {
      method: "GET",
      headers,
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: HTTP ${response.status} ${response.statusText}`);
    }

    const body = (await response.json()) as any;

    if (
      !body ||
      typeof body !== "object" ||
      body.object !== "list" ||
      !Array.isArray(body.data) ||
      body.data.length === 0
    ) {
      throw new Error(
        "Invalid model catalog response: expected object='list' with non-empty data array",
      );
    }

    const validatedModels: CommandCodeApiModel[] = [];
    for (const item of body.data) {
      if (
        !item ||
        typeof item !== "object" ||
        typeof item.id !== "string" ||
        item.id.trim() === "" ||
        typeof item.name !== "string" ||
        item.name.trim() === "" ||
        typeof item.context_length !== "number" ||
        !Number.isFinite(item.context_length) ||
        item.context_length <= 0
      ) {
        throw new Error(`Invalid model catalog entry: ${JSON.stringify(item)}`);
      }
      validatedModels.push({
        id: item.id,
        name: item.name,
        context_length: item.context_length,
      });
    }

    return validatedModels;
  } finally {
    clearTimeout(timeoutId);
  }
}

function buildChatCompletionHeaders(
  apiKey: string,
  userAgent?: string,
  enableZdr?: boolean,
): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(userAgent ? { "User-Agent": userAgent } : {}),
    ...(enableZdr ? { "x-cmd-zdr": "1" } : {}),
  };
}

async function createChatCompletionResponse(
  apiKey: string,
  requestBody: OcGoChatRequest,
  signal?: AbortSignal,
  userAgent?: string,
  enableZdr?: boolean,
): Promise<Response> {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;

  const payload: OcGoChatRequest = {
    ...requestBody,
    stream: true,
    stream_options: { include_usage: true },
  };

  const response = await fetchWithRetry(
    `${BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: buildChatCompletionHeaders(apiKey, userAgent, enableZdr),
      body: JSON.stringify(payload),
      signal: combinedSignal,
    },
    5,
  ).finally(() => clearTimeout(timeoutId));

  return response;
}

/** Parse a non-OK response body into a detail string (JSON error message or raw text). */
function extractErrorDetail(rawBody: string): { detail: string; errorCode?: string } {
  let detail = rawBody.trim().slice(0, 500);
  let errorCode: string | undefined;

  try {
    const body = JSON.parse(rawBody) as any;
    if (body?.error) {
      if (typeof body.error === "string") {
        detail = body.error;
      } else if (typeof body.error === "object") {
        if (body.error.message) {
          detail = String(body.error.message);
        }
        if (body.error.code) {
          errorCode = String(body.error.code);
        }
      }
    } else if (body?.message) {
      detail = String(body.message);
    }
  } catch {
    // Non-JSON body — fall through to raw text
  }
  return { detail, errorCode };
}

/** Throw a user-facing error for a failed request, with status-specific guidance. */
export async function throwApiError(response: Response, label: string): Promise<never> {
  const rawBody = await response.text();
  const { detail, errorCode } = extractErrorDetail(rawBody);
  const lowerDetail = detail.toLowerCase();
  const lowerCode = (errorCode || "").toLowerCase();

  if (
    response.status === 401 ||
    response.status === 403 ||
    lowerCode === "unauthorized" ||
    lowerCode === "authentication_error"
  ) {
    const guide =
      'Run "Command Code GOAT: Manage API Key" from the Command Palette to update your API key.';
    throw new Error(
      `Command Code GOAT API authentication failed (${response.status}). Your API key may be invalid or expired.\n${guide}\n${detail}`,
    );
  }

  if (
    response.status === 422 ||
    lowerCode === "cmd_zdr_no_providers" ||
    lowerDetail.includes("zdr")
  ) {
    throw new Error(
      `Command Code GOAT ZDR error (${response.status}): No upstream provider supports Zero Data Retention for this model. Disable ZDR or select a compatible model.\n${detail}`,
    );
  }

  if (response.status === 429 || lowerCode === "rate_limit_error") {
    const retryAfter = response.headers.get("retry-after");
    const retryInfo = retryAfter ? `Retry after ${retryAfter}. ` : "";
    throw new Error(
      `Command Code GOAT rate limit reached (429). ${retryInfo}The request will be retried automatically.\n${detail}`,
    );
  }

  if (response.status === 400) {
    if (
      lowerDetail.includes("token") &&
      (lowerDetail.includes("limit") || lowerDetail.includes("exceed"))
    ) {
      throw new Error(
        `Command Code GOAT token limit exceeded. Try reducing conversation history, splitting the request, or switching to a model with a larger context window.\n${detail}`,
      );
    }
    throw new Error(
      `Command Code GOAT API error (400): The request was invalid.\n${detail || rawBody.trim().slice(0, 500)}`,
    );
  }

  if (response.status >= 500 && response.status < 600) {
    throw new Error(
      `Command Code GOAT server error (${response.status}). The service may be experiencing issues.\n${detail}`,
    );
  }

  throw new Error(
    `${label} (${response.status} ${response.statusText})\n${detail || rawBody.trim().slice(0, 500)}`,
  );
}

export async function requestChatCompletion(
  apiKey: string,
  requestBody: OcGoChatRequest,
  signal?: AbortSignal,
  userAgent?: string,
  enableZdr?: boolean,
): Promise<OcGoChatCompletionResponse> {
  const response = await createChatCompletionResponse(
    apiKey,
    requestBody,
    signal,
    userAgent,
    enableZdr,
  );
  if (!response.ok) {
    await throwApiError(response, "Command Code GOAT API error");
  }
  return (await response.json()) as OcGoChatCompletionResponse;
}

export async function* streamChatCompletion(
  apiKey: string,
  requestBody: OcGoChatRequest,
  signal?: AbortSignal,
  userAgent?: string,
  enableZdr?: boolean,
): AsyncGenerator<OcGoStreamResponse, void, unknown> {
  const response = await createChatCompletionResponse(
    apiKey,
    requestBody,
    signal,
    userAgent,
    enableZdr,
  );

  if (!response.ok) {
    await throwApiError(response, "Command Code GOAT API error");
  }

  if (!response.body) {
    throw new Error("No response body from Command Code GOAT API");
  }

  let malformedSseCount = 0;
  const MALFORMED_SSE_WARN_THRESHOLD = 10;

  for await (const line of readSseLines(response.body)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data: ")) continue;
    const data = trimmed.slice(6);
    if (data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data) as OcGoStreamResponse;
      yield parsed;
    } catch {
      malformedSseCount++;
      debugLog("streamChatCompletion", `Malformed SSE line: ${data.slice(0, 200)}`);
    }
  }

  if (malformedSseCount >= MALFORMED_SSE_WARN_THRESHOLD) {
    debugLog(
      "streamChatCompletion",
      `Received ${malformedSseCount} malformed SSE lines (threshold: ${MALFORMED_SSE_WARN_THRESHOLD})`,
    );
  }
}
