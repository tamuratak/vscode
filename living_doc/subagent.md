# サブエージェント実装まとめ

## サブエージェント呼び出しの流れ
`RunSubagentTool.invoke()` がチャットセッションと直近リクエストを取得したのち、`subAgentInvocationId` を `invocation.callId` か新規 UUID で作成し、各種ツール進捗や Markdown ブロックにこの ID をタグとして付与しながら進行を追跡する。対象のサブエージェントが指定されていればモデルやツールの enable/disable、モード固有命令を `languageModelToolsService` 経由でフィルタリングし、最終的に `IChatAgentRequest` に `variables`（後述）・`modeInstructions`・`userSelectedTools`・`hooks`・親リクエスト ID などを詰めて `chatAgentService.invokeAgent()` に渡すことで独立したサブエージェント実行を起動する。この流れは対象ファイルで 1 つのまとまった処理になっている。[src/vs/workbench/contrib/chat/common/tools/builtinTools/runSubagentTool.ts](src/vs/workbench/contrib/chat/common/tools/builtinTools/runSubagentTool.ts#L119-L319)

事前準備フェーズでは `prepareToolInvocation()` 内で `resolveSubagentModel()` してモデル名をキャッシュした上でツール固有データにサブエージェント情報を書き込み、`prepareToolInvocation` → `invoke` の間でモデル判定結果を跨がせる工夫がある。[src/vs/workbench/contrib/chat/common/tools/builtinTools/runSubagentTool.ts](src/vs/workbench/contrib/chat/common/tools/builtinTools/runSubagentTool.ts#L373-L391)

## 並列呼び出しの取り扱い
`subAgentInvocationId` を `ChatToolInvocation` に持たせることで、単一セッション内で複数のサブエージェントが並列に進行しても、ツール進捗や Markdown/フックが混ざらないようにしている。`languageModelToolsService` 側は `invokeTool()` 内で `onDidInvokeTool` イベントに `subAgentInvocationId` を載せて通知し、サブエージェントツール呼び出し時にすぐにフックや Markdown をリセットできるよう利用されるほか、`beginToolCall()` にも同じ ID を渡して進行中のストリームをサブエージェント単位で追跡する。[src/vs/workbench/contrib/chat/browser/tools/languageModelToolsService.ts](src/vs/workbench/contrib/chat/browser/tools/languageModelToolsService.ts#L439-L514)、[src/vs/workbench/contrib/chat/browser/tools/languageModelToolsService.ts](src/vs/workbench/contrib/chat/browser/tools/languageModelToolsService.ts#L858-L902)

UI 側 `IChatToolInvocation` も `subAgentInvocationId` を持っていて、シリアライズ済みの呼び出し・ストリーム済みの状態でもサブエージェント ID でグルーピングできるようになっている。これにより `chatService` やウィジェットは同一サブエージェントのツール呼び出しのみをまとめて表示できる。[src/vs/workbench/contrib/chat/common/chatService/chatService.ts](src/vs/workbench/contrib/chat/common/chatService/chatService.ts#L557-L833)

## コンテキスト生成と渡し方
`RunSubagentTool` 側ではツール呼び出し時に `ChatRequestVariableSet` を作成し、`ComputeAutomaticInstructions.collect()` で自動的に当てはまる命令ファイル（`applyTo`/パターンにマッチする指示、参照される指示、Copilot/Claude エージェント指示など）を変数として集約する。さらに `PromptsService.getHooks()` で hooks.json から HookType ごとのコマンドを読み取って `IChatRequestHooks` にまとめ、`IChatAgentRequest` に `variables`、`hooks`、`hasHooksEnabled` を含めることで、サブエージェント内部で利用すべきコンテキストを一式渡す。[src/vs/workbench/contrib/chat/common/tools/builtinTools/runSubagentTool.ts](src/vs/workbench/contrib/chat/common/tools/builtinTools/runSubagentTool.ts#L246-L274)、[src/vs/workbench/contrib/chat/common/promptSyntax/computeAutomaticInstructions.ts](src/vs/workbench/contrib/chat/common/promptSyntax/computeAutomaticInstructions.ts#L91-L229)、[src/vs/workbench/contrib/chat/common/promptSyntax/service/promptsServiceImpl.ts](src/vs/workbench/contrib/chat/common/promptSyntax/service/promptsServiceImpl.ts#L1001-L1078)

このとき `IChatAgentRequest` の `subAgentInvocationId`、`subAgentName`、`parentRequestId` も一緒にセットされ、`chatAgents` 側で「親リクエストから派生したサブエージェント」であることを明示したうえで、子ツール呼び出しがどのサブエージェントに属するかを識別できるようになっている。[src/vs/workbench/contrib/chat/common/participants/chatAgents.ts](src/vs/workbench/contrib/chat/common/participants/chatAgents.ts#L136-L175)
