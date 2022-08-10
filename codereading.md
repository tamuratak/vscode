
## TODO

- VS Code Remote
- VS Code on Web
- 拡張機能の扱い方

## 起動プロセス

Electron アプリは package.json を読んで main を実行する。

- https://www.electronjs.org/ja/docs/latest/tutorial/tutorial-first-app

指定されている main は

- workspace://1b27c830d29f/src/main.js#L130

### サブプロセスの起動

環境変数 VSCODE_AMD_ENTRYPOINT を loader が読み込む.
VSCODE_AMD_ENTRYPOINT を設定して bootstrap-fork.js をロードしている.
- workspace://1b27c830d29f/src/bootstrap-fork.js#L45-46
```js
// Load AMD entry point
require('./bootstrap-amd').load(process.env['VSCODE_AMD_ENTRYPOINT']);
```

### extensionHost の起動まで
main.js
- workspace:///src/vs/code/electron-main/main.ts
- workspace://1b27c830d29f/src/vs/code/electron-main/app.ts#L371-380
- workspace:///src/vs/platform/windows/electron-main/windowsMainService.ts

new BrowserWindow している
- workspace://0bdcc12da406/src/vs/platform/windows/electron-main/window.ts#L278-282
```ts
			// Create the browser window
			mark('code/willCreateCodeBrowserWindow');
			this._win = new BrowserWindow(options);
			mark('code/didCreateCodeBrowserWindow');
```

- workspace://0bdcc12da406/src/vs/platform/windows/electron-main/window.ts#L851-852

↑ electron-main プロセスで実行

↓ electron-browser プロセスで実行

- workspace:///src/vs/code/electron-sandbox/workbench/workbench.html  <- 大元の表示する html
- workspace://1b27c830d29f/src/vs/code/electron-sandbox/workbench/workbench.js#L21-25
- workspace://1b27c830d29f/src/vs/workbench/workbench.desktop.main.ts#L18
- workspace://1b27c830d29f/src/vs/workbench/workbench.desktop.main.ts#L86
```ts
import 'vs/workbench/services/extensions/electron-sandbox/sandboxExtensionService';
```
- workspace:///src/vs/workbench/workbench.common.main.ts

↓ extension 管理 と RPC などのサービス
- workspace:///src/vs/workbench/services/extensions/electron-browser/extensionService.ts


- workspace:///src/vs/workbench/workbench.desktop.main.ts#L44-46
- workspace:///src/vs/workbench/services/extensions/electron-browser/extensionService.ts#L413-431
- workspace:///src/vs/workbench/services/extensions/electron-browser/localProcessExtensionHost.ts#L205-206

- workspace:///src/vs/platform/extensions/electron-main/extensionHostStarter.ts#L202-206
```ts
		this._process = fork(
			FileAccess.asFileUri('bootstrap-fork', require).fsPath,
			['--type=extensionHost', '--skipWorkspaceStorageLock'],
			mixin({ cwd: cwd() }, opts),
		);
```

fork

↓ child process で実行. node/ ディレクトリにあるコードが相当する.

- workspace:///src/vs/workbench/services/extensions/node/extensionHostProcess.ts#L1-8
- workspace:///src/vs/workbench/services/extensions/node/extensionHostProcessSetup.ts




### Remote Server

Remote Server の起動は以下のような流れで行われる.

以下が参考になる.

- workspace:///extensions/vscode-test-resolver/src/extension.ts#L115
```ts
				extHostProcess = cp.spawn(serverCommandPath, commandArgs, { env, cwd: vscodePath });
```


scripts/code-server.sh を実行 -> scripts/code-server.js ->

1. src/server-cli.js
2. src/server-main.js

- workspace:///src/server-main.js#L111
```js
		return remoteExtensionHostAgentServer.handleUpgrade(req, socket);
```


- workspace:///src/vs/server/node/extensionHostConnection.ts#L43
```ts
			VSCODE_AMD_ENTRYPOINT: 'vs/workbench/api/node/extensionHostProcess',
```

- workspace:///src/vs/server/node/extensionHostConnection.ts#L260
```ts
			this._extensionHostProcess = cp.fork(FileAccess.asFileUri('bootstrap-fork', require).fsPath, args, opts);
```


### CLI

code コマンドの本体

- workspace:///src/cli.js#L34
- workspace:///src/vs/code/node/cli.ts#L43

code コマンドから実行する拡張のインストールなどの機能のコンポーネント

- workspace:///src/vs/code/node/cliProcessMain.ts#L285

## DI コンテナ

DI コンテナの使われ方を追えば、アプリケーションの全体像が見える。
DI コンテナ自体を生成している === main 関数 なので。

