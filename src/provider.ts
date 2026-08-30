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
import { fetchModels } from "./api";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  FALLBACK_MODELS,
  getContextWindowSafetyMargin,
  inferModelInfo,
  REASONING_EFFORT_ORDER,
  THINKING_MODELS,
} from "./constants";
import { getTextPartValue } from "./message-parts";
import { debugLog } from "./output-channel";
import { handleAnthropicRequest } from "./streaming/anthropic";
import { processOpenAIStream, type OpenAIModelInfo } from "./streaming/openai";
import { estimateMessagesTokens, estimateTokens } from "./tokenizer";
import { CommandCodeModelInfo, ReasoningEffort } from "./types";

export class CommandCodeChatModelProvider implements LanguageModelChatProvider {
  private readonly _onDidChangeLanguageModelChatInformation = new EventEmitter<void>();
  readonly onDidChangeLanguageModelChatInformation: Event<void> =
    this._onDidChangeLanguageModelChatInformation.event;

  private readonly _onDidCompleteResponse = new EventEmitter<void>();
  /** Fires after every chat response completes (success or error). */
  readonly onDidCompleteResponse: Event<void> = this._onDidCompleteResponse.event;

  private readonly _modelMap = new Map<string, CommandCodeModelInfo>();
  private _models: CommandCodeModelInfo[] = FALLBACK_MODELS;
  private _modelsFetched = false;

  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly userAgent: string,
  ) {
    for (const m of FALLBACK_MODELS) {
      this._modelMap.set(m.id, m);
    }
    void this.fetchModels();
  }

  fireModelInfoChanged(): void {
    void this.fetchModels().then(() => {
      this._onDidChangeLanguageModelChatInformation.fire();
    });
  }

  private async fetchModels(): Promise<void> {
    try {
      const apiModels = await fetchModels(this.userAgent);
      const fetchedModels: CommandCodeModelInfo[] = apiModels.map((item) => inferModelInfo(item));
      this._models = fetchedModels;
      this._modelMap.clear();
      for (const m of fetchedModels) {
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
        maxInputTokens: Math.max(
          1,
          info.contextWindow - Math.min(info.maxOutput, DEFAULT_MAX_OUTPUT_TOKENS),
        ),
        maxOutputTokens: info.maxOutput,
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

      const maxInputTokens = model.maxInputTokens;
      const modelContextWindow = maxInputTokens + model.maxOutputTokens;
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
        model.maxOutputTokens,
      );

      const MIN_THINKING_MODEL_OUTPUT_TOKENS = 16384;
      const resolvedModelId = this.resolveApiModelId(model.id);
      const isThinkingModel = THINKING_MODELS.has(resolvedModelId);
      const effectiveMaxTokens = isThinkingModel
        ? Math.max(
            requestedMaxTokens,
            Math.min(MIN_THINKING_MODEL_OUTPUT_TOKENS, model.maxOutputTokens),
          )
        : requestedMaxTokens;

      const effectiveMessages = messages;
      const effectiveModelId = this.resolveApiModelId(model.id);
      const effectiveModelInfo = this.getModelInfo(effectiveModelId);
      const variantModelInfo = this.getModelInfo(model.id);

      if (
        !effectiveModelInfo ||
        effectiveModelInfo.isUserSelectable === false ||
        !effectiveModelInfo.apiFormat
      ) {
        throw new Error(`Model ${model.id} is not supported or not selectable.`);
      }

      const apiFormat = effectiveModelInfo.apiFormat;
      const modelConfig = (options as unknown as Record<string, unknown>).modelConfiguration as
        Record<string, unknown> | undefined;
      const rawReasoningEffort =
        typeof modelConfig?.reasoningEffort === "string"
          ? (modelConfig.reasoningEffort as string)
          : undefined;
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
        maxOutputTokens: model.maxOutputTokens,
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
