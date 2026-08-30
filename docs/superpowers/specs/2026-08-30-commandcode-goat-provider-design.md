---
title: Command Code GOAT Provider for VS Code Copilot Chat
date: 2026-08-30
tags:
  - vscode
  - copilot-chat
  - command-code
  - provider
summary: Command Code GOATのProvider APIをVS Code Copilot Chatから利用するVSIX拡張の設計
---

# Command Code GOAT Provider for VS Code Copilot Chat

## 1. 目的

`opencode-go-provider` と同じ利用体験を、Command Code GOATの契約とProvider APIで実現する。VS Code Copilot ChatのモデルピッカーからCommand Codeのモデルを選択し、ツール呼び出しと画像入力を含むエージェント的な会話を行える、独立したVSIX拡張を作る。

対象ホストはVS CodeのCopilot Chatである。DeepSeek Harness用プラグインやCommand Code CLIのBYOK設定は対象外とする。

## 2. 調査結果と前提

2026-08-30時点で確認したCommand Code公式仕様では、GOATプランにProvider APIアクセスがあり、次のエンドポイントが公開されている。

- `POST https://api.commandcode.ai/provider/v1/chat/completions` — OpenAI Chat Completions
- `POST https://api.commandcode.ai/provider/v1/messages` — Anthropic Messages
- `GET https://api.commandcode.ai/provider/v1/models` — モデル一覧

両方のチャットエンドポイントは `stream: true` によるストリーミングに対応し、ストリーム末尾に使用トークンを返す。認証はBearerトークン、またはAnthropicエンドポイントでは `x-api-key` を使う。`x-cmd-zdr: 1` によるZero Data Retention指定も公式仕様に含まれる。

GOATの公式ページにはモデル一覧、モデルごとのコンテキスト長・推論・画像対応・料金情報が掲載されている。ただしProvider APIのモデル一覧だけでは、VS Codeのモデルピッカーに必要な能力メタデータを安定して取得できない。そのため、APIのID一覧と公式カタログ由来の静的能力表を組み合わせる。

GOATの利用量は5時間14ドル、7日35ドル、月70ドルというプラン上限で管理される。利用量表示のエンドポイントはProvider APIの公開仕様として確認できないため、初版のチャット経路には含めない。

## 3. 採用方式

既存の`opencode-go-provider`を実装上のベースとして、Command Code用の独立プロジェクトへ移植する。VS Code provider登録、メッセージ変換、SSE読み取り、ツール呼び出し、キャンセル、再試行、モックテストの実績を再利用し、OpenCode固有のAPI・モデル名・利用量処理は持ち込まない。

共通コアを別パッケージへ抽出する案は、既存拡張側にも変更を広げるため初版では採用しない。ローカルプロキシを挟む案は、プロセス管理・追加障害点・キー転送が増えるだけで、Command Codeの公式互換APIを直接呼ぶ利点を失うため採用しない。

実行時依存は追加しない。HTTP、SSE、キャンセル、SecretStorageはNode.jsとVS Code APIで実装し、開発ツールは既存プロジェクトと同じくBun・TypeScript・Jest・ESLintを使う。

## 4. 構成

```text
commandcode-goat-provider/
├── src/
│   ├── extension.ts             # 拡張起動、provider登録、キー管理
│   ├── provider.ts              # LanguageModelChatProvider
│   ├── api.ts                   # HTTP、リトライ、エラー整形
│   ├── types.ts                 # Wire型、モデル能力表
│   ├── openai-conversion.ts     # OpenAIメッセージ・ツール変換
│   ├── anthropic-conversion.ts  # Anthropicメッセージ・ツール変換
│   ├── streaming/
│   │   ├── sse.ts               # 共通SSE行読み取り
│   │   ├── openai.ts             # OpenAIストリーム解析
│   │   ├── anthropic.ts          # Anthropicストリーム解析
│   │   └── shared.ts             # 出力・ツール状態
│   ├── message-parts.ts          # VS Code入力パーツの型判定
│   ├── tool-parser.ts            # 埋め込みツール呼び出しの解析
│   ├── tool-repair.ts            # 引数補正・重複排除
│   ├── tokenizer.ts              # 軽量トークン推定
│   ├── guidance.ts               # Command Code向けシステムガイダンス
│   └── output-channel.ts         # キーを含めないデバッグログ
├── tests/
├── docs/
├── package.json
├── README.md
├── NOTICE
└── LICENSE
```

OpenCode専用のResponses API、使用量ステータスバー、MiMoへの画像フォールバック、OpenCode Go固有のプロンプト置換は削除する。