DI コンテナの interface
workspace:///src/vs/platform/instantiation/common/instantiation.ts#L47


DI コンテナの実装
workspace:///src/vs/platform/instantiation/common/instantiationService.ts#L23

DI コンテナの生成
- workspace:///src/vs/code/electron-browser/sharedProcess/sharedProcessMain.ts#L362
- workspace:///src/vs/code/electron-main/main.ts#L218
- workspace:///src/vs/code/node/cliProcessMain.ts#L222
- workspace:///src/vs/editor/standalone/browser/standaloneServices.ts#L1005
- workspace:///src/vs/server/node/remoteExtensionHostAgentCli.ts#L118
- workspace:///src/vs/server/node/serverServices.ts#L171
- workspace:///src/vs/workbench/api/common/extensionHostMain.ts#L60
- workspace:///src/vs/workbench/browser/workbench.ts#L202


### createChild が面白い

workspace:////src/vs/platform/instantiation/common/instantiationService.ts#L39
```ts
	createChild(services: ServiceCollection): IInstantiationService {
```

## Service

複数のコンポーネントから使われるようなメソッドが定義されたオブジェクト.
DI コンテナに保持されている.

以下のコートが面白い.

workspace:///src/vs/base/parts/ipc/common/ipc.ts#L1037
```ts
	export function fromService<TContext>(service: unknown, options?: ICreateServiceChannelOptions): IServerChannel<TContext> {
```


workspace:///src/vs/base/parts/ipc/common/ipc.ts#L1102
```ts
	export function toService<T extends object>(channel: IChannel, options?: ICreateProxyServiceOptions): T {
```


## RPC の実装

### 概要

IChannel, IServerChannel と IMessagePassingProtocol がある. IChannel, IServerChannelはセット.
引数の serialize が必要な場合は, 後者を使う? 拡張機能関連は主に後者を使う.
IChannel, IServerChannel が使われている率は割と少ない.
- workspace:///src/vs/base/parts/ipc/common/ipc.ts

IChannel, IServerChannel は ProxyChannel.fromService か Server.registerChannel 経由で使われる. target の id は文字列. 異なるプロセス間での
id の共有は、文字列の同一性により保証される. channelName と呼ばれている.

IMessagePassingProtocol は RPCProtocol 経由で使われる. getProxy が色んな所で呼ばれている.
- workspace:///src/vs/workbench/services/extensions/common/rpcProtocol.ts

RPC の id は getProxy の引数(のプロパティ)が id である. 異なるプロセス間での RPC の id の共有は
id 生成のコードが同一であるということで保証している.  src/vs/workbench/api/common/extHost.protocol.ts の createProxyIdentifier の呼び出しが同一なら id も同一.

RPC は JavaScript の Proxy をつかっている. Proxy を介してメソッドを呼ぶ.
Proxy の使い方： Proxy オブジェクトのプロパティは `get` が返すオブジェクトで置換されるので,
`get` が関数を返すことによって, Proxy オブジェクトのメソッド呼び出しを操作することができる.
- https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy

- workspace:///src/vs/base/parts/ipc/common/ipc.ts#L1105
```ts
		return new Proxy({}, {
```

以下のコードでは `handler` が単なるオブジェクトでも `target` は関数になるので,
以下のコードは有効であることに注意する.
handler としてサービスオブジェクトを渡すだけで, ちゃんと実装したことになっている.

workspace:///src/vs/base/parts/ipc/common/ipc.ts#L1059-1062
```ts
					const target = handler[event];
					if (typeof target === 'function') {
						return target.call(handler, arg);
					}
```


- workspace:///src/vs/base/parts/ipc/common/ipc.ts#L1126-1145
```ts
					// Function
					return async function (...args: any[]) {

						// Add context if any
						let methodArgs: any[];
						if (options && !isUndefinedOrNull(options.context)) {
							methodArgs = [options.context, ...args];
						} else {
							methodArgs = args;
						}

						const result = await channel.call(propKey, methodArgs);

						// Revive unless marshalling disabled
						if (!disableMarshalling) {
							return revive(result);
						}

						return result;
					};
```

Proxy 経由のメソッドの名前には先頭に $ を付ける.
- workspace:///src/vs/workbench/api/common/extHost.protocol.ts

electron-browser プロセスでは fork が返した port を使って extension host と通信する.  _createExtensionHostCustomers で各サービスに登録している
- workspace:///src/vs/workbench/services/extensions/common/extensionHostManager.ts#L174-212


### 実装詳細

`global.vscodePorts` に fork が返した port が保存される.

