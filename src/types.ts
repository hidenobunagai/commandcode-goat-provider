export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

export interface OcGoContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface OcGoChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OcGoContentPart[];
  name?: string;
  tool_calls?: OcGoToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface OcGoToolCall {
  id: string;
  /** Optional index used in streaming tool call deltas */
  index?: number;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OcGoTool {
  type: "function";
  function: { name: string; description?: string; parameters?: JsonObject };
}

export interface OcGoChatRequest {
  model: string;
  messages: OcGoChatMessage[];
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stream?: boolean;
  top_p?: number;
  stop?: string | string[];
  tools?: OcGoTool[];
  tool_choice?: "auto" | "none" | "required" | { type: string; function: { name: string } };
  reasoning_effort?: string;
}

export interface OcGoStreamChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
    reasoning_content?: string;
    tool_calls?: OcGoToolCall[];
  };
  finish_reason: string | null;
}

export interface OcGoStreamResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OcGoStreamChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface OcGoChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** API format used by a model */
export type CommandCodeApiFormat = "openai" | "anthropic";
export type OcGoApiFormat = CommandCodeApiFormat | "responses";

/** Reasoning effort level for models that support it. */
export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface CommandCodeApiModel {
  id: string;
  name?: string;
  context_length?: number;
}

export interface CommandCodeModelsResponse {
  object: "list";
  data: CommandCodeApiModel[];
}

export interface CommandCodeModelInfo {
  id: string;
  name: string;
  displayName: string;
  contextWindow: number;
  maxOutput: number;
  supportsTools: boolean;
  supportsVision: boolean;
  apiFormat?: CommandCodeApiFormat;
  fixedTemperature?: number;
  fixedTopP?: number;
  supportsThinking: boolean;
  supportedReasoningEfforts?: ReasoningEffort[];
  isUserSelectable: boolean;
}

export type OcGoModelInfo = Omit<CommandCodeModelInfo, "apiFormat" | "supportsThinking" | "isUserSelectable"> & {
  apiFormat?: CommandCodeApiFormat | "responses";
  supportsThinking?: boolean;
  isUserSelectable?: boolean;
};
export { FALLBACK_MODELS, inferModelInfo, REASONING_EFFORT_ORDER } from "./constants";

// ============================================================================
// Anthropic Messages API types
// Used by MiniMax M2.5 and M2.7 via OpenCode Go proxy
// ============================================================================

/** Anthropic message content block */
export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: JsonObject }
  | { type: "tool_result"; tool_use_id: string; content: string | AnthropicContentBlock[] };

/** Anthropic message format */
export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
  reasoning_content?: string;
}

/** Anthropic tool definition */
export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: JsonObject;
}

/** Anthropic request body */
export interface AnthropicRequestBody {
  model: string;
  messages: AnthropicMessage[];
  system?: string | Array<{ type: "text"; text: string }>;
  max_tokens: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  tool_choice?: "auto" | "any" | { type: "tool"; name: string };
}

/** Anthropic SSE event types */
export interface AnthropicMessageStartEvent {
  type: "message_start";
  message: {
    id: string;
    type: "message";
    role: "assistant";
    content: AnthropicContentBlock[];
    model: string;
    stop_reason: string | null;
    usage: { input_tokens: number; output_tokens: number };
  };
}

export interface AnthropicContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block: AnthropicContentBlock;
}

export interface AnthropicContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta:
    | { type: "text_delta"; text: string }
    | { type: "input_json_delta"; partial_json: string }
    | { type: "thinking_delta"; thinking: string };
}

export interface AnthropicContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

export interface AnthropicMessageDeltaEvent {
  type: "message_delta";
  delta: { stop_reason: string | null; stop_sequence: string | null };
  usage: { output_tokens: number };
}

export interface AnthropicMessageStopEvent {
  type: "message_stop";
}

export type AnthropicSSEEvent =
  | AnthropicMessageStartEvent
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent;

// ============================================================================
// OpenAI Responses API types
// Used by GPT 5.6 Luna via the OpenCode Go proxy (/responses endpoint)
// ============================================================================

/** Content part inside a Responses API message item */
export type OcGoResponsesContentPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "output_text"; text: string };

/** Input item for the Responses API */
export type OcGoResponsesInputItem =
  | {
      type: "message";
      role: "user" | "assistant";
      content: string | OcGoResponsesContentPart[];
    }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | { type: "function_call_output"; call_id: string; output: string };

/** Function tool definition for the Responses API */
export interface OcGoResponsesTool {
  type: "function";
  name: string;
  description?: string;
  parameters?: JsonObject;
}

/** Responses API request body */
export interface OcGoResponsesRequest {
  model: string;
  instructions?: string;
  input: OcGoResponsesInputItem[];
  tools?: OcGoResponsesTool[];
  tool_choice?: "auto" | "required" | "none" | { type: "function"; name: string };
  temperature?: number;
  max_output_tokens?: number;
  stream?: boolean;
  store?: boolean;
  reasoning?: { effort?: string; summary?: string };
}

/** Responses API SSE stream event */
export interface OcGoResponsesStreamEvent {
  type: string;
  item_id?: string;
  output_index?: number;
  delta?: string;
  item?: {
    id?: string;
    type?: string;
    name?: string;
    call_id?: string;
    arguments?: string;
    status?: string;
    role?: string;
  };
  response?: {
    status?: string;
    incomplete_details?: { reason?: string };
  };
  error?: { message?: string; code?: string };
}
