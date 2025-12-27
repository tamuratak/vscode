## User

runInTerminal の調査

## Assistant
**概要**
- `run_in_terminal` ツールは、コマンドや説明文、背景実行フラグを受け取り、ターゲットシェル（bash/zsh/fish/PowerShell）に応じた長文モデル説明とアイコンを持つ内部ツールとして登録されることで、モデル側が「Run in Terminal」アクションを識別できるようになっている。[src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/runInTerminalTool.ts](src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/runInTerminalTool.ts#L179-L230)

**実行フロー**
- `prepareToolInvocation` ではセッションの cwd と shell を把握し、リライターで `cd` や PowerShell のチェーン演算子をフォーマットし、静的解析器（ファイル書き込み・自動承認）で安全性を判断してディスクレーマやカスタムアクションを生成。オート承認設定や動作拒否の可視化用にツール固有のメタ情報を詰めて返す。[src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/runInTerminalTool.ts](src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/runInTerminalTool.ts#L354-L507)

**コマンド実行と結果取得**
- `invoke` では背景/前景で異なる端末を初期化し、`OutputMonitor` を `ITerminalExecuteStrategy`（None/Basic/Rich）と連携させてコマンド検出マーカーを作り、実行結果を収集。背景なら `BackgroundTerminalExecution` でマーカー以降の出力を監視して即座に「実行中」メッセージ＋取得済み出力を返し、前景なら `executeResult` の `output`／`additionalInformation` と `lookup toolResultMessage` を結合して `IToolResult` に収めるため、チャット側には整形済みの結果本文とステータスが送られる。[src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/runInTerminalTool.ts](src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/runInTerminalTool.ts#L525-L798)

**セッション管理・プロファイル**
- 背景実行は `RunInTerminalTool._backgroundExecutions` で `BackgroundTerminalExecution` を保持し、`getBackgroundOutput` で `getOutput` 経由により後続で取り出せる。また、フォアグラウンド端末はセッション単位にキャッシュされ、プロセス ID をストレージと同期、セッション破棄時にクリーンアップ。ターミナルプロファイルは環境変数・設定（`TerminalProfileWindows/MacOs/Linux`）を読み、cmd は pwsh に置き換えて shell integration を担保する。[src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/runInTerminalTool.ts](src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/runInTerminalTool.ts#L281-L330) [src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/runInTerminalTool.ts](src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/runInTerminalTool.ts#L802-L991) [src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/runInTerminalTool.ts](src/vs/workbench/contrib/terminalContrib/chatAgentTools/browser/tools/runInTerminalTool.ts#L994-L1070)