workspace:///src/bootstrap-fork.js#L240-251
```js
function listenForMessagePort() {
	// We need to listen for the 'port' event as soon as possible,
	// otherwise we might miss the event. But we should also be
	// prepared in case the event arrives late.
	process.on('port', (e) => {
		if (global.vscodePortsCallback) {
			global.vscodePortsCallback(e.ports);
		} else {
			global.vscodePorts = e.ports;
		}
	});
}
```


### 実装詳細 その2

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


## Editor の DOM の操作

ContentViewOverlays の overlay は selection や decoration や indent guide など
追加で表示すること


### code editor の各行

実際の DOM の操作は以下

workspace:///src/vs/editor/browser/viewParts/lines/viewLine.ts#L240-251
```ts
		sb.appendASCIIString('<div style="top:');
		sb.appendASCIIString(String(deltaTop));
		sb.appendASCIIString('px;height:');
		sb.appendASCIIString(String(this._options.lineHeight));
		sb.appendASCIIString('px;" class="');
		sb.appendASCIIString(ViewLine.CLASS_NAME);
		sb.appendASCIIString('">');

		const output = renderViewLine(renderLineInput, sb);

		sb.appendASCIIString('</div>');

```

### アーキテクチャ

workspace:///src/vs/editor/browser/viewParts/lines/viewLine.ts#L121-126
```ts

export class ViewLine implements IVisibleLine {

	public static readonly CLASS_NAME = 'view-line';

	private _options: ViewLineOptions;
```

workspace:///src/vs/editor/browser/view/viewLayer.ts#L370-375
```ts
class ViewLayerRenderer<T extends IVisibleLine> {

	readonly domNode: HTMLElement;
	readonly host: IVisibleLinesHost<T>;
	readonly viewportData: ViewportData;

```

workspace:///src/vs/editor/browser/view/viewLayer.ts#L249-254
```ts
export class VisibleLinesCollection<T extends IVisibleLine> {

	private readonly _host: IVisibleLinesHost<T>;
	public readonly domNode: FastDomNode<HTMLElement>;
	private readonly _linesCollection: RenderedLinesCollection<T>;

```

workspace:///src/vs/editor/browser/viewParts/lines/viewLines.ts#L87-97
```ts
export class ViewLines extends ViewPart implements IVisibleLinesHost<ViewLine>, IViewLines {
	/**
	 * Adds this amount of pixels to the right of lines (no-one wants to type near the edge of the viewport)
	 */
	private static readonly HORIZONTAL_EXTRA_PX = 30;

	private readonly _linesContent: FastDomNode<HTMLElement>;
	private readonly _textRangeRestingSpot: HTMLElement;
	private readonly _visibleLines: VisibleLinesCollection<ViewLine>;  // <- ここ
	private readonly domNode: FastDomNode<HTMLElement>;

```

workspace:///src/vs/editor/browser/view/viewImpl.ts#L64-90
```ts
export class View extends ViewEventHandler {

	private readonly _scrollbar: EditorScrollbar;
	private readonly _context: ViewContext;
	private _selections: Selection[];

	// The view lines
	private readonly _viewLines: ViewLines;   // <- ここ

	// These are parts, but we must do some API related calls on them, so we keep a reference
	private readonly _viewZones: ViewZones;
	private readonly _contentWidgets: ViewContentWidgets;
	private readonly _overlayWidgets: ViewOverlayWidgets;
	private readonly _viewCursors: ViewCursors;
	private readonly _viewParts: ViewPart[];

	private readonly _textAreaHandler: TextAreaHandler;
	private readonly _pointerHandler: PointerHandler;

	// Dom nodes
	private readonly _linesContent: FastDomNode<HTMLElement>;
	public readonly domNode: FastDomNode<HTMLElement>;
	private readonly _overflowGuardContainer: FastDomNode<HTMLElement>;

	// Actual mutable state
	private _renderAnimationFrame: IDisposable | null;

```

workspace:///src/vs/editor/browser/view/viewImpl.ts#L199-204
```ts
		this._linesContent.appendChild(contentViewOverlays.getDomNode());
		this._linesContent.appendChild(rulers.domNode);
		this._linesContent.appendChild(this._viewZones.domNode);
		this._linesContent.appendChild(this._viewLines.getDomNode());
		this._linesContent.appendChild(this._contentWidgets.domNode);
		this._linesContent.appendChild(this._viewCursors.getDomNode());
```

workspace:///src/vs/editor/browser/widget/codeEditorWidget.ts#L80-83
```ts
class ModelData {
	public readonly model: ITextModel;
	public readonly viewModel: ViewModel;
	public readonly view: View;
```

workspace:///src/vs/editor/browser/widget/codeEditorWidget.ts#L218-220
```ts
	// --- Members logically associated to a model
	protected _modelData: ModelData | null;    // <- ここ

```


