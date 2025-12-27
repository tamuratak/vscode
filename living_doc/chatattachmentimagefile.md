**添付画像の保存**
- `ChatAttachmentModel.addFile` は画像と思しき拡張子を検出すると `asImageVariableEntry` → `ChatAttachmentResolveService.resolveImageEditorAttachContext` を呼んで、リサイズ済みの `Uint8Array` やファイル URI・メタ情報を詰めた `IImageVariableEntry` を `IChatRequestVariableEntry` にして保持する。画像以外は URI ベースの `file` 変数として扱われ、両者とも `IChatRequestVariableValue` に `Uint8Array` を含められる仕様になっているため、バイナリも JSON 化できる。[src/vs/workbench/contrib/chat/browser/attachments/chatAttachmentModel.ts#L59-L109][src/vs/workbench/contrib/chat/browser/attachments/chatAttachmentResolveService.ts#L151-L202][src/vs/workbench/contrib/chat/common/attachments/chatVariables.ts#L35-L41]

**セッション再開時**
- `ChatModel` は各リクエストの `variableData` に添付コンテキストを保持し、入力欄の下書き添付は `InputModel.toJSON()` に含まれるため、送信/未送信の両方の添付がシリアライズされる。[src/vs/workbench/contrib/chat/common/model/chatModel.ts#L1547-L1574][src/vs/workbench/contrib/chat/common/model/chatModel.ts#L2006-L2232]
- `ChatSessionStore` は `<workspaceStorageHome>/<workspaceId>/chatSessions/<sessionId>.json` に `ChatModel` 全体を `JSON.stringify` して書き出し、読み出し時は `revive(JSON.parse(...))` で URIs/バイナリを復元するため添付も含めて復元される。`ChatServiceImpl.getOrRestoreSession` はこのストアから読み出した `ISerializableChatData` を `ChatModel` の初期データとして再構築する。[src/vs/workbench/contrib/chat/common/model/chatSessionStore.ts#L43-L70][src/vs/workbench/contrib/chat/common/model/chatSessionStore.ts#L240-L312][src/vs/workbench/contrib/chat/common/model/chatSessionStore.ts#L486-L506][src/vs/workbench/contrib/chat/common/chatService/chatServiceImpl.ts#L483-L515]

**LLM/セッションタイプによる差**
- `IChatAgentAttachmentCapabilities` で各エージェント（LLM）または拡張セッションが扱える添付の種類を定義し、`ChatWidget` はアクティブなエージェントや `ChatSessionsService` 経由で得たセッションタイプの `capabilities` を `_attachmentCapabilities` に当てはめることで UI 上の添付アクションを切り替えている（能力がなければ対応するボタンは出ない）。[src/vs/workbench/contrib/chat/common/participants/chatAgents.ts#L33-L45][src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts#L152-L206][src/vs/workbench/contrib/chat/browser/widget/chatWidget.ts#L568-L602][src/vs/workbench/contrib/chat/browser/chatSessions/chatSessions.contribution.ts#L21-L118][src/vs/workbench/contrib/chat/browser/chatSessions/chatSessions.contribution.ts#L1066-L1091]
- 一方、`ChatServiceImpl` の `prepareChatAgentRequest` は添付を `variables` にそのまま渡すので、どの LLM を呼び出しても添付そのものは API に乗っている（能力フラグは UI の制御・拡張登録時の設定であり、送信時の実装は共通）。[src/vs/workbench/contrib/chat/common/chatService/chatServiceImpl.ts#L850-L905]

次のステップ:
1. 画像を添付したままセッションを閉じて再度開き、`<workspaceStorageHome>/<workspaceId>/chatSessions/<sessionId>.json` にバイナリが含まれているかと UI で添付が再表示されるかを確認。
2. 利用したい LLM/セッションタイプごとに `chatSessions` 拡張ポイントや `IChatAgentAttachmentCapabilities` を見て、どの添付種別が有効化されているかをチェック。