## 5. モデル発見と能力表

### 5.1 起動時の一覧

APIキーが利用可能な場合、providerは`GET /provider/v1/models`を取得する。成功したレスポンスの`data[].id`を表示対象とし、静的能力表に同じIDがあればそのメタデータを適用する。取得失敗、未認証、形式不正の場合は静的フォールバック一覧を使う。

APIから返されたIDは静的表に存在しなくても捨てない。未知モデルには次の既定値を適用して表示し、次回の能力表更新で精度を改善する。

- 表示名: モデルID
- コンテキスト長: 262,144
- 最大出力: 65,536
- ツール呼び出し: 有効
- 画像入力: 無効
- 推論設定: なし
- API形式: `claude-`で始まるIDはAnthropic、それ以外はOpenAI

画像入力を誤って送ることを優先的に避けるため、未知モデルの画像対応は無効にする。API形式については、公式仕様の「ClaudeをChat Completionsへ送ると400、非AnthropicモデルをMessagesへ送ると400」という制約に基づき、Claude系IDだけをAnthropicへ振り分ける。

### 5.2 静的能力表

静的表はCommand Codeの公式CLIモデルカタログとGOATページを基準に管理する。少なくとも次の属性を保持する。

- 正確なモデルID（大文字小文字を保持）
- 表示名
- コンテキスト長
- 最大出力トークン
- `supportsTools`
- `supportsVision`
- `supportsThinking`
- 選択可能なreasoning effort
- API形式
- 必要な場合の固定temperature/top-p

GOATページのモデルID例は、`deepseek/deepseek-v4-flash`、`deepseek/deepseek-v4-flash-vision-exp`、`Qwen/Qwen3.8-27B`、`moonshotai/Kimi-K3`、`claude-sonnet-4-6`、`gpt-5.6-sol`、`xai/grok-4.6`などである。モデル追加時は、能力表・README・単体テストを同じ変更で更新する。

## 6. リクエスト処理

### 6.1 OpenAI形式

OpenAI互換モデルには次を送る。

- URL: `https://api.commandcode.ai/provider/v1/chat/completions`
- `Authorization: Bearer <API key>`
- `Content-Type: application/json`
- `model`, `messages`, `stream: true`
- 必要に応じて`max_tokens`、`temperature`、`top_p`、`tools`、`tool_choice`、`reasoning_effort`

VS Codeのテキスト、画像、assistantのツール呼び出し、tool結果をOpenAIのメッセージ形式へ変換する。ストリームの`content`、推論用フィールド、`tool_calls`を逐次VS Codeの`LanguageModelResponsePart`へ変換する。

### 6.2 Anthropic形式

Claude系モデルには次を送る。

- URL: `https://api.commandcode.ai/provider/v1/messages`
- `x-api-key: <API key>`
- `anthropic-version: 2023-06-01`
- `Content-Type: application/json`
- `model`, `messages`, `stream: true`, `max_tokens`
- 必要に応じて`system`、`temperature`、`top_p`、`tools`、`tool_choice`

systemメッセージはAnthropicの`system`フィールドへ分離し、連続する同一roleのメッセージを統合する。画像はAnthropicのbase64 image block、ツール呼び出しは`tool_use`、結果は`tool_result`へ変換する。`content_block_delta`、`input_json_delta`、`message_delta`などを解析する。

### 6.3 推論と再試行

静的能力表にeffortがあるモデルだけモデル設定に推論選択肢を表示する。指定値がそのモデルで使えない場合は、リクエストから除外して既定動作に戻す。ストリームが推論だけで終了した場合、空応答、途中停止、出力上限終了、ツール呼び出しを宣言しただけで終了した場合は、既存実装の上限付きサイレント再試行を再利用する。

再試行は会話へ「Retrying」の文字列を出力しない。出力されたツール呼び出しを重複させないため、試行間で発行済みcall IDを保持する。

### 6.4 画像

`supportsVision`が真のモデルだけに画像を送る。非対応モデルを選択した状態で画像を含む会話が来た場合は、モデルを黙って変更せず、対応モデルへ切り替えるよう利用者に説明するエラーを返す。初版では別モデルへの画像解析委譲を行わない。

## 7. 認証・設定

APIキーは`commandcode-goat.apiKey`というVS Code SecretStorageキーへ保存する。Command Paletteに次のコマンドを登録する。

- `Command Code GOAT: Manage API Key`
- `Command Code GOAT: Toggle Debug Logging`
- `Command Code GOAT: Open Debug Log`

