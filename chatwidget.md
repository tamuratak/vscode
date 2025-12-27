# Chat View Overview

- ChatWidget の createList で ChatListItemRenderer が生成される. 他色々.
-

## ChatWidget から ListView への経路

`ChatWidget` の `createList` から `WorkbenchObjectTree` を生成し、レンダラー／デリゲート／コンテナを渡してツリー UI を組み立てる。

- ChatWidget の tree instanceof WorkbenchObjectTree
- WorkbenchObjectTree extends ObjectTree
- ObjectTree extends AbstractTree
- AbstractTree の view が instanceof TreeNodeList
- TreeNodeList extends List
- List の view が satisfies IListView

ListView の items は chatWidget からどのような経路で変更されるか調査して

ChatWidget 側では `viewModel` から `treeItems` を作って `this.tree.setChildren(null, treeItems, …)` を呼び出し、`createList()` で `WorkbenchObjectTree` を生成してその上にレンダリングしているのが変更の起点です。[src/vs/workbench/contrib/chat/browser/chatWidget.ts#L804-L859][src/vs/workbench/contrib/chat/browser/chatWidget.ts#L1462-L1582]

`WorkbenchObjectTree` は `ObjectTree` を拡張した上で、`setChildren` が `ObjectTreeModel` に委譲されるため、チャットの要素がモデルに差分として流れ込みます。[src/vs/platform/list/browser/listService.ts#L852-L888][src/vs/base/browser/ui/tree/objectTree.ts#L38-L86]

`AbstractTree` 側で `model.onDidSpliceRenderedNodes` を監視して `this.view.splice(...)` を呼び出しており、この `view` が `TreeNodeList`（`List` のサブクラス）なので、差分イベントが `List` の `splice` 経路へと流れます。[src/vs/base/browser/ui/tree/abstractTree.ts#L2479-L2535][src/vs/base/browser/ui/tree/abstractTree.ts#L3199-L3242]

`List.splice` は `CombinedSpliceable`（焦点/選択/アンカー用の TraitSpliceable と `ListView` を束ねたもの）に差分を渡し、そこから `ListView.splice` が呼ばれます。[src/vs/base/browser/ui/list/listWidget.ts#L1547-L1591][src/vs/base/browser/ui/list/splice.ts#L12-L18]

`ListView.splice` の内部では `items: IItem<T>[]`（`ListView` が保持するデータ）を必要な位置で削除/挿入し、DOM を更新・スクロール高さを再計算するので、ここで `ListView` の `items` が実際に書き換えられます。[src/vs/base/browser/ui/list/listView.ts#L295-L320][src/vs/base/browser/ui/list/listView.ts#L617-L741]

以上の链で、ChatWidget が差分を渡すたびに `ListView` の `items` が `ListView.splice` で更新されます。必要であれば、同経路をたどる形で差分の前処理や後処理を追加できます。

## renderer と templateDate

- `templateData` は `IChatListItemTemplate` で定義された「1行あたりの DOM＋状態」の束で、現在アタッチされている `ChatTreeItem` やそのために構築されたツールバー・ヘッダー・アバター・コンテキストキー・ツールチップ・再利用可能な `renderedParts`（マークダウンやツール呼び出しなどの描画パート）を保持する仕組みです（[src/vs/workbench/contrib/chat/browser/chatListRenderer.ts#L102-L129](src/vs/workbench/contrib/chat/browser/chatListRenderer.ts#L102-L129)）。
- このテンプレートはリストが行を作るときに `renderTemplate` で DOM を初期化し、`renderElement`／`renderChatTreeItem` で `ChatTreeItem` を注入するときに使われます。`renderTemplate` が各行の DOM・ツールバー・エレメント／イベントリスナを構築し、`renderElement` がそのテンプレートを `delegate.getListLength()` に合わせて現在の要素で更新する役割を担います（[src/vs/workbench/contrib/chat/browser/chatListRenderer.ts#L349-L666](src/vs/workbench/contrib/chat/browser/chatListRenderer.ts#L349-L666)）。
- `templateData` 自体は `templateDataByRequestId` マップにも保存されていて、`renderChatTreeItem` 内で各要素の `id` をキーに設定・上書きされます（`currentElement` を更新し、マップにも登録したあと、同じテンプレートを別要素で使うときに以前の参照を `clearRenderedParts` でリセットします）。過去にバインドされたテンプレートが不要になると `disposeElement` でマップから削除され、イベントなども解放されます（[src/vs/workbench/contrib/chat/browser/chatListRenderer.ts#L153-L1760](src/vs/workbench/contrib/chat/browser/chatListRenderer.ts#L153-L1760)）。
- `templateData` の内容は `renderChatTreeItem` で `currentElement` と CSS 状態を更新し、`renderChatResponseBasic`/`renderChatRequest`・`renderChatContentDiff` などで `renderedParts` を差分描画（必要に応じて `clearRenderedParts`/`dispose`）するたびに置き換わります。たとえばリクエスト描画時は `templateData.renderedParts` に新しいパーツ配列をセットし、レスポンスのプログレッシブ描画中は `renderChatContentDiff` で `renderedParts` を差し替えて DOM を更新しています（[src/vs/workbench/contrib/chat/browser/chatListRenderer.ts#L520-L899](src/vs/workbench/contrib/chat/browser/chatListRenderer.ts#L520-L899)）。

## templateData のながれ

- ChatWidget が `viewModel.getItems()` で `ChatTreeItem` のリストを作り、`this.tree.setChildren(null, treeItems, …)` で `WorkbenchObjectTree` に渡すところから描画が始まります。ここで “差分の ID を設定したツリー要素” を `ObjectTree` に流しているので、新規要素／更新要素がモデルに登録され、リストの再レンダリングがトリガーされます。[chatWidget.ts#L804-L859](src/vs/workbench/contrib/chat/browser/chatWidget.ts#L804-L859)
- `ObjectTree.setChildren` は単にモデルに委譲するだけなので、その段階では `ObjectTreeModel` が新しい要素群を記録します。[objectTree.ts#L40-L86](src/vs/base/browser/ui/tree/objectTree.ts#L40-L86)
- `AbstractTree` の `setupModel` がそのモデルの `onDidSpliceRenderedNodes` を監視し、差分イベントを `view.splice`（= `TreeNodeList.splice`）に渡します。`TreeNodeList` は `List` サブクラスで、差分を `super.splice` 経由で `ListView.splice` まで流し、フォーカス/選択の Trait も更新します。[abstractTree.ts#L2474-L2538](src/vs/base/browser/ui/tree/abstractTree.ts#L2474-L2538)／[abstractTree.ts#L3199-L3242](src/vs/base/browser/ui/tree/abstractTree.ts#L3199-L3242)
- `ListView` は `items: IItem<T>[]` という配列で現在の DOM 行を管理し、`splice` → `_splice` で差分を反映します。新しい要素を挿入するたびに `virtualDelegate.getTemplateId` で renderer を決め、`row.templateData` を保持した `IRow` を再利用しながら DOM を差し替えます。また `_splice` 中で既存 `row.templateData` を `renderer.disposeElement` に渡して解放する仕組みにより、テンプレート情報を `ListView` が握りながら renderer に受け渡し続けます。[listView.ts#L290-L340](src/vs/base/browser/ui/list/listView.ts#L290-L340)／[listView.ts#L617-L700](src/vs/base/browser/ui/list/listView.ts#L617-L700)
- つまり `templateData` は `ChatListItemRenderer.renderTemplate` で作られた後、`ListView.items` の対応する `row`（`IRow.templateData`）として保持され、差分が入るたびに `ListView.splice`→`renderer.renderElement()/disposeElement()` 経路で更新・破棄されています。これが “テンプレートデータが ListView に保存され、必要なときに renderer に渡される” 経路です。

## Agent への request から結果の表示まで

ChatWidget から agent の返答が表示されるまでの流れは次の順番です：

1. 入力受け取り → `ChatService.sendRequest()`
   `ChatWidget.acceptInput()` が `_acceptInput()` を呼び出し、`ChatService.sendRequest()` 経由でリクエストを送信します。この段階で入力文の解析や命令ファイルの付加、途中のキャンセル処理も行われます。[src/vs/workbench/contrib/chat/browser/chatWidget.ts#L2173-L2362]
   その後、`ChatServiceImpl` が `sendRequest` → `_sendRequestAsync` を呼び出し、`ChatModel.addRequest()` でリクエスト/レスポンスのペアを作成して pending リクエストを管理します。[src/vs/workbench/contrib/chat/common/chatServiceImpl.ts#L716-L880]

2. `ChatAgentService.invokeAgent()` → モデル更新
   `_sendRequestAsync()` 内で `ChatAgentService.invokeAgent()` を呼び出し、`progressCallback` がプログレスパーツを受け取るたびに `ChatModel.acceptResponseProgress()` を叩いてデータを蓄積し、最終的に `model.setResponse()` で結果を確定します。[src/vs/workbench/contrib/chat/common/chatAgents.ts#L480-L548] [src/vs/workbench/contrib/chat/common/chatModel.ts#L2116-L2184]
   これにより `ChatModel` が `addResponse`/`completedRequest` イベントを発火し、ファイル変化・コードブロックなども記録します。[src/vs/workbench/contrib/chat/common/chatModel.ts#L2116-L2184]

3. `ChatViewModel` → `ChatWidget` のリフレッシュ
   `ChatViewModel` は `ChatModel.onDidChange` を監視し、リクエストやレスポンスが追加されるたびに内部 `_items` を更新し、対応する `ChatResponseViewModel` の `onDidChange` で `viewModel.onDidChange` を発火します。[src/vs/workbench/contrib/chat/common/chatViewModel.ts#L287-L352]
   `ChatWidget.setModel()` ではこの `viewModel.onDidChange` を受けて `onDidChangeItems()` を呼び出し、`WorkbenchObjectTree` の要素を差分更新します。[src/vs/workbench/contrib/chat/browser/chatWidget.ts#L1971-L2050] `onDidChangeItems()` は `viewModel.getItems()` を元に `tree.setChildren()` を叩き、表示内容を再構築します。[src/vs/workbench/contrib/chat/browser/chatWidget.ts#L804-L860]

4. Tree → `ChatListRenderer` で DOM を生成
   `createList()` で `WorkbenchObjectTree` と `ChatListItemRenderer` を組み合わせ、ビューにバインドします。[src/vs/workbench/contrib/chat/browser/chatWidget.ts#L1452-L1548]
   `ChatListItemRenderer.renderChatTreeItem()` は各 `IChatRequestViewModel`/`IChatResponseViewModel` を受けてヘッダーやアバターを調整し、`renderChatResponseBasic()` や `renderChatContentDiff()` で Markdown/ツール呼び出し/引用などを DOM に差分レンダリングします。[src/vs/workbench/contrib/chat/browser/chatListRenderer.ts#L528-L1097]
   プログレス更新のたびに `renderChatContentDiff()` が呼ばれて新旧のパーツを比較・差し替えるため、agent からストリーミングされた部分も自然に表示されます。[src/vs/workbench/contrib/chat/browser/chatListRenderer.ts#L992-L1070]

この経路を追いかければ、チャット入力から `ChatAgentService` の progress → `ChatModel` のイベント → `ChatViewModel`/`ChatWidget` → `ChatListRenderer` の DOM 描画という全体像が把握できます。必要なら、実際のセッションで開発者ツールから `ChatModel` をウォッチするか、`ChatService` の `progressCallback` にブレークポイントを置くとどのタイミングで `acceptResponseProgress`/`setResponse` が走るか確かめられます。
