

### 起動プロセス

main.js
- workspace:///src/vs/code/electron-main/main.ts#L123-139
- workspace:///src/vs/code/electron-main/app.ts#L247-261
- workspace:///src/vs/platform/windows/electron-main/windowsMainService.ts
- workspace:///src/vs/code/electron-main/window.ts#L225-227 で electron の new BrowserWindow している
- workspace:///src/vs/code/electron-main/window.ts#L712-714

↑ electron-main プロセスで実行

↓ electron-browser プロセスで実行

- workspace:///src/vs/code/electron-browser/workbench/workbench.html
- workspace:///src/vs/code/electron-browser/workbench/workbench.js#L39-74
- workspace:///src/vs/workbench/workbench.desktop.main.ts#L14-18
- workspace:///src/vs/workbench/workbench.desktop.main.ts#L45
```typescript
import 'vs/workbench/services/extensions/electron-browser/extensionService'; // <- extension 管理 と RPC などのサービス
```
- workspace:///src/vs/workbench/workbench.sandbox.main.ts#L13-17
- workspace:///src/vs/workbench/workbench.common.main.ts

↓ extension 管理 と RPC などのサービス
- workspace:///src/vs/workbench/services/extensions/electron-browser/extensionService.ts

~

- workspace:///src/vs/workbench/workbench.desktop.main.ts#L44-46
- workspace:///src/vs/workbench/services/extensions/electron-browser/extensionService.ts#L413-431
- workspace:///src/vs/workbench/services/extensions/electron-browser/localProcessExtensionHost.ts#L205-206

fork

↓ child process で実行. node/ ディレクトリにあるコードが相当する.

- workspace:///src/vs/workbench/services/extensions/node/extensionHostProcess.ts#L1-8
- workspace:///src/vs/workbench/services/extensions/node/extensionHostProcessSetup.ts

### RPC の実装

RPC はプロトコルを定義するのではなく JavaScript の Proxy をベースに
Proxy を介して直接メソッドを呼ぶというインターフェイスになっている.
つまりプロトコルは TypeScript のクラス定義そのもの. 以下で定義されている.
- workspace:///src/vs/workbench/api/common/extHost.protocol.ts
proxy 経由のメソッドの名前には先頭に $ を付ける.

electron-browser プロセスでは fork が返した port を使って extension host と通信する.  _createExtensionHostCustomers で各サービスに登録している
- workspace:///src/vs/workbench/services/extensions/common/extensionHostManager.ts#L174-212

- workspace:///src/vs/workbench/services/extensions/common/rpcProtocol.ts


↓ extension host 側のセットアップ

socket を作成して, それを使って protocol を作成.
- workspace:///src/vs/workbench/services/extensions/node/extensionHostProcessSetup.ts#L115-142

protocol は ExtensionHostMain が保持.
- workspace:///src/vs/workbench/services/extensions/node/extensionHostProcessSetup.ts#L326-331

ExtensionHostMain の constructor で, RPC service に protocol をセットしている.
- workspace:///src/vs/workbench/services/extensions/common/extensionHostMain.ts#L40-58

extension host 用の各種サービスを起動. 各サービスは vs/workbench/api/common/extHostXXX というファイル名で実装されている.
- workspace:///src/vs/workbench/api/common/extHost.common.services.ts#L5
- workspace:///src/vs/workbench/api/node/extHost.node.services.ts#L5

~

- workspace:///src/vs/workbench/services/extensions/node/extensionHostProcessSetup.ts#L178-211
- workspace:///src/vs/workbench/services/extensions/node/extensionHostProcessSetup.ts#L297-335


extension host に対する browser プロセス側のAPI は以下のディレクトリにあるファイルで定義されている
- workspace:///src/vs/workbench/api/browser/

例えば Code Inset では MainThreadEditorInsetsShape と ExtHostEditorInsetsShape を定義して
- workspace:///src/vs/workbench/api/common/extHost.protocol.ts#L571-584

browser 側は MainThreadEditorInsetsShape を実装,
- workspace:///src/vs/workbench/api/browser/mainThreadCodeInsets.ts#L55-68
```ts
export class MainThreadEditorInsets implements MainThreadEditorInsetsShape {

	private readonly _proxy: ExtHostEditorInsetsShape;
	private readonly _disposables = new DisposableStore();
	private readonly _insets = new Map<number, EditorWebviewZone>();

	constructor(
		context: IExtHostContext,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@IWebviewService private readonly _webviewService: IWebviewService,
	) {
		this._proxy = context.getProxy(ExtHostContext.ExtHostEditorInsets);
	}

```

extension host 側は以下で ExtHostEditorInsetsShape を実装している
- workspace:///src/vs/workbench/api/common/extHostCodeInsets.ts#L16-38
```ts
export class ExtHostEditorInsets implements ExtHostEditorInsetsShape {

	private _handlePool = 0;
	private _disposables = new DisposableStore();
	private _insets = new Map<number, { editor: vscode.TextEditor, inset: vscode.WebviewEditorInset, onDidReceiveMessage: Emitter<any> }>();

	constructor(
		private readonly _proxy: MainThreadEditorInsetsShape,
		private readonly _editors: ExtHostEditors,
		private readonly _initData: WebviewInitData
	) {

		// dispose editor inset whenever the hosting editor goes away
		this._disposables.add(_editors.onDidChangeVisibleTextEditors(() => {
			const visibleEditor = _editors.getVisibleTextEditors();
			for (const value of this._insets.values()) {
				if (visibleEditor.indexOf(value.editor) < 0) {
					value.inset.dispose(); // will remove from `this._insets`
				}
			}
		}));
	}

```
以下で proxy と一緒に生成している
- workspace:///src/vs/workbench/api/common/extHost.api.impl.ts#L134
```ts
	const extHostEditorInsets = rpcProtocol.set(ExtHostContext.ExtHostEditorInsets, new ExtHostEditorInsets(rpcProtocol.getProxy(MainContext.MainThreadEditorInsets), extHostEditors, initData.environment));
```
