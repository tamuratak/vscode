
# Git worktree（agent 関連）の調査メモ

- **概要**: バックグラウンドエージェントが生成する作業コピー（worktree）は、VS Code の Git 拡張側で `createWorktree` / `deleteWorktree` API と UI コマンドを経由して作成・列挙・削除される。チャット編集セッションはセッション固有の URI（例: scheme + '-worktree-changes'）を用いてその差分をマルチ diff で表示する。

- **作成（creation）**:
	- コマンド: `git.createWorktree` / `git.repositories.createWorktree` → 内部で `_createWorktree` → `Repository.createWorktree` を呼ぶ。参照: [extensions/git/src/commands.ts](/extensions/git/src/commands.ts#L3438-L3461), [extensions/git/src/repository.ts](/extensions/git/src/repository.ts#L1834-L1874).
	- パス決定: ブランチ名／コミット名から worktree 名を生成し、既定ルートは global state に保存された `worktreeRoot` または `<repo>.worktrees/<name>`。衝突があれば末尾に `-1` などを付与してユニーク化する。

- **一覧（listing / 管理）**:
	- Git 拡張は定期的に `repository.getWorktrees()` を呼んで `_worktrees` を更新し、`Repository.worktrees` として UI や重複検知に利用する。実際の更新経路は `_updateModelState` / `getWorktrees` 経路を通る。参照: [extensions/git/src/repository.ts](/extensions/git/src/repository.ts#L2606-L2632).

- **削除（deletion）**:
	- コマンド経路: Repositories ツリーやコマンドパレットから `repository.deleteWorktree(path)` を呼ぶ。UI は変更がある worktree を force 削除するか確認するダイアログを表示する実装になっている。参照: [extensions/git/src/repository.ts](/extensions/git/src/repository.ts#L1877-L1901), [extensions/git/src/commands.ts](/extensions/git/src/commands.ts#L5330-L5359).

- **Copilot ワークツリー特有の扱い**:
	- 名前判定: `isCopilotWorktree(path)` が `copilot-worktree-` プレフィックスで判定する。該当ワークツリーはアイコンを `chat-sparkle` にし、親リポジトリが開かれている場合は一時的に Repositories ビューで非表示にする（しかし手動で開くことは可能）。参照: [extensions/git/src/util.ts](/extensions/git/src/util.ts#L870-L875), [extensions/git/src/repository.ts](/extensions/git/src/repository.ts#L946-L963).

- **チャット編集セッションとの紐付け**:
	- チャット編集側はセッションの差分を格納し、`ViewAllSessionChangesAction` がセッション URI に `-worktree-changes` を付加して `_workbench.openMultiDiffEditor` を呼び、マルチ diff 表示を実現する。参照: [src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingActions.ts](/src/vs/workbench/contrib/chat/browser/chatEditing/chatEditingActions.ts#L329-L352).

- **運用上の注意**:
	- Copilot が自動生成した worktree は名前や保存場所（`.worktrees` フォルダや global state の worktreeRoot）を利用するため、意図しないゴミ残りを避けるには作成後の lifecycle（不要になったら deleteWorktree を呼ぶ）を管理する必要がある。

