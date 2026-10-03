# LimitView（リミットビュー）

Codex と Claude Code の残量をローカルで素早く確認するための小型デスクトップダッシュボードです。

Codex と Claude Code のサブスクリプション利用枠を自動取得し、5時間枠と週間枠の残り割合を表示します。

## インストール

Windows x64 向けのインストーラーは [GitHub Releases](https://github.com/Termnix-IT/ai-limit-view/releases) から取得します。`LimitView_<version>_x64-setup.exe` を実行し、インストール後にスタートメニューの `LimitView` から起動してください。Codex CLI と Claude Code のログインが必要です。OpenUsage は同梱されるため、別途インストールする必要はありません。

旧名 `AI LimitUsage Watcher` でインストール済みの場合は、旧アプリを終了し、Windows の「インストールされているアプリ」から旧版をアンインストールしてから LimitView を導入してください。旧アンインストーラーのアプリデータ削除は選択しないでください。製品名の変更により、旧版は自動上書きの対象になりません。

アプリ識別子と内部実行ファイル名は既存環境との互換性のため維持しています。タスクマネージャーの実行ファイル名は `ai-limitusage-watcher.exe` ですが、アプリ・スタートメニュー・インストーラーの表示名は `LimitView` です。

## Features

- Codex / Claude Code の残量を二重の MANA リングで表示し、選択中のサービスの残量を中央に大きく表示
- Codex は青、Claude Code はオレンジで表示
- 中央の両サービスアイコンを常時表示。クリックしたサービスを外側のリングと中央の残量に表示し、ホイールでも切り替え可能
- 中央の数値または枠のラベルをクリックすると両サービスの表示を5時間枠 / 週間枠に切り替え。ミニマル表示でも操作可能
- Codex / Claude Code それぞれの `5h残` と `週残` を自動取得し、選択中の枠のリセットまでの時間を表示
- 暗色のHUDと罫線主体の2列表示。取得済みは緑のチェック、取得失敗は赤の警告アイコンで区別
- 歯車ボタンで取得状況、取得元、確認時刻、各枠のリセット時刻を表示し、再取得可能
- オプションボタンで現在のバージョンを表示し、公開版の更新を確認。配布ページを既定のブラウザーで開いて更新可能
- Tauri の透明・非装飾ウィンドウとして動作

## Usage Model

Codex はインストール済みの `codex.exe app-server` の `account/rateLimits/read`、Claude Code はアプリに同梱した OpenUsage の `export --output - --source direct` から利用枠を読みます。Codex CLI は `%LOCALAPPDATA%\OpenAI\Codex\bin` 配下の新しい実行ファイルを優先し、見つからない場合は PATH と `%APPDATA%\npm` を探索します。npm版はパッケージ内のネイティブ実行ファイルを使用します。スタートメニューから起動した場合も、Codex デスクトップ版の CLI を検出します。両方ともログイン済みである必要があります。

取得結果は Codex が1分、Claude Code が5分ごとに更新し、取得が終わった方から表示します。Claude の利用枠 API が429（取得頻度の制限）を返す場合は、連続する失敗に応じて5分・10分・20分・最大30分待って再試行します。待機中は手動の再読み込みでも Claude への要求を送らず、Codex は独立して更新します。成功後は通常の更新間隔に戻ります。Codex は25秒、OpenUsage は60秒で、通信・出力読み取りを含めてタイムアウトします。取得中にアプリを終了した場合も、起動した取得用プロセスとその子孫を停止します。

各枠は取得した使用率を `100 - 使用率` に変換して表示します。取得できない枠は `—` です。リングは初期状態で5時間枠を表示し、中央の数値または枠のラベルのクリックで両サービスを同時に週間枠へ切り替えます。各サービスのチップには常に両枠の残量を表示し、選択中の枠を強調します。回復までの時間はサービスが返すリセット時刻から計算し、時刻がない場合は `—`、時刻を過ぎた場合は `更新待ち` と表示します。

取得できない場合は各サービスの見出しに原因に応じた状態を表示します。Claude は429を「取得制限」、401/403を「認証拒否」、5xxを「サーバー障害」、接続失敗を「通信失敗」として区別します。クリックすると原因と復旧手順、次回再試行時刻を確認できます。直前に取得できた残量がある場合、一時的な失敗では値を保持して「更新失敗」と表示します。中央の残量にも警告アイコンを付け、ツールチップと取得状況画面に「前回の取得値」と最終取得時刻を示します。保持するのはアプリ起動中の取得値だけで、認証エラー時は表示を `—` に戻します。Claude Code の認証期限切れを検出すると、インストール済み CLI を非表示で起動し、標準入力へ `/exit` を送って終了後に1回だけ再取得します。認証更新は20秒で打ち切り、OpenUsage の初回・再取得を含む処理は最大140秒です。復旧に失敗した後は30分間、手動再読み込みでも CLI の再起動を控えます。この間も通常の利用枠取得は続けるため、Claude Code を手動で起動し、必要なら `/login` 後に再読み込みできます。CLI はアプリ専用ディレクトリで起動しますが、ユーザー全体の設定や起動フックは適用される場合があります。認証更新の抑制状態はアプリ起動中だけ保持します。OpenUsage が正常終了しても、利用枠が含まれない結果は取得成功として扱いません。

詳しい仕様は [仕様.md](./仕様.md) を参照してください。

## アプリの更新

タイトルバーのスライダーアイコンから「オプション」を開き、「更新を確認」を押してください。現在のバージョンと GitHub Releases の公開版を比較し、新しい Windows x64 インストーラーがある場合に案内します。確認はボタンを押したときだけ行い、通信に失敗した場合は再試行できます。

「配布ページを開く」で最新版のページを既定のブラウザーに表示します。インストーラーを取得し、LimitView を終了してから実行してください。アプリが自動でダウンロード・インストールする機能はありません。同じ製品名の LimitView は既存のインストール先へ更新できます。

## Tech Stack

- React 18
- TypeScript
- Vite
- Tauri v2
- Rust
- `framer-motion`
- `lucide-react`

## Requirements

- Node.js / npm
- Rust toolchain
- Windows
- ログイン済みの Codex CLI と Claude Code

OpenUsage 0.25.0 は `npm run tauri dev` / `npm run tauri build` の前にビルド用スクリプトが用意し、アプリへ同梱します。LLMDashboard の起動は不要です。`cargo test` を直接実行する前には `npm run pretauri` を一度実行してください。

LLMDashboard に同じチェックサムの OpenUsage がある場合はビルド時に再利用します。別バージョンの場合は固定バージョンをダウンロードし、アーカイブと実行ファイルのチェックサムを検証します。既に同梱用の配置先にあるファイルのチェックサムが不一致の場合は、ビルドを停止します。

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

OpenUsage のビルド準備処理を、通信を使わずに検証します。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-prepare-openusage.ps1
```

## Data Storage

取得結果と表示枠の選択はメモリ上に保持し、アプリを終了すると破棄します。再起動時は5時間枠から表示します。

旧バージョンの手入力、履歴記録、プロセス監視、ローカル推定用の API と保存処理は廃止しました。以前の app data directory にある `ai-limitusage-watcher.db` は既存データの保管用として残り、現在のアプリから読み書きしません。

## Notes

- Claude Code の残量は OpenUsage が Anthropic の利用枠情報から取得した割合です。OpenUsage やサービス側で取得できない場合は`—` を表示します。
- Claude Code の使用制限は Claude 全体の利用、他端末での利用、サーバー側の調整などに影響されます。
- リングとチップの表示元は各チップのツールチップで確認できます。
