# Command Code GOAT Provider

VS Code extension to use Command Code GOAT models in Copilot Chat.

![Command Code GOAT Provider overview](images/opencode_go_provider_summary.png)

> **概要**: Command Code GOAT を Copilot Chat から利用するための VS Code 拡張です。詳細なモデル対応とプロトコル連携は Task 7 で追加します。

## Requirements

- VS Code 1.104.0 or later
- GitHub Copilot extension installed and active
- Command Code GOAT credentials (detailed setup will be added in Task 7)

## Installation

### From Source

1. Clone this repository.
2. Run `bun install --ignore-scripts && bun run compile`.
3. Press `F5` in VS Code to launch the Extension Development Host.

### From VSIX

1. Run `bun install --ignore-scripts && bun run package:vsix`.
2. Install the generated `.vsix` file via the Extensions view (`Install from VSIX...`).

## Setup

Detailed Command Code GOAT setup will be added in Task 7.

## Supported Models

Supported models and protocol details will be added in Task 7.

## Usage

Command Code GOAT usage instructions will be added in Task 7.

## Documentation

- [Architecture](docs/architecture.md) — Module map, data flow, API formats, and design decisions
- [Contributing](docs/contributing.md) — Development setup, code style, adding models, and debugging
- [Supported Models](docs/models.md) — Full model list, capabilities, and context window details

## Development

```bash
bun install --ignore-scripts
bun run compile
bun run lint
bun run test -- --runInBand
```

Press `F5` in VS Code to launch the Extension Development Host.

### Available Scripts

- `bun run compile` – Compile TypeScript
- `bun run watch` – Compile with file watching
- `bun run test` – Run tests
- `bun run lint` – Lint check with ESLint
- `bun run lint:fix` – Auto-fix with ESLint
- `bun run format` – Format with Prettier
- `bun run package:vsix` – Create VSIX package

## Marketplace Packaging

```bash
bun run package:vsix
```

The command above produces a `.vsix` that can be uploaded in the VS Code Marketplace publisher portal.

## Privacy

- Command Code GOAT credentials are stored securely in VS Code.
