

## 起動プロセス

main.js
- workspace:///src/vs/code/electron-main/main.ts#L123-139
- workspace:///src/vs/code/electron-main/app.ts#L247-261
- workspace:///src/vs/platform/windows/electron-main/windowsMainService.ts
- workspace:///src/vs/code/electron-main/window.ts#L225-227 で electron の new BrowserWindow している
- workspace:///src/vs/code/electron-main/window.ts#L712-714

↑ electron-main プロセスで実行

↓ electron-browser プロセスで実行

- workspace:///src/vs/code/electron-browser/workbench/workbench.html  <- 大元の表示する html
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

## RPC の実装

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

