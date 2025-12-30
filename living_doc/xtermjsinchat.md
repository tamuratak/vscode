% xterm.js in Chat — セッション保存

## User
- chat view において terminal の結果を表示するのに xterm.js はどのように使われているかを徹底的に調査してほしい、という依頼。
- 上記の調査結果をセッションとして保存してほしい（このファイルにまとめる）。

## Assistant
- 調査サマリ（要点）
  - `TerminalChatWidget` はターミナル DOM 上に `InlineChatWidget`（チャット入力/表示）を重ね合わせ、`xterm.raw` の要素・フォント・バッファ情報を参照してチャットウィジェットの幅・高さ・位置を再計算し、ターミナルのカーソル位置やリサイズに同期して表示位置を決める。
  - `TerminalChatController` は xterm の準備完了（xtermReady）をトリガーに `TerminalChatWidget` を遅延生成し、フォーカスやアクティブなターミナルとの同期を行う。
  - `TerminalChatService` はツールセッション ID と `ITerminalInstance` の紐付けを管理し、チャット側のツール進捗パーツがどのターミナルに接続すべきかを提供する。
  - 実行系ツール（Run in Terminal 等）は、`instance.xtermReadyPromise` を待って `getCommandOutputSnapshot` を呼び、xterm のマーカー（SetMarker）を基に `getRangeAsVT` でVT文字列を取得してスナップショットを作成する。生成された出力情報（`terminalCommandOutput`）とターミナルテーマはチャットのツールデータに格納される。
  - チャットの表示側（`ChatTerminalToolProgressPart`）は次の方式でターミナル出力を表示する:
    - ライブ表示: `DetachedTerminalCommandMirror` を生成し、対象 `xterm` から出力スナップショットを取り、チャット内に添付して表示する（ライブのコマンド出力をレンダリング）。
    - スナップショット表示: `DetachedTerminalSnapshotMirror` により保存済み出力を再現表示する（ターミナルが消滅しても出力を表示可能）。
  - これらにより、チャット内で「ターミナルで実行したコマンド」と「その出力」を xterm のレンダリングに近い形で埋め込み表示できる仕組みになっている。

- 次のステップ（提案）
  1. 実装を試験的に操作して、`Run in Terminal` 系ツールで chat 内の出力が Live ↔ Snapshot でどう切り替わるか UI 上で確認する。
  2. `TerminalCommandArtifactCollector` が生成する `IChatTerminalToolInvocationData`（`terminalCommandOutput` / `terminalTheme` 等）を確認して、ツール出力がどのようにシリアライズされてチャットに渡るかを検証する。

## Mermaid 図
- このセッションで生成された mermaid 図はありません。

## 参照したファイル一覧
- [src/vs/workbench/contrib/terminalContrib/chat/browser/terminalChatWidget.ts](src/vs/workbench/contrib/terminalContrib/chat/browser/terminalChatWidget.ts) — ターミナル内に重ねるインラインチャットのウィジェット。xterm.raw を参照して位置・サイズを計算する。
- [src/vs/workbench/contrib/terminalContrib/chat/browser/terminalChatController.ts](src/vs/workbench/contrib/terminalContrib/chat/browser/terminalChatController.ts) — xtermReady を受け取り `TerminalChatWidget` を生成・管理するコントローラ。
- [src/vs/workbench/contrib/terminalContrib/chat/browser/terminalChatService.ts](src/vs/workbench/contrib/terminalContrib/chat/browser/terminalChatService.ts) — ツールセッション ID とターミナルインスタンスの紐付け管理、進捗パーツの管理。
- [src/vs/workbench/contrib/terminal/browser/chatTerminalCommandMirror.ts](src/vs/workbench/contrib/terminal/browser/chatTerminalCommandMirror.ts) — xterm のマーカー範囲から出力を取得し、Detached ターミナルに書き戻して表示するミラー実装（ライブ/スナップショット両対応）。
- [src/vs/workbench/contrib/chat/browser/chatContentParts/toolInvocationParts/chatTerminalToolProgressPart.ts](src/vs/workbench/contrib/chat/browser/chatContentParts/toolInvocationParts/chatTerminalToolProgressPart.ts) — チャットのツール進捗パーツ。ターミナル出力の展開・ライブ表示・スナップショット表示の UI を実装。
- [src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/terminalCommandArtifactCollector.ts](src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/terminalCommandArtifactCollector.ts) — 実行時にターミナル出力をキャプチャして `IChatTerminalToolInvocationData` に格納するロジック。
- [src/vs/workbench/contrib/terminal/browser/terminal.ts](src/vs/workbench/contrib/terminal/browser/terminal.ts) — `IXtermTerminal` の型定義や `xtermReadyPromise` 等、ターミナルインスタンスまわりの主要 API。

---
ファイルを保存しました: /Users/tamura/src/github/vscode/living_doc/xtermjsinchat.md
