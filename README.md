# AI LimitUsage Watcher

Codex と Claude Code の残量をローカルで素早く確認するための小型デスクトップダッシュボードです。

正確な公式使用量の自動計測ではなく、ユーザーが確認した残り割合を手入力し、作業再開時に「今どれくらい残っていたか」をすぐ見返せることを重視しています。

## Features

- Codex / Claude Code の残量を MANA リングで表示
- Codex は青、Claude Code はオレンジで表示
- マウスホイールで中央表示を `Codex` / `Claude` に切り替え
- Claude 表示中の中央クリックでプラン表示を `Pro -> Max 5x -> Max 20x` に切り替え
- Codex / Claude Code それぞれに `5h残` と `週残` を手入力保存
- タイトルバーの歯車ボタンで入力専用の設定画面に切り替え
- Windows の `tasklist` によるローカルプロセス監視
- SQLite にローカル履歴を保存
- Tauri の透明・非装飾ウィンドウとして動作

## Usage Model

このアプリの残量表示は、公式 usage API の値ではありません。

主な考え方は以下です。

- `5h残` と `週残` は、ユーザーが確認した残り割合を手入力する
- 週制限は完全に手入力値を正として扱う
- Claude Code の 5時間枠は、ローカルで記録された最新セッション開始時刻 + 5時間を推定終了時刻として補助表示する
- プロセス監視は補助情報として使い、残量の主値は手入力値を優先する

詳しい仕様は [仕様.md](./仕様.md) を参照してください。

## Tech Stack

- React 18
- TypeScript
- Vite
- Tauri v2
- Rust
- SQLite / `rusqlite`
- `framer-motion`
- `lucide-react`

## Requirements

- Node.js / npm
- Rust toolchain
- Windows

このアプリはプロセス監視に Windows の `tasklist` を使います。

## Development

依存関係をインストールします。

```powershell
npm install
```

Vite dev server を起動します。

```powershell
npm run dev
```

Tauri desktop app を開発モードで起動します。

```powershell
npm run tauri dev
```

フロントエンドをビルドします。

```powershell
npm run build
```

Tauri app をビルドします。

```powershell
npm run tauri build
```

## Testing

フロントエンドテストを実行します。

```powershell
npm run test
```

Rust テストを実行します。

```powershell
cd src-tauri
cargo test
```

## Data Storage

実行時データは Tauri の app data directory に SQLite database として保存されます。

Database file:

```text
ai-limitusage-watcher.db
```

主なテーブル:

- `usage_sessions`
- `status_snapshots`
- `manual_limit_entries`
- `settings`

## Notes

- Claude Code の残量は公式 Anthropic 使用量として扱わないでください。
- Claude Code の使用制限は Claude 全体の利用、他端末での利用、サーバー側の調整などに影響されます。
- このアプリは正確性よりも、手入力した残量を素早く見返すことを優先しています。

