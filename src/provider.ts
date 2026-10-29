import * as vscode from "vscode";
import {
  CancellationToken,
  Event,
  EventEmitter,
  LanguageModelChatInformation,
  LanguageModelChatMessage,
  LanguageModelChatProvider,
  LanguageModelChatRequestMessage,
  LanguageModelResponsePart,
  PrepareLanguageModelChatModelOptions,
  Progress,
  ProvideLanguageModelChatResponseOptions,
} from "vscode";
import { fetchModels, requestSystemOne } from "./api";
import {
  AUTO_DEFAULT_CONTEXT_WINDOW,
  AUTO_MODEL_ID,
  AutoRouter,
  escalateForInput,
  type JevRequestBody,
  resolvePool,
  type RouterMessage,
} from "./auto-router";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  FALLBACK_MODELS,
  getContextWindowSafetyMargin,
  inferModelInfo,
  REASONING_EFFORT_ORDER,
  THINKING_MODELS,
} from "./constants";
import { extractImageData, getTextPartValue } from "./message-parts";
import { debugLog } from "./output-channel";
import { handleAnthropicRequest } from "./streaming/anthropic";
import { processOpenAIStream, type OpenAIModelInfo } from "./streaming/openai";
import { estimateMessagesTokens, estimateTokens } from "./tokenizer";
import { CommandCodeModelInfo, ReasoningEffort } from "./types";

/** Picker token limits for a model; shared by the model list and GOAT Auto routing. */
function chatTokenLimits(info: Pick<CommandCodeModelInfo, "contextWindow" | "maxOutput">): {
  maxInputTokens: number;
  maxOutputTokens: number;
} {
  return {
    maxInputTokens: Math.max(
      1,
      info.contextWindow - Math.min(info.maxOutput, DEFAULT_MAX_OUTPUT_TOKENS),
    ),
    maxOutputTokens: info.maxOutput,
  };
}

/**
 * GOAT Auto as a synthetic catalog entry, so every surface lists it through the same path as
 * real models. It has no apiFormat: it is never dispatched directly or offered as a pool member.
 */
const AUTO_MODEL_INFO: CommandCodeModelInfo = {
  id: AUTO_MODEL_ID,
  name: "GOAT Auto",
  displayName: "GOAT Auto",
  contextWindow: AUTO_DEFAULT_CONTEXT_WINDOW,
  maxOutput: DEFAULT_MAX_OUTPUT_TOKENS,
  supportsTools: true,
  supportsVision: true,
  supportsThinking: true,
  supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
  isUserSelectable: true,
};

/** Catalog models plus GOAT Auto (appended once, even if the catalog already lists its id). */
function withAutoModel(models: CommandCodeModelInfo[]): CommandCodeModelInfo[] {
  return [...models.filter((m) => m.id !== AUTO_MODEL_ID), AUTO_MODEL_INFO];
}

/** Input budget after the context-window safety margin (the pre-check limit). */
function effectiveInputLimit(limits: { maxInputTokens: number; maxOutputTokens: number }): number {
  const safetyMargin = getContextWindowSafetyMargin(limits.maxInputTokens + limits.maxOutputTokens);
  return Math.max(1, limits.maxInputTokens - safetyMargin);
}

export class CommandCodeChatModelProvider implements LanguageModelChatProvider {
  private readonly _onDidChangeLanguageModelChatInformation = new EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation: Event<void> =
    this._onDidChangeLanguageModelChatInformation.event;

  private readonly _onDidCompleteResponse = new EventEmitter<void>();
  /** Fires after every chat response completes (success or error). */
  readonly onDidCompleteResponse: Event<void> = this._onDidCompleteResponse.event;

