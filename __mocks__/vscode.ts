export const LanguageModelChatMessageRole = { User: 1, Assistant: 2, System: 0 };
export class LanguageModelTextPart { constructor(public value: string) {} }
export class LanguageModelToolCallPart {
  constructor(public callId: string, public name: string, public input: Record<string, unknown>) {}
}
export class LanguageModelToolResultPart {
  constructor(public callId: string, public content: unknown[]) {}
}
export class CancellationError extends Error {
  constructor() {
    super("Canceled");
    this.name = "CancellationError";
  }
}
export class CancellationTokenSource {
  token = {
    isCancellationRequested: false,
    onCancellationRequested: jest.fn(),
  };
  cancel() {
    this.token.isCancellationRequested = true;
  }
  dispose() {}
}