キー未設定時のモデル情報取得は入力ダイアログを開かず、フォールバック一覧を返す。チャット要求時だけキー設定を促す。既存のモデル設定に明示されたキーがある場合はSecretStorageへ同期するが、ログには値を出さない。

ZDRは`commandcode-goat.enableZdr`というBoolean設定で提供し、既定値は`false`とする。真の場合だけすべてのProvider APIリクエストへ`x-cmd-zdr: 1`を付ける。422 `cmd_zdr_no_providers`は、ZDR対応上流がないモデルを選んだこととして表示する。

## 8. エラーとネットワーク

HTTPクライアントは既存の再試行方針を再利用する。

- 再試行: `429`, `502`, `503`, `504`と一時的なネットワーク失敗
- `Retry-After`があれば尊重
- リクエスト全体とSSE読み取りにタイムアウトを設ける
- キャンセル時はVS Codeの`CancellationError`として終了
- APIキー、Authorizationヘッダー、リクエスト本文の秘密値をログに残さない

利用者向けメッセージはCommand Codeのエラーコードに合わせる。

- `400 unsupported_model`: モデルIDまたは契約対象を確認
- `400 invalid_request_error`: API形式・リクエスト内容を確認
- `401 authentication_error`: APIキーを更新
- `403 upgrade_required`: GoプランではなくGOAT以上のAPIアクセスが必要
- `422 cmd_zdr_no_providers`: ZDRを無効化するか対応モデルを選択
- `429 rate_limit_error`: 待機後に自動再試行
- `5xx`: Command Codeまたは上流サービスの一時障害

## 9. テスト方針

秘密鍵を使わないモックテストを必須とする。

1. APIクライアント
   - URL、認証ヘッダー、ZDRヘッダー
   - OpenAI/Anthropicのbody
   - モデル一覧の成功・失敗・不正形式
   - HTTPエラー、Retry-After、再試行、タイムアウト
2. 変換
   - テキスト、画像、system、tool call、tool result
   - 連続roleの統合
   - reasoning effortと固定サンプリング値
3. ストリーミング
   - SSEチャンク境界
   - OpenAIのテキスト・推論・tool call
   - Anthropicのcontent block・partial JSON・usage
   - 空応答、推論のみ、途中停止、切り詰め、重複ツール呼び出し
4. provider
   - VS Codeへの登録
   - 静的能力表と動的一覧のマージ
   - フォールバック一覧
   - APIキー管理とキャンセル
5. パッケージ
   - `bun run compile`
   - `bun run lint`
   - `bun run test -- --runInBand`
   - `bun run package:vsix`

実アカウントを使うライブテストはリポジトリの自動テストに含めない。READMEに、利用者が自分のAPIキーを環境変数や保護されたファイルから渡して手動確認する手順を記載する。

## 10. 初版の受け入れ条件

- VS Code 1.104以上で拡張が起動し、`commandcode-goat` providerが登録される
- APIキーなしでもフォールバックのGOATモデル一覧が表示される
- APIキーありで動的モデル一覧へ更新される
- OpenAI形式とAnthropic形式の双方でストリーミング応答を表示できる
- 少なくとも1つの対応モデルでネイティブツール呼び出しをVS Codeへ返せる
- 対応モデルで画像入力を送信でき、非対応モデルでは明示的に拒否できる
- 静的表に推論effortがあるモデルでモデル設定を表示できる
- キー、ZDR設定、キャンセル、429/5xx再試行がテストされている
- VSIXをローカル生成できる
- GOATの利用量ステータスバーを実装していないことと、その理由がREADMEに明記されている

## 11. 初版の対象外

- Provider API仕様外の利用量・残量ステータスバー
- Command Code CLIのブラウザログインフロー
- 複数アカウント自動ローテーション
- 別モデルへの画像解析フォールバック
- Responses API
- Marketplaceへの公開
- Command Code公式サポートや規約への適合を保証する代理表明

## 12. 参照資料

- [Command Code Provider API](https://commandcode.ai/docs/provider)
- [Command Code GOAT Plan](https://commandcode.ai/docs/plans/goat)
- [Command Code Available Models](https://commandcode.ai/docs/reference/cli/models)
- [Command Code Usage Limits](https://commandcode.ai/docs/resources/usage-limits)
- [OpenCode Go Provider](https://github.com/hidenobunagai/opencode-go-provider)
- [Pi Command Code Provider](https://github.com/patlux/pi-commandcode-provider)
- [DeepSeek Harness Command Code Provider](https://github.com/Mars-Sea/dsh-commandcode-provider)

既存コードを移植する場合は、元実装のMITライセンスと著作権表示を保持し、派生実装であることを`NOTICE`へ記録する。