  private readonly _modelMap = new Map<string, CommandCodeModelInfo>();
  private _models: CommandCodeModelInfo[] = withAutoModel(FALLBACK_MODELS);
  private _modelsFetched = false;
  private readonly _autoRouter = new AutoRouter((body, signal) => this.runJev(body, signal));

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly userAgent: string,
  ) {
    for (const m of this._models) {
      this._modelMap.set(m.id, m);
    }
    void this.fetchModels();
  }

  fireModelInfoChanged(): void {
    void this.fetchModels().then(() => {
      this._onDidChangeLanguageModelChatInformation.fire();
    });
  }

  /** Models that can be dispatched (candidates for the GOAT Auto pool). */
  getSelectableModels(): CommandCodeModelInfo[] {
    return this._models
      .map((m) => this._modelMap.get(m.id) ?? m)
      .filter((m) => m.isUserSelectable !== false && !!m.apiFormat);
  }

  private async fetchModels(): Promise<void> {
    try {
      const apiModels = await fetchModels(this.userAgent);
      const fetchedModels: CommandCodeModelInfo[] = apiModels.map((item) => inferModelInfo(item));
      this._models = withAutoModel(fetchedModels);
      this._modelMap.clear();
      for (const m of this._models) {
        this._modelMap.set(m.id, m);
      }
      this._modelsFetched = true;
      debugLog("fetchModels", `Successfully fetched ${fetchedModels.length} models dynamically.`);
    } catch (error) {
      debugLog("fetchModelsError", `Failed to fetch dynamic models: ${error}. Using fallbacks.`);
    }
  }

  private getConfiguredApiKeyState(configuration: unknown): {
    hasApiKeyProperty: boolean;
    apiKey?: string;
  } {
    if (!configuration || typeof configuration !== "object") {
      return { hasApiKeyProperty: false };
    }

    const configurationRecord = configuration as { apiKey?: unknown };
    if (!("apiKey" in configurationRecord)) {
      return { hasApiKeyProperty: false };
    }

    const apiKey = configurationRecord.apiKey;
    if (typeof apiKey !== "string") {
      return { hasApiKeyProperty: true };
    }

    const normalizedApiKey = apiKey.trim();
    return {
      hasApiKeyProperty: true,
      apiKey: normalizedApiKey || undefined,
    };
  }

  private async syncConfiguredApiKey(options: unknown): Promise<string | undefined> {
    if (!options || typeof options !== "object") {
      return undefined;
    }

    const optionsRecord = options as { configuration?: unknown; modelConfiguration?: unknown };
    const modelConfigurationState = this.getConfiguredApiKeyState(optionsRecord.modelConfiguration);
    const providerConfigurationState = this.getConfiguredApiKeyState(optionsRecord.configuration);
    const hasExplicitApiKeyProperty =
      modelConfigurationState.hasApiKeyProperty || providerConfigurationState.hasApiKeyProperty;
    if (!hasExplicitApiKeyProperty) {
      return undefined;
    }

    const configuredApiKey = modelConfigurationState.apiKey ?? providerConfigurationState.apiKey;
    const storedApiKey = await this.secrets.get("commandcode-goat.apiKey");
    if (!configuredApiKey) {
      if (storedApiKey !== undefined) {
        await this.secrets.delete("commandcode-goat.apiKey");
      }
      return undefined;
    }

    if (storedApiKey !== configuredApiKey) {
      await this.secrets.store("commandcode-goat.apiKey", configuredApiKey);
    }

    return configuredApiKey;
  }

  private getModelInfo(modelId: string): CommandCodeModelInfo | undefined {
    return this._modelMap.get(modelId);
  }

  private resolveApiModelId(modelId: string): string {
    // Exact registered ids (e.g. "inclusionai/ling-3.0-flash-sante:free") are real API ids, not
    // IDE-appended variants — never strip their suffix.
    if (this._modelMap.has(modelId)) return modelId;
    const colonIndex = modelId.indexOf(":");
    return colonIndex > 0 ? modelId.slice(0, colonIndex) : modelId;
  }

  async provideLanguageModelChatInformation(
    options: PrepareLanguageModelChatModelOptions,
    token: CancellationToken,
  ): Promise<LanguageModelChatInformation[]> {
    if (token.isCancellationRequested) return [];
    try {
      await this.syncConfiguredApiKey(options);
      if (!this._modelsFetched) {
        await this.fetchModels();
      }
      const models = this._mapToChatInformation(this._models);
      debugLog("provideLanguageModelChatInformation", {
        silent: options.silent,
        modelCount: models.length,
      });
      return models;
    } catch (error) {
      debugLog("provideLanguageModelChatInformationError", error);
      const models = this._mapToChatInformation(this._models);
      debugLog("provideLanguageModelChatInformationFallback", {
        modelCount: models.length,
      });
      return models;
    }
  }

  private _mapToChatInformation(
    models: Array<{ id: string; name: string }>,
  ): LanguageModelChatInformation[] {
    return models.map((model) => {
      const info: CommandCodeModelInfo = this._modelMap.get(model.id) ?? inferModelInfo(model.id);

      const tooltipParts: string[] = [`Command Code GOAT — ${info.name}`];
      if (info.supportsThinking) {
        tooltipParts.push("Thinking Effort: configurable");
      }
      if (info.supportsVision) {
        tooltipParts.push("Vision: supported");
      }
      if (info.contextWindow >= 1000000) {
        tooltipParts.push("Context: 1M tokens");
      } else {
        tooltipParts.push(`Context: ${Math.round(info.contextWindow / 1000)}K tokens`);
      }
      if (info.apiFormat === "anthropic") {
        tooltipParts.push("API: Anthropic format");
      }

      return {
        id: info.id,
        name: info.displayName,
        detail: "Command Code GOAT",
        tooltip: tooltipParts.join(" · "),
        family: "commandcode-goat",
        version: "1.0.0",
        isUserSelectable: info.isUserSelectable !== false,
        ...chatTokenLimits(info),
        capabilities: {
          toolCalling: info.supportsTools,
          imageInput: info.supportsVision,
        },
        ...(info.supportsThinking
          ? (() => {
              const supported = info.supportedReasoningEfforts;
              const order = REASONING_EFFORT_ORDER;
              const efforts: ReasoningEffort[] =
                supported && supported.length > 0
                  ? [...supported].sort((a, b) => order.indexOf(a) - order.indexOf(b))
                  : (["low", "medium", "high", "max"] as ReasoningEffort[]);
              const labels: Record<ReasoningEffort, string> = {
                minimal: "Minimal",
                low: "Low",
                medium: "Medium",
                high: "High",
                xhigh: "XHigh",
                max: "Max",
              };
              const descriptions: Record<ReasoningEffort, string> = {
                minimal: "Minimal reasoning effort",
                low: "Low reasoning effort",
                medium: "Medium reasoning effort",
                high: "High reasoning effort",
                xhigh: "Maximum reasoning effort (xhigh)",
                max: "Maximum reasoning effort",
              };
              const enumValues = ["default", ...efforts];
              const enumItemLabels = ["Default", ...efforts.map((e) => labels[e])];
              const enumDescriptions = [
                "Let the model decide the reasoning effort",
                ...efforts.map((e) => descriptions[e]),
              ];
              return {
                configurationSchema: {
                  properties: {
                    reasoningEffort: {
                      type: "string",
                      title: "Thinking Effort",
                      enum: enumValues,
                      enumItemLabels,
                      enumDescriptions,
                      default: "default",
                      group: "navigation",
                    },
                  },
                },
              };
            })()
          : {}),
      };
    });
  }

  private _autoPool(): CommandCodeModelInfo[] {
    const poolIds = vscode.workspace
      .getConfiguration("commandcode-goat")
      .get<string[]>("auto.pool", []);
    // resolvePool drops AUTO_MODEL_ID, so a hand-edited pool cannot make GOAT Auto route to itself.
    return resolvePool(Array.isArray(poolIds) ? poolIds : [], this._modelMap);
  }

  private _toRouterMessages(messages: readonly LanguageModelChatMessage[]): RouterMessage[] {
    return messages.map((message) => {
      const texts: string[] = [];
      let hasImage = false;
      for (const part of message.content) {
        const text = getTextPartValue(part as never);
        if (text !== undefined) {
          texts.push(text);
        } else if (extractImageData(part as never)) {
          hasImage = true;
        }
      }
      const role =
        message.role === vscode.LanguageModelChatMessageRole.User
          ? "user"
          : message.role === vscode.LanguageModelChatMessageRole.Assistant
            ? "assistant"
            : "other";
      return { role, text: texts.join("\n"), hasImage };
    });
  }

  /** GOAT Auto judgment: one Jev call with the user's Command Code API key. */
  private async runJev(body: JevRequestBody, signal: AbortSignal): Promise<unknown> {
    // ensureApiKey() has already stored the key (configured or entered) before routing runs.
    const apiKey = (await this.secrets.get("commandcode-goat.apiKey"))?.trim();
    if (!apiKey) throw new Error("API key unavailable for Jev");
    const enableZdr = vscode.workspace
      .getConfiguration("commandcode-goat")
      .get<boolean>("enableZdr", false);
    return requestSystemOne(apiKey, body, signal, this.userAgent, enableZdr);
  }

  async provideLanguageModelChatResponse(
    model: LanguageModelChatInformation,
    messages: readonly LanguageModelChatMessage[],
    options: ProvideLanguageModelChatResponseOptions,
    progress: Progress<LanguageModelResponsePart>,
    token: CancellationToken,
  ): Promise<void> {
    const abortController = new AbortController();
    const cancellationSubscription = token.onCancellationRequested(() => abortController.abort());

    try {
      const [apiKey, inputTokenCount] = await Promise.all([
        this.ensureApiKey(options, false),
        Promise.resolve(estimateMessagesTokens(messages as never)),
      ]);
      if (!apiKey) {
        progress.report(
          new vscode.LanguageModelTextPart(
            'Command Code GOAT API key is not configured. Add or configure Command Code GOAT from the chat model picker, run "Command Code GOAT: Manage API Key" from the Command Palette, or retry this request and enter the key when prompted.',
          ),
        );
        return;
      }

      // The model actually dispatched: the picked one, or GOAT Auto's routed choice.
      let target: { id: string; maxInputTokens: number; maxOutputTokens: number } = model;
      let routedEffort: string | undefined;
      let autoNote: { displayName: string; via: string } | undefined;
      if (model.id === AUTO_MODEL_ID) {
        const pool = this._autoPool();
        if (pool.length === 0) {
          progress.report(
            new vscode.LanguageModelTextPart(
              'GOAT Auto has no models to route between. Run "Command Code GOAT: Configure GOAT Auto Pool" from the Command Palette, or set `commandcode-goat.auto.pool` to a list of Command Code model ids.',
            ),
          );
          return;
        }
        const decision = await this._autoRouter.route({
          messages: this._toRouterMessages(messages),
          pool,
          signal: abortController.signal,
        });
        const routed = pool.find((m) => m.id === decision.modelId) ?? pool[0];
        const chosen = escalateForInput(routed, pool, inputTokenCount, (m) =>
          effectiveInputLimit(chatTokenLimits(m)),
        );
        target = { id: chosen.id, ...chatTokenLimits(chosen) };
        routedEffort = decision.effort;
        autoNote = {
          displayName: chosen.displayName,
          via: decision.via === "jev" ? "Jev" : "heuristic",
        };
        debugLog("goatAuto", {
          model: chosen.id,
          effort: decision.effort ?? "default",
          via: decision.via,
          ...(decision.modelVia ? { modelVia: decision.modelVia } : {}),
          ...(decision.effortVia ? { effortVia: decision.effortVia } : {}),
          ...(chosen.id !== routed.id ? { escalatedFrom: routed.id } : {}),
          ...(decision.note ? { note: decision.note } : {}),
        });
      }

      const maxInputTokens = target.maxInputTokens;
      const modelContextWindow = maxInputTokens + target.maxOutputTokens;
      const safetyMargin = getContextWindowSafetyMargin(modelContextWindow);
      const effectiveMaxInputTokens = Math.max(1, maxInputTokens - safetyMargin);

      if (inputTokenCount > effectiveMaxInputTokens) {
        throw new Error(
          `Message exceeds token limit (${inputTokenCount} > ${effectiveMaxInputTokens}). Try reducing the conversation history or switching to a model with a larger context window.`,
        );
      }

      const maxTokensVal = (options.modelOptions as Record<string, unknown>)?.max_tokens;
      const requestedMaxTokens = Math.min(
        typeof maxTokensVal === "number" ? maxTokensVal : DEFAULT_MAX_OUTPUT_TOKENS,
        target.maxOutputTokens,
      );

      const MIN_THINKING_MODEL_OUTPUT_TOKENS = 16384;
      const resolvedModelId = this.resolveApiModelId(target.id);
      const isThinkingModel = THINKING_MODELS.has(resolvedModelId);
      const effectiveMaxTokens = isThinkingModel
        ? Math.max(
            requestedMaxTokens,
            Math.min(MIN_THINKING_MODEL_OUTPUT_TOKENS, target.maxOutputTokens),
          )
        : requestedMaxTokens;

      const effectiveMessages = messages;
      const effectiveModelId = this.resolveApiModelId(target.id);
      const effectiveModelInfo = this.getModelInfo(effectiveModelId);
      const variantModelInfo = this.getModelInfo(target.id);

      if (
        !effectiveModelInfo ||
        effectiveModelInfo.isUserSelectable === false ||
        !effectiveModelInfo.apiFormat
      ) {
        throw new Error(`Model ${target.id} is not supported or not selectable.`);
      }

      const apiFormat = effectiveModelInfo.apiFormat;
      const modelConfig = (options as unknown as Record<string, unknown>).modelConfiguration as
        Record<string, unknown> | undefined;
      const configuredEffort =
        typeof modelConfig?.reasoningEffort === "string"
          ? (modelConfig.reasoningEffort as string)
          : undefined;
      // On GOAT Auto, an explicit Thinking Effort pick overrides the router's effort.
      const rawReasoningEffort =
        model.id === AUTO_MODEL_ID && (!configuredEffort || configuredEffort === "default")
          ? routedEffort
          : configuredEffort;
      let reasoningEffort: string | undefined =
        rawReasoningEffort === "default" ? undefined : rawReasoningEffort;

      if (reasoningEffort && effectiveModelInfo.supportedReasoningEfforts) {
        const supported = effectiveModelInfo.supportedReasoningEfforts as string[];
        if (!supported.includes(reasoningEffort)) {
          if (reasoningEffort === "max" && supported.includes("xhigh")) {
            reasoningEffort = "xhigh";
          } else if (reasoningEffort === "xhigh" && supported.includes("max")) {
            reasoningEffort = "max";
          } else {
            debugLog(
              "provideLanguageModelChatResponse",
              `Dropping unsupported reasoningEffort "${reasoningEffort}" for ${effectiveModelId} (supported: ${supported.join(",")})`,
            );
            reasoningEffort = undefined;
          }
        }
      } else if (reasoningEffort && !effectiveModelInfo.supportsThinking) {
        debugLog(
          "provideLanguageModelChatResponse",
          `Dropping reasoningEffort "${reasoningEffort}" for non-thinking model ${effectiveModelId}`,
        );
        reasoningEffort = undefined;
      }
      const temperatureVal =
        typeof variantModelInfo?.fixedTemperature === "number"
          ? variantModelInfo.fixedTemperature
          : typeof (options.modelOptions as Record<string, unknown>)?.temperature === "number"
            ? ((options.modelOptions as Record<string, unknown>).temperature as number)
            : undefined;
      const topPVal = variantModelInfo?.fixedTopP;

      const enableZdr = vscode.workspace
        .getConfiguration("commandcode-goat")
        .get<boolean>("enableZdr", false);

      // The chat UI shows only "GOAT Auto", so name the model that actually serves the turn.
      // The anthropic path sends no effort, so the effort shown there is "default".
      if (autoNote) {
        const shownEffort = (apiFormat === "anthropic" ? undefined : reasoningEffort) ?? "default";
        progress.report(
          new vscode.LanguageModelTextPart(
            `*GOAT Auto → ${autoNote.displayName}（effort: ${shownEffort} · ${autoNote.via}）*\n\n`,
          ),
        );
      }

      if (apiFormat === "anthropic") {
        await handleAnthropicRequest({
          modelId: effectiveModelId,
          messages: effectiveMessages,
          options,
          apiKey,
          requestedMaxTokens: effectiveMaxTokens,
          temperatureVal,
          topPVal,
          userAgent: this.userAgent,
          fallbackModels: FALLBACK_MODELS,
          progress,
          token,
          abortController,
          enableZdr,
        });
        return;
      }

      const openAIModel: OpenAIModelInfo = {
        id: effectiveModelId,
        modelInfo: effectiveModelInfo,
        maxOutputTokens: target.maxOutputTokens,
      };

      await processOpenAIStream(
        openAIModel,
        effectiveMessages,
        options,
        apiKey,
        effectiveMaxTokens,
        temperatureVal,
        topPVal,
        FALLBACK_MODELS,
        this.userAgent,
        progress,
        token,
        abortController,
        reasoningEffort,
        enableZdr,
      );
    } catch (err) {
      if (token.isCancellationRequested) {
        throw new vscode.CancellationError();
      }
      if (err instanceof vscode.CancellationError) {
        throw err;
      }
      if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
        throw new vscode.CancellationError();
      }
      throw err;
    } finally {
      cancellationSubscription.dispose();
      this._onDidCompleteResponse.fire();
    }
  }

  provideTokenCount(
    _model: LanguageModelChatInformation,
    text: string | LanguageModelChatRequestMessage,
    _token: CancellationToken,
  ): Promise<number> {
    if (typeof text === "string") {
      return Promise.resolve(estimateTokens(text));
    }
    const textParts: string[] = [];
    for (const part of text.content) {
      const value = getTextPartValue(part as never);
      if (value !== undefined) {
        textParts.push(value);
      }
    }
    if (textParts.length === 0) {
      return Promise.resolve(2 * text.content.length);
    }
    return Promise.resolve(estimateTokens(textParts.join(" ")));
  }

  private async ensureApiKey(options: unknown, silent: boolean): Promise<string | undefined> {
    const configuredApiKey = await this.syncConfiguredApiKey(options);
    if (configuredApiKey) {
      return configuredApiKey;
    }

    let apiKey = (await this.secrets.get("commandcode-goat.apiKey"))?.trim();
    if (!apiKey && !silent) {
      const entered = await vscode.window.showInputBox({
        title: "Command Code GOAT API Key",
        prompt: "Enter your Command Code GOAT API key",
        ignoreFocusOut: true,
        password: true,
      });
      if (entered && entered.trim()) {
        apiKey = entered.trim();
        await this.secrets.store("commandcode-goat.apiKey", apiKey);
      }
    }
    return apiKey;
  }
}

// Alias for backward compatibility
export type OcGoChatModelProvider = CommandCodeChatModelProvider;
export const OcGoChatModelProvider = CommandCodeChatModelProvider;