## 入力イベント

workspace:///src/vs/editor/browser/controller/ で制御している?


### Code Editor のキーボードイベント

以下で扱っている.

workspace:///src/vs/editor/browser/controller/textAreaInput.ts#L102-174
```ts
/**
 * Writes screen reader content to the textarea and is able to analyze its input events to generate:
 *  - onCut
 *  - onPaste
 *  - onType
 *
 * Composition events are generated for presentation purposes (composition input is reflected in onType).
 */
export class TextAreaInput extends Disposable {

    // 中略

	private _onKeyDown = this._register(new Emitter<IKeyboardEvent>());
	public readonly onKeyDown: Event<IKeyboardEvent> = this._onKeyDown.event;

    // 中略

	constructor(host: ITextAreaInputHost, private textArea: FastDomNode<HTMLTextAreaElement>) {
		super();
		this._host = host;
		this._textArea = this._register(new TextAreaWrapper(textArea));
		this._asyncTriggerCut = this._register(new RunOnceScheduler(() => this._onCut.fire(), 0));

		this._textAreaState = TextAreaState.EMPTY;
		this._selectionChangeListener = null;
		this.writeScreenReaderContent('ctor');

		this._hasFocus = false;
		this._isDoingComposition = false;
		this._nextCommand = ReadFromTextArea.Type;

		let lastKeyDown: IKeyboardEvent | null = null;

		this._register(dom.addStandardDisposableListener(textArea.domNode, 'keydown', (e: IKeyboardEvent) => { // <- ここで 'keydown' イベントのリスナーを登録している
```


workspace:///src/vs/editor/browser/controller/textAreaHandler.ts#L59-92
```ts
export class TextAreaHandler extends ViewPart {

	// 中略

	private readonly _textAreaInput: TextAreaInput; // <- ここ

```

最終的には以下で Code Editor の root の dom に addEventListener を呼んでいる.

workspace:///src/vs/base/browser/dom.ts#L99-111
```ts
class DomListener implements IDisposable {

    // 中略

	constructor(node: EventTarget, type: string, handler: (e: any) => void, options?: boolean | AddEventListenerOptions) {
		this._node = node;
		this._type = type;
		this._handler = handler;
		this._options = (options || false);
		this._node.addEventListener(this._type, this._handler, this._options); // <- ここ this._type が 'keydown' など
```


### registerCommand('type', callback) の謎

キーを入力するたびに登録した callback が実行される.

workspace:///src/vs/editor/browser/widget/codeEditorWidget.ts#L1587-1590

workspace:///src/vs/editor/browser/widget/codeEditorWidget.ts#L984-998

workspace:///src/vs/editor/browser/controller/coreCommands.ts#L1872-1923

#### extension host がブロックしている場合、UI プロセスはどこでブロックするか

実際は UI プロセスがブロックすることはなくて 入力したキーが callback の実行を経てドキュメントに反映されるので、
その分遅れて見えるだけ。

## WebView の実装

## pstree

```
 |-+= 57348 tamura /Applications/Visual Studio Code.app/Contents/MacOS/Electron
 | |--- 57351 tamura /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (GPU).app/Contents/MacOS/Code Helper (GPU) --type=gpu-process --disable-color-correct-rendering
 | |--- 57353 tamura /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper --type=utility
 | |-+- 57363 tamura /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Renderer).app/Contents/MacOS/Code Helper (Renderer) --type=renderer --vscode-window-kind=shared-process
 | | |-+- 57365 tamura /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Renderer).app/Contents/MacOS/Code Helper (Renderer) --type=ptyHost
 | | | \--= 57529 tamura /bin/zsh -l
 | | \--- 57491 tamura /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Renderer).app/Contents/MacOS/Code Helper (Renderer) --type=fileWatcher
 | |--- 57489 tamura /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Renderer).app/Contents/MacOS/Code Helper (Renderer) --type=renderer
 | \-+- 57490 tamura /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper --type=extensionHost
 |   |--- 57545 tamura /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper /Applications/Visual Studio Code.app/Contents/Resources/app/extensions/node_modules/typescript/lib/tsserver.js
 |   |-+- 57546 tamura /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper --max-old-space-size=3072 /Applications/Visual Studio Code.app/Contents/Resources/app/extensions/node_modules/typescript/lib/tsserver.js
 |   | \--- 57551 tamura /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper /Applications/Visual Studio Code.app/Contents/Resources/app/extensions/node_modules/typescript/lib/typingsInstaller.js
 |   \--- 57562 tamura /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper /Applications/Visual Studio Code.app/Contents/Resources/app/extensions/json-language-features/server/dist/node/jsonServerMain
 ```

