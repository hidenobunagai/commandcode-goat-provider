# Contributing to Command Code GOAT Provider

## Getting Started

### Prerequisites

- **Bun**: `1.0` or higher
- **VS Code**: `1.104.0` or higher
- **GitHub Copilot**: Installed and active in VS Code

### Setup

```bash
git clone https://github.com/hidenobunagai/commandcode-goat-provider.git
cd commandcode-goat-provider
bun install --ignore-scripts
bun run compile
```

### Running in Development

Press `F5` in VS Code to launch the Extension Development Host.

In the Development Host:
1. Open GitHub Copilot Chat.
2. Select **Command Code GOAT** from the model picker.
3. Enter your Command Code API key when prompted or via `Command Code GOAT: Manage API Key`.

## Testing & Verification

```bash
# Run unit test suite
bun run test -- --runInBand

# Type-check
bun run compile

# Lint and format
bun run lint
bun run format

# Package local VSIX
bun run package:vsix
```

## Debugging

- Toggle debug logging: Command Palette → `Command Code GOAT: Toggle Debug Logging`
- View debug logs: Command Palette → `Command Code GOAT: Open Debug Log`
