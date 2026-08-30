import * as vscode from "vscode";
import { EXTENSION_VERSION } from "./constants";
import { debugLog, disposeOutputChannel, getOutputChannel } from "./output-channel";
import { CommandCodeChatModelProvider } from "./provider";

let _provider: CommandCodeChatModelProvider | null = null;

export function activate(context: vscode.ExtensionContext) {
  const ua = `commandcode-goat-provider/${EXTENSION_VERSION} VSCode/${vscode.version}`;
  const channel = getOutputChannel();
  context.subscriptions.push(channel);
  const debugEnabled = context.globalState.get<boolean>("commandcode-goat.debug", false);
  process.env.COMMANDCODE_GOAT_DEBUG = debugEnabled ? "1" : "0";
  debugLog(
    "activate",
    `Extension activated. Debug logging ${debugEnabled ? "enabled" : "disabled"}.`,
  );

  const provider = new CommandCodeChatModelProvider(context.secrets, ua);
  _provider = provider;

  context.subscriptions.push(
    context.secrets.onDidChange((e) => {
      if (e.key === "commandcode-goat.apiKey") {
        _provider?.fireModelInfoChanged();
      }
    }),
  );

  try {
    const registration = vscode.lm.registerLanguageModelChatProvider("commandcode-goat", provider);
    context.subscriptions.push(registration);
    debugLog("activate/registerProvider", "Registered language model provider: commandcode-goat");

    if (typeof vscode.lm.selectChatModels === "function") {
      void vscode.lm.selectChatModels({ vendor: "commandcode-goat" }).then(
        (models) => {
          debugLog("activate/selectChatModels", {
            count: models.length,
            modelIds: models.map((m) => m.id),
          });
        },
        (error: unknown) => {
          debugLog("activate/selectChatModelsError", error);
        },
      );
    } else {
      debugLog("activate/selectChatModels", "API unavailable in this host");
    }
  } catch (error) {
    debugLog("activate/registerProviderError", error);
    vscode.window.showErrorMessage(
      "Command Code GOAT provider registration failed. Open 'Command Code GOAT: Open Debug Log' for details.",
    );
    throw error;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("commandcode-goat.manage", async () => {
      const existing = await context.secrets.get("commandcode-goat.apiKey");
      const apiKey = await vscode.window.showInputBox({
        title: "Command Code GOAT API Key",
        prompt: existing
          ? "Update your Command Code GOAT API key"
          : "Enter your Command Code GOAT API key",
        ignoreFocusOut: true,
        password: true,
        value: existing ?? "",
        placeHolder: "Enter your Command Code GOAT API key...",
      });
      if (apiKey === undefined) {
        return;
      }
      if (!apiKey.trim()) {
        await context.secrets.delete("commandcode-goat.apiKey");
        vscode.window.showInformationMessage("Command Code GOAT API key cleared.");
        _provider?.fireModelInfoChanged();
        return;
      }
      await context.secrets.store("commandcode-goat.apiKey", apiKey.trim());
      vscode.window.showInformationMessage("Command Code GOAT API key saved.");
      _provider?.fireModelInfoChanged();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("commandcode-goat.toggleDebugLogging", async () => {
      const current = context.globalState.get<boolean>("commandcode-goat.debug", false);
      const next = !current;
      await context.globalState.update("commandcode-goat.debug", next);
      process.env.COMMANDCODE_GOAT_DEBUG = next ? "1" : "0";
      debugLog("toggleDebug", `Debug logging ${next ? "enabled" : "disabled"}.`);
      vscode.window.showInformationMessage(
        `Command Code GOAT debug logging ${next ? "enabled" : "disabled"}.`,
      );
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("commandcode-goat.openDebugLog", () => {
      const output = getOutputChannel();
      output.show(true);
    }),
  );
}

export function deactivate() {
  _provider = null;
  disposeOutputChannel();
}
