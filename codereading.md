## TODO

- VS Code Remote
- VS Code on Web
- extension host が複数ある場合は? rederer プロセスのリクエストはどの host にとばされるのか?
- 拡張機能の扱い方 拡張機能はAPI呼び出しがどう言う流れで実行されるか
- WebView
- api.impl.ts は extension host 側で実行される


## 全体のアーキテクチャ

以下のような複数のプロセスから構成される. pstree で確認. プロセス間通信の方法は改修中なので流動的.

main
+ renderer プロセス
+ extension host
+ shared プロセス
  + pty などいろいろ

依存するサービスが静的に決定されるプロセス内でユニークなオブジェクトは DI コンテナが生成のすべてを管理する.
registerSingleton などを呼んで登録する. DI コンテナの起動は、
1. 最初に必要なサービスを手動で生成して,
2. それらを引数にして new InstantiationService を呼んで,
3. registerSingleton などで登録しておいたサービスを生成する.
という手順. registerSingleton を使うのは extensionHost と renderer プロセス.

以下は renderer プロセスのサービス登録用のインデックス.

- workspace://ca824e6c1458/src/vs/workbench/workbench.desktop.main.ts
- workspace://3e8a8ee109e2/src/vs/workbench/workbench.web.main.ts

サービスのコンストラクタの例.

- workspace://6770e54beaad/src/vs/workbench/services/editor/browser/codeEditorService.ts#L19-25
```ts
export class CodeEditorService extends AbstractCodeEditorService {

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
```

依存するオブジェクトやサービスが動的に決定する場合には, createInstance メソッドを使う.


rpcProtocol に登録する

- workspace://0945ef6e358d/src/vs/workbench/services/extensions/common/extensionHostManager.ts#L299
```ts
				this._rpcProtocol.set(id, instance);
```



extension host との通信. rennderer プロセスから起動して extension host との port などを引数にして createInstance で
サービスオブジェクトを生成.

browser: ブラウザ上の renderer 用のコード
electron-sandbox: electron の renderer プロセス用のコード
electron-main: electron の main プロセス用のコード
common: 共通で使われるコード
node: extension host, shared process などのコード
worker: extension host, shared process などの worker 実装のコード

## 一時的メモ


- workspace://be5af93ef66c/src/vs/workbench/electron-sandbox/desktop.main.ts#L148-155
```ts
		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
		//
		// NOTE: Please do NOT register services here. Use `registerSingleton()`
		//       from `workbench.common.main.ts` if the service is shared between
		//       desktop and web or `workbench.desktop.main.ts` if the service
		//       is desktop only.
		//
		// !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
```

- workspace://aa0e7b731a74/src/vs/workbench/api/common/extHost.api.impl.ts#L168
```ts
	const extHostEditorInsets = rpcProtocol.set(ExtHostContext.ExtHostEditorInsets, new ExtHostEditorInsets(rpcProtocol.getProxy(MainContext.MainThreadEditorInsets), extHostEditors, initData.remote));
```

↓このメソッドで RPC 呼び出し先を設定している はず. renderer プロセスで実行される.

workspace://0945ef6e358d/src/vs/workbench/services/extensions/common/extensionHostManager.ts#L261
```ts
	private _createExtensionHostCustomers(protocol: IMessagePassingProtocol): IExtensionHostProxy {
```

しかし,

workspace://0945ef6e358d/src/vs/workbench/services/extensions/common/extensionHostManager.ts#L297
```ts
				const instance = this._instantiationService.createInstance(ctor, extHostContext);
```


- workspace://b524d80d9c5e/src/vs/workbench/services/extensions/common/abstractExtensionService.ts#L863
```ts
			const extHostManager = this._createExtensionHostManager(location, isInitialStart, initialActivationEvents);
```

以下の部分で _startExtensionHostsIfNecessary は _scanAndHandleExtensions 内でも呼ばれる.

- workspace://b524d80d9c5e/src/vs/workbench/services/extensions/common/abstractExtensionService.ts#L753-762
```ts
	protected async _initialize(): Promise<void> {
		perf.mark('code/willLoadExtensions');
		this._startExtensionHostsIfNecessary(true, []);

		const lock = await this._registryLock.acquire('_initialize');
		try {
			await this._scanAndHandleExtensions();
		} finally {
			lock.dispose();
		}
```

_startExtensionHostsIfNecessary -> _createExtensionHostManager -> _createExtensionHost

- workspace://342394d1e7d4/src/vs/workbench/services/extensions/electron-sandbox/electronExtensionService.ts#L236-255
```ts
	protected _createExtensionHost(runningLocation: ExtensionRunningLocation, isInitialStart: boolean): IExtensionHost | null {
		switch (runningLocation.kind) {
			case ExtensionHostKind.LocalProcess: {
				return this._instantiationService.createInstance(SandboxLocalProcessExtensionHost, runningLocation, this._createLocalExtensionHostDataProvider(isInitialStart, runningLocation));
			}
			case ExtensionHostKind.LocalWebWorker: {
				if (this._enableLocalWebWorker) {
					return this._instantiationService.createInstance(WebWorkerExtensionHost, runningLocation, this._lazyLocalWebWorker, this._createLocalExtensionHostDataProvider(isInitialStart, runningLocation));
				}
				return null;
			}
			case ExtensionHostKind.Remote: {
				const remoteAgentConnection = this._remoteAgentService.getConnection();
				if (remoteAgentConnection) {
					return this._instantiationService.createInstance(RemoteExtensionHost, runningLocation, this._createRemoteExtensionHostDataProvider(remoteAgentConnection.remoteAuthority), this._remoteAgentService.socketFactory);
				}
				return null;
			}
		}
	}
```



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

extension host は1つとは限らない. ローカルの extension host を起動してから、
リモートを extension host の起動を試みる. 失敗したらそのままローカルの extension host を使う.

- workspace://b524d80d9c5e/src/vs/workbench/services/extensions/common/abstractExtensionService.ts#L851

_scanAndHandleExtensions でリモートの host の起動を試している.

- workspace://b524d80d9c5e/src/vs/workbench/services/extensions/common/abstractExtensionService.ts#L755-759
```ts
		this._startExtensionHostsIfNecessary(true, []);

		const lock = await this._registryLock.acquire('_initialize');
		try {
			await this._scanAndHandleExtensions();
```


今は sandbox に移行中. nativeLocalProcessExtensionHost が古い方.
- workspace://f4f1b04d872a/src/vs/workbench/services/extensions/electron-sandbox/sandboxExtensionService.ts#L15
```ts
			// TODO@bpasero remove me once electron utility process has landed
```

main.js
- workspace:///src/vs/code/electron-main/main.ts
- workspace://1b27c830d29f/src/vs/code/electron-main/app.ts#L371-380
- workspace://01769e0bb156/src/vs/platform/windows/electron-main/windowsMainService.ts

- https://www.electronjs.org/docs/latest/tutorial/process-model#window-management

new BrowserWindow している. new BrowserWindow は新しい 子process を起動する.
- workspace://0bdcc12da406/src/vs/platform/windows/electron-main/window.ts#L278-282
```ts
			// Create the browser window
			mark('code/willCreateCodeBrowserWindow');
			this._win = new BrowserWindow(options);
			mark('code/didCreateCodeBrowserWindow');
```

- workspace://0bdcc12da406/src/vs/platform/windows/electron-main/window.ts#L851-852

↓ 大元の表示する html
- workspace://1b27c830d29f/src/vs/code/electron-sandbox/workbench/workbench.html
- workspace://1b27c830d29f/src/vs/code/electron-sandbox/workbench/workbench.js#L21-25
- workspace://1b27c830d29f/src/vs/workbench/workbench.desktop.main.ts#L18
- workspace://1b27c830d29f/src/vs/workbench/workbench.desktop.main.ts#L86
```ts
import 'vs/workbench/services/extensions/electron-sandbox/sandboxExtensionService';
```
- workspace://472c8a9fd36b/src/vs/workbench/services/extensions/electron-sandbox/sandboxExtensionService.ts#L18
```ts
		return super._createExtensionHost(runningLocation, isInitialStart);
```

- workspace://01769e0bb156/src/vs/workbench/services/extensions/electron-sandbox/localProcessExtensionHost.ts#L188-199
- workspace://01769e0bb156/src/vs/workbench/services/extensions/electron-sandbox/localProcessExtensionHost.ts#L217-220
```ts
		const env = objects.mixin(processEnv, {
			VSCODE_AMD_ENTRYPOINT: 'vs/workbench/api/node/extensionHostProcess',
			VSCODE_HANDLES_UNCAUGHT_ERRORS: true
		});
```

↓ 実際の起動は fork を呼んでいる
- workspace://01769e0bb156/src/vs/platform/extensions/electron-main/extensionHostStarter.ts#L197-206
```ts
	start(opts: IExtensionHostProcessOptions): void {
		if (platform.isCI) {
			this._logService.info(`Calling fork to start extension host...`);
		}
		const sw = StopWatch.create(false);
		this._process = fork(
			FileAccess.asFileUri('bootstrap-fork', require).fsPath,
			['--type=extensionHost', '--skipWorkspaceStorageLock'],
			mixin({ cwd: cwd() }, opts),
		);
```

↓ fork で実行されるファイル
- workspace://1677341a4a85/src/vs/workbench/api/node/extensionHostProcess.ts

#### 注意

一見、main プロセスの子プロセスである renderer プロセス(electron-sandbox/workbench/workbench.html)から
extensionHostStarter.start つまり fork を呼び出しているように見えるが、
RPC なので実際は main プロセスが fork を呼んでいる.

workspace://472c8a9fd36b/src/vs/workbench/services/extensions/electron-sandbox/localProcessExtensionHost.ts#L90
```ts
		return this._extensionHostStarter.start(this._id, opts);
```

実際、extensionHostStarter が new されるのは main プロセスにおいてのみである。

workspace://472c8a9fd36b/src/vs/code/electron-main/app.ts#L659
```ts
		services.set(IExtensionHostStarter, new SyncDescriptor(ExtensionHostStarter));
```


## VS Code Remote

VS Code Remote は起動手順は以下の通り

1. remote server をダウンロードする.
1. remote server (extension host) プロセスを起動する.
2. VS Code Remote 拡張が vscode.ResolvedAuthority を呼ぶ.
3. VS Code 本体が remote server (extension host) に接続する

remoteAuthority は vscode-remote+hostname のように「接続方法+ホスト名」になっている.
vscode-remote は authorityPrefix と呼ばれる. vscode.workspace.registerRemoteAuthorityResolver に登録する.

- workspace://9d0b225acf5f/src/vscode-dts/vscode.proposed.resolvers.d.ts#L210
```ts
		export function registerRemoteAuthorityResolver(authorityPrefix: string, resolver: RemoteAuthorityResolver): Disposable;
```
workspace://0656d21d1191/extensions/vscode-test-resolver/src/extension.ts#L283
```ts
		return vscode.commands.executeCommand('vscode.newWindow', { remoteAuthority: 'test+test', reuseWindow: true });
```

### vscode-test-resolver

以下が参考になる.

Code OSS で vscode-testresolver.newWindow を呼ぶと, 以下の VS Code Remote のテスト実装が実行される.

- workspace://0656d21d1191/extensions/vscode-test-resolver/src/extension.ts#L115
```ts
				extHostProcess = cp.spawn(serverCommandPath, commandArgs, { env, cwd: vscodePath });
```

- workspace://0656d21d1191/extensions/vscode-test-resolver/src/extension.ts#L231
```ts
					const r: vscode.ResolverResult = new vscode.ResolvedAuthority('127.0.0.1', port, connectionToken);
```

### メモ

workspace://a567b593d526/src/vs/workbench/services/environment/electron-sandbox/environmentService.ts#L63
```ts
	get remoteAuthority() { return this.configuration.remoteAuthority; }
```

workspace://a567b593d526/src/vs/workbench/electron-sandbox/desktop.main.ts#L171
```ts
		const environmentService = new NativeWorkbenchEnvironmentService(this.configuration, productService);
```

workspace://342394d1e7d4/src/vs/workbench/services/extensions/electron-sandbox/electronExtensionService.ts#L464
```ts
		const remoteAuthority = this._environmentService.remoteAuthority;
```

### 実装詳細

コールスタック. ここから

- workspace://4878dfa5a1b4/src/vs/workbench/api/browser/mainThreadExtensionService.ts#L202
```ts
		return this._actual.$resolveAuthority(remoteAuthority, resolveAttempt);
```

...

- workspace://b524d80d9c5e/src/vs/workbench/services/extensions/common/abstractExtensionService.ts#L759
```ts
			await this._scanAndHandleExtensions();
```
ここまで.

### Code OSS での起動手順

以下で使っている.

- workspace://0656d21d1191/extensions/vscode-test-resolver/src/extension.ts#L109
```ts
				const serverCommand = process.platform === 'win32' ? 'code-server.bat' : 'code-server.sh';
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


## CLI

code コマンドの本体

- workspace:///src/cli.js#L34
- workspace:///src/vs/code/node/cli.ts#L43

code コマンドから実行する拡張のインストールなどの機能のコンポーネント

- workspace:///src/vs/code/node/cliProcessMain.ts#L285

## DI コンテナ

DI コンテナの使われ方を追えば、アプリケーションの全体像が見える。
DI コンテナ自体を生成している === main 関数 なので。

DI コンテナの interface
- workspace://d75f7e938962/src/vs/platform/instantiation/common/instantiation.ts#L47-67


DI コンテナの実装
- workspace://d75f7e938962/src/vs/platform/instantiation/common/instantiationService.ts#L23-267

DI コンテナの生成
- workspace://d75f7e938962/src/vs/code/electron-browser/sharedProcess/sharedProcessMain.ts#L363
- workspace://d75f7e938962/src/vs/code/electron-main/main.ts#L218
- workspace://d75f7e938962/src/vs/code/node/cliProcessMain.ts#L223
- workspace://d75f7e938962/src/vs/editor/standalone/browser/standaloneServices.ts#L1005
- workspace://d75f7e938962/src/vs/server/node/remoteExtensionHostAgentCli.ts#L118
- workspace://d75f7e938962/src/vs/server/node/serverServices.ts#L172
- workspace://d75f7e938962/src/vs/workbench/api/common/extensionHostMain.ts#L60
- workspace://d75f7e938962/src/vs/workbench/browser/workbench.ts#L202


### createChild が面白い

workspace://d75f7e938962/src/vs/platform/instantiation/common/instantiationService.ts#L39
```ts
	createChild(services: ServiceCollection): IInstantiationService {
```

## Service

複数のコンポーネントから使われるようなメソッドが定義されたオブジェクト.
DI コンテナに保持されている.

各サービスの生成は InstantiationService が行う.

- workspace://332ed59f5262/src/vs/platform/instantiation/common/instantiationService.ts#L23-31
```ts
export class InstantiationService implements IInstantiationService {

	declare readonly _serviceBrand: undefined;

	private readonly _services: ServiceCollection;
	private readonly _strict: boolean;
	private readonly _parent?: InstantiationService;

	constructor(services: ServiceCollection = new ServiceCollection(), strict: boolean = false, parent?: InstantiationService) {
```

- workspace://332ed59f5262/src/vs/platform/instantiation/common/instantiationService.ts#L110
```ts
		return <T>new ctor(...[...args, ...serviceArgs]);
```

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
- workspace://f17b33faf21f/src/vs/base/parts/ipc/common/ipc.ts

IChannel, IServerChannel は ProxyChannel.fromService か Server.registerChannel 経由で使われる. target の id は文字列. 異なるプロセス間での
id の共有は、文字列の同一性により保証される. channelName と呼ばれている.

IMessagePassingProtocol は RPCProtocol 経由で使われる. getProxy が色んな所で呼ばれている.
- workspace://e8415cbb16ca/src/vs/workbench/services/extensions/common/rpcProtocol.ts

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

- workspace://f17b33faf21f/src/vs/base/parts/ipc/common/ipc.ts#L1059-1062
```ts
					const target = handler[event];
					if (typeof target === 'function') {
						return target.call(handler, arg);
					}
```


- workspace://f17b33faf21f/src/vs/base/parts/ipc/common/ipc.ts#L1126-1145
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
- workspace://dbbf24add846/src/vs/workbench/api/common/extHost.protocol.ts

electron-browser プロセスでは fork が返した port を使って extension host と通信する.  _createExtensionHostCustomers で各サービスに登録している
- workspace://0945ef6e358d/src/vs/workbench/services/extensions/common/extensionHostManager.ts#L261-327


### RPC のポートなどのセットアップ

ipc.mp の mp は MessagePort の略. MessagePort は今のところ sharedProcess との通信に使われる.

extension host に対する browser プロセス側のAPI は以下のディレクトリにあるファイルで定義されている
- workspace:///src/vs/workbench/api/browser/

ipcRenderer の説明
- https://www.electronjs.org/docs/latest/api/ipc-renderer
- https://www.electronjs.org/docs/latest/api/ipc-main

- https://developer.mozilla.org/en-US/docs/Web/API/MessageEvent
- https://developer.mozilla.org/en-US/docs/Web/API/MessagePort

#### プロセスの起動時

`global.vscodePorts` に fork が返した port が保存される.

- workspace://f9acb97f3c75/src/bootstrap-fork.js#L240-251
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

#### extension host 側のセットアップ

通信方法として ipc, socket, message port が選べる
- workspace://47652af0b6c5/src/vs/workbench/services/extensions/common/extensionHostEnv.ts#L14-55

workspace://f992a90e32ba/src/vs/platform/extensions/electron-main/extensionHostStarter.ts#L366-367
```ts
		this._process.postMessage('port', null, [port2]);
		responseWindow.webContents.postMessage(opts.responseChannel, opts.responseNonce, [port1]);
```

workspace://f9acb97f3c75/src/bootstrap-fork.js#L244-250
```js
	process.on('port', (e) => {
		if (global.vscodePortsCallback) {
			global.vscodePortsCallback(e.ports);
		} else {
			global.vscodePorts = e.ports;
		}
	});
```

↓ RPC 関連の extension host 側のセットアップ

socket を作成するか, global.vscodePorts を使うかして protocol を作成.
- workspace://fbb7f4188e35/src/vs/workbench/api/node/extensionHostProcess.ts#L113
```ts
function _createExtHostProtocol(): Promise<IMessagePassingProtocol> {
```
- workspace://fbb7f4188e35/src/vs/workbench/api/node/extensionHostProcess.ts#L135-141
```ts
			if ((<any>global).vscodePorts) {
				const ports = (<any>global).vscodePorts;
				delete (<any>global).vscodePorts;
				withPorts(ports);
			} else {
				(<any>global).vscodePortsCallback = withPorts;
			}
```
- workspace://fbb7f4188e35/src/vs/workbench/api/node/extensionHostProcess.ts#L216-223
```ts
		return new Promise<PersistentProtocol>((resolve, reject) => {

			const socket = net.createConnection(pipeName, () => {
				socket.removeListener('error', reject);
				const protocol = new PersistentProtocol(new NodeSocket(socket, 'extHost-renderer'));
				protocol.sendResume();
				resolve(protocol);
			});
```


protocol を ExtensionHostMain の constructor に渡す
- workspace://fbb7f4188e35/src/vs/workbench/api/node/extensionHostProcess.ts#L400-405

ExtensionHostMain の constructor で, RPC service に protocol を渡している.
- workspace://49394cc44d1d/src/vs/workbench/api/common/extensionHostMain.ts#L33-48

extension host 用の各種サービスを起動. 各サービスは vs/workbench/api/common/extHostXXX というファイル名で実装されている.
- workspace://dbbf24add846/src/vs/workbench/api/common/extHost.common.services.ts#L32-54
- workspace://0de44f978617/src/vs/workbench/api/node/extHost.node.services.ts#L32-42


#### browser 側のセットアップ

受け取ったメッセージを window にリレーしている
- workspace://4404dc63561a/src/vs/base/parts/sandbox/electron-browser/preload.js#L207-219
```js
					const responseListener = (/** @type {IpcRendererEvent} */ e, /** @type {string} */ responseNonce) => {
						// validate that the nonce from the response is the same
						// as when requested. and if so, use `postMessage` to
						// send the `MessagePort` safely over, even when context
						// isolation is enabled
						if (nonce === responseNonce) {
							ipcRenderer.off(responseChannel, responseListener);
							window.postMessage(nonce, '*', e.ports);
						}
					};

					// handle reply from main
					ipcRenderer.on(responseChannel, responseListener);
```

main との通信
- workspace://a567b593d526/src/vs/workbench/electron-sandbox/desktop.main.ts#L158-160
```ts
		// Main Process
		const mainProcessService = this._register(new ElectronIPCMainProcessService(this.configuration.windowId));
		serviceCollection.set(IMainProcessService, mainProcessService);
```


extension host との通信
- workspace://fbb7f4188e35/src/vs/workbench/services/extensions/electron-sandbox/localProcessExtensionHost.ts#L592-597
```ts
	establishProtocol(prepared: void, extensionHostProcess: ExtensionHostProcess, opts: IExtensionHostProcessOptions): Promise<IMessagePassingProtocol> {

		writeExtHostConnection(new MessagePortExtHostConnection(), opts.env);

		// Get ready to acquire the message port from the shared process worker
		const portPromise = acquirePort(undefined /* we trigger the request via service call! */, opts.responseChannel, opts.responseNonce);
```

acquirePort
- workspace://78d226268b0c/src/vs/base/parts/ipc/electron-sandbox/ipc.mp.ts#L28-32
```ts
	// Wait until the main side has returned the `MessagePort`
	// We need to filter by the `nonce` to ensure we listen
	// to the right response.
	const onMessageChannelResult = Event.fromDOMEventEmitter<IMessageChannelResult>(window, 'message', (e: MessageEvent) => ({ nonce: e.data, port: e.ports[0], source: e.source }));
	const { port } = await Event.toPromise(Event.once(Event.filter(onMessageChannelResult, e => e.nonce === nonce && e.source === window)));
```

#### shared process のセットアップ

main との通信
- workspace://77905c850e17/src/vs/base/parts/ipc/electron-browser/ipc.mp.ts#L41-45
```ts
			// Send one port back to the requestor
			// Note: we intentionally use `electron` APIs here because
			// transferables like the `MessagePort` cannot be transferred
			// over preload scripts when `contextIsolation: true`
			ipcRenderer.postMessage('vscode:createMessageChannelResult', nonce, [outgoingPort]);
```


#### main のセットアップ

browser との通信

- workspace://342394d1e7d4/src/vs/base/parts/ipc/electron-main/ipc.electron.ts#L45
```ts
			const onMessage = createScopedOnMessageEvent(id, 'vscode:message') as Event<VSBuffer>;
```

現行)

workspace://f4f1b04d872a/src/vs/workbench/services/extensions/electron-sandbox/nativeLocalProcessExtensionHost.ts#L92-93
```ts
				const nodeSocket = new NodeSocket(socket, 'renderer-exthost');
				const protocol = new PersistentProtocol(nodeSocket);
```

workspace://fbb7f4188e35/src/vs/workbench/services/extensions/electron-sandbox/localProcessExtensionHost.ts#L339-341
```ts
		// Initialize extension host process with hand shakes
		const protocol = await communication.establishProtocol(communicationPreparedData, this._extensionHostProcess, opts);
		await this._performHandshake(protocol);
```

↓ 新) 現在はまだ使われていない.

port の片方を extension host (_process) に渡し, もう片方を browser プロセスに渡している.

- workspace://f992a90e32ba/src/vs/platform/extensions/electron-main/extensionHostStarter.ts#L364-367
```ts
		const { port1, port2 } = new electron.MessageChannelMain();

		this._process.postMessage('port', null, [port2]);
		responseWindow.webContents.postMessage(opts.responseChannel, opts.responseNonce, [port1]);
```

shared process との通信

- workspace://be376cfef020/src/vs/base/parts/ipc/electron-main/ipc.mp.ts#L51-56
```ts
	// Wait until the window has returned the `MessagePort`
	// We need to filter by the `nonce` to ensure we listen
	// to the right response.
	const onMessageChannelResult = Event.fromNodeEventEmitter<{ nonce: string; port: MessagePortMain }>(validatedIpcMain, 'vscode:createMessageChannelResult', (e: IpcMainEvent, nonce: string) => ({ nonce, port: e.ports[0] }));
	const { port } = await Event.toPromise(Event.once(Event.filter(onMessageChannelResult, e => e.nonce === nonce)));

```

#### 具体例

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

## ファイル構成

browser (Electron の renderer プロセスと browser で実行される)
common (extension host と renderer 両方で実行される)
electron-sandbox (Electron の renderer プロセス)
electron-main (Electron の main プロセス)
node (extension host などで実行される)
worker (Web Worker として実行される)

```
src/vs/base/
src/vs/base/browser/
src/vs/base/browser/dompurify/
src/vs/base/browser/ui/
src/vs/base/browser/ui/actionbar/
src/vs/base/browser/ui/aria/
src/vs/base/browser/ui/breadcrumbs/
src/vs/base/browser/ui/button/
src/vs/base/browser/ui/centered/
src/vs/base/browser/ui/codicons/
src/vs/base/browser/ui/codicons/codicon/
src/vs/base/browser/ui/contextview/
src/vs/base/browser/ui/countBadge/
src/vs/base/browser/ui/dialog/
src/vs/base/browser/ui/dropdown/
src/vs/base/browser/ui/findinput/
src/vs/base/browser/ui/grid/
src/vs/base/browser/ui/highlightedlabel/
src/vs/base/browser/ui/hover/
src/vs/base/browser/ui/iconLabel/
src/vs/base/browser/ui/inputbox/
src/vs/base/browser/ui/keybindingLabel/
src/vs/base/browser/ui/list/
src/vs/base/browser/ui/menu/
src/vs/base/browser/ui/mouseCursor/
src/vs/base/browser/ui/progressbar/
src/vs/base/browser/ui/resizable/
src/vs/base/browser/ui/sash/
src/vs/base/browser/ui/scrollbar/
src/vs/base/browser/ui/scrollbar/media/
src/vs/base/browser/ui/selectBox/
src/vs/base/browser/ui/splitview/
src/vs/base/browser/ui/table/
src/vs/base/browser/ui/toggle/
src/vs/base/browser/ui/toolbar/
src/vs/base/browser/ui/tree/
src/vs/base/browser/ui/tree/media/
src/vs/base/common/
src/vs/base/common/diff/
src/vs/base/common/marked/
src/vs/base/common/observableImpl/
src/vs/base/common/semver/
src/vs/base/common/worker/
src/vs/base/node/
src/vs/base/parts/
src/vs/base/parts/contextmenu/
src/vs/base/parts/contextmenu/common/
src/vs/base/parts/contextmenu/electron-main/
src/vs/base/parts/contextmenu/electron-sandbox/
src/vs/base/parts/ipc/
src/vs/base/parts/ipc/browser/
src/vs/base/parts/ipc/common/
src/vs/base/parts/ipc/electron-browser/
src/vs/base/parts/ipc/electron-main/
src/vs/base/parts/ipc/electron-sandbox/
src/vs/base/parts/ipc/node/
src/vs/base/parts/quickinput/
src/vs/base/parts/quickinput/browser/
src/vs/base/parts/quickinput/browser/media/
src/vs/base/parts/quickinput/common/
src/vs/base/parts/request/
src/vs/base/parts/request/browser/
src/vs/base/parts/request/common/
src/vs/base/parts/sandbox/
src/vs/base/parts/sandbox/common/
src/vs/base/parts/sandbox/electron-browser/
src/vs/base/parts/sandbox/electron-sandbox/
src/vs/base/parts/storage/
src/vs/base/parts/storage/common/
src/vs/base/parts/storage/node/
src/vs/base/worker/
src/vs/code/
src/vs/code/browser/
src/vs/code/browser/workbench/
src/vs/code/electron-browser/
src/vs/code/electron-browser/sharedProcess/
src/vs/code/electron-browser/sharedProcess/contrib/
src/vs/code/electron-main/
src/vs/code/electron-sandbox/
src/vs/code/electron-sandbox/issue/
src/vs/code/electron-sandbox/issue/media/
src/vs/code/electron-sandbox/processExplorer/
src/vs/code/electron-sandbox/processExplorer/media/
src/vs/code/electron-sandbox/workbench/
src/vs/code/node/
src/vs/editor/
src/vs/editor/browser/
src/vs/editor/browser/config/
src/vs/editor/browser/controller/
src/vs/editor/browser/services/
src/vs/editor/browser/view/
src/vs/editor/browser/viewParts/
src/vs/editor/browser/viewParts/blockDecorations/
src/vs/editor/browser/viewParts/contentWidgets/
src/vs/editor/browser/viewParts/currentLineHighlight/
src/vs/editor/browser/viewParts/decorations/
src/vs/editor/browser/viewParts/editorScrollbar/
src/vs/editor/browser/viewParts/glyphMargin/
src/vs/editor/browser/viewParts/indentGuides/
src/vs/editor/browser/viewParts/lineNumbers/
src/vs/editor/browser/viewParts/lines/
src/vs/editor/browser/viewParts/linesDecorations/
src/vs/editor/browser/viewParts/margin/
src/vs/editor/browser/viewParts/marginDecorations/
src/vs/editor/browser/viewParts/minimap/
src/vs/editor/browser/viewParts/overlayWidgets/
src/vs/editor/browser/viewParts/overviewRuler/
src/vs/editor/browser/viewParts/rulers/
src/vs/editor/browser/viewParts/scrollDecoration/
src/vs/editor/browser/viewParts/selections/
src/vs/editor/browser/viewParts/viewCursors/
src/vs/editor/browser/viewParts/viewZones/
src/vs/editor/browser/widget/
src/vs/editor/browser/widget/media/
src/vs/editor/common/
src/vs/editor/common/commands/
src/vs/editor/common/config/
src/vs/editor/common/core/
src/vs/editor/common/cursor/
src/vs/editor/common/diff/
src/vs/editor/common/diff/algorithms/
src/vs/editor/common/languages/
src/vs/editor/common/languages/supports/
src/vs/editor/common/model/
src/vs/editor/common/model/bracketPairsTextModelPart/
src/vs/editor/common/model/bracketPairsTextModelPart/bracketPairsTree/
src/vs/editor/common/model/pieceTreeTextBuffer/
src/vs/editor/common/services/
src/vs/editor/common/standalone/
src/vs/editor/common/tokens/
src/vs/editor/common/viewLayout/
src/vs/editor/common/viewModel/
src/vs/editor/contrib/
src/vs/editor/contrib/anchorSelect/
src/vs/editor/contrib/anchorSelect/browser/
src/vs/editor/contrib/bracketMatching/
src/vs/editor/contrib/bracketMatching/browser/
src/vs/editor/contrib/caretOperations/
src/vs/editor/contrib/caretOperations/browser/
src/vs/editor/contrib/clipboard/
src/vs/editor/contrib/clipboard/browser/
src/vs/editor/contrib/codeAction/
src/vs/editor/contrib/codeAction/browser/
src/vs/editor/contrib/codeAction/browser/media/
src/vs/editor/contrib/codelens/
src/vs/editor/contrib/codelens/browser/
src/vs/editor/contrib/colorPicker/
src/vs/editor/contrib/colorPicker/browser/
src/vs/editor/contrib/colorPicker/browser/images/
src/vs/editor/contrib/comment/
src/vs/editor/contrib/comment/browser/
src/vs/editor/contrib/contextmenu/
src/vs/editor/contrib/contextmenu/browser/
src/vs/editor/contrib/copyPaste/
src/vs/editor/contrib/copyPaste/browser/
src/vs/editor/contrib/cursorUndo/
src/vs/editor/contrib/cursorUndo/browser/
src/vs/editor/contrib/dnd/
src/vs/editor/contrib/dnd/browser/
src/vs/editor/contrib/documentSymbols/
src/vs/editor/contrib/documentSymbols/browser/
src/vs/editor/contrib/dropIntoEditor/
src/vs/editor/contrib/dropIntoEditor/browser/
src/vs/editor/contrib/editorState/
src/vs/editor/contrib/editorState/browser/
src/vs/editor/contrib/find/
src/vs/editor/contrib/find/browser/
src/vs/editor/contrib/folding/
src/vs/editor/contrib/folding/browser/
src/vs/editor/contrib/fontZoom/
src/vs/editor/contrib/fontZoom/browser/
src/vs/editor/contrib/format/
src/vs/editor/contrib/format/browser/
src/vs/editor/contrib/gotoError/
src/vs/editor/contrib/gotoError/browser/
src/vs/editor/contrib/gotoError/browser/media/
src/vs/editor/contrib/gotoSymbol/
src/vs/editor/contrib/gotoSymbol/browser/
src/vs/editor/contrib/gotoSymbol/browser/link/
src/vs/editor/contrib/gotoSymbol/browser/peek/
src/vs/editor/contrib/hover/
src/vs/editor/contrib/hover/browser/
src/vs/editor/contrib/inPlaceReplace/
src/vs/editor/contrib/inPlaceReplace/browser/
src/vs/editor/contrib/indentation/
src/vs/editor/contrib/indentation/browser/
src/vs/editor/contrib/inlayHints/
src/vs/editor/contrib/inlayHints/browser/
src/vs/editor/contrib/inlineCompletions/
src/vs/editor/contrib/inlineCompletions/browser/
src/vs/editor/contrib/lineSelection/
src/vs/editor/contrib/lineSelection/browser/
src/vs/editor/contrib/linesOperations/
src/vs/editor/contrib/linesOperations/browser/
src/vs/editor/contrib/linkedEditing/
src/vs/editor/contrib/linkedEditing/browser/
src/vs/editor/contrib/links/
src/vs/editor/contrib/links/browser/
src/vs/editor/contrib/markdownRenderer/
src/vs/editor/contrib/markdownRenderer/browser/
src/vs/editor/contrib/message/
src/vs/editor/contrib/message/browser/
src/vs/editor/contrib/multicursor/
src/vs/editor/contrib/multicursor/browser/
src/vs/editor/contrib/parameterHints/
src/vs/editor/contrib/parameterHints/browser/
src/vs/editor/contrib/peekView/
src/vs/editor/contrib/peekView/browser/
src/vs/editor/contrib/peekView/browser/media/
src/vs/editor/contrib/quickAccess/
src/vs/editor/contrib/quickAccess/browser/
src/vs/editor/contrib/readOnlyMessage/
src/vs/editor/contrib/readOnlyMessage/browser/
src/vs/editor/contrib/rename/
src/vs/editor/contrib/rename/browser/
src/vs/editor/contrib/smartSelect/
src/vs/editor/contrib/smartSelect/browser/
src/vs/editor/contrib/snippet/
src/vs/editor/contrib/snippet/browser/
src/vs/editor/contrib/stickyScroll/
src/vs/editor/contrib/stickyScroll/browser/
src/vs/editor/contrib/suggest/
src/vs/editor/contrib/suggest/browser/
src/vs/editor/contrib/suggest/browser/media/
src/vs/editor/contrib/symbolIcons/
src/vs/editor/contrib/symbolIcons/browser/
src/vs/editor/contrib/toggleTabFocusMode/
src/vs/editor/contrib/toggleTabFocusMode/browser/
src/vs/editor/contrib/tokenization/
src/vs/editor/contrib/tokenization/browser/
src/vs/editor/contrib/unicodeHighlighter/
src/vs/editor/contrib/unicodeHighlighter/browser/
src/vs/editor/contrib/unusualLineTerminators/
src/vs/editor/contrib/unusualLineTerminators/browser/
src/vs/editor/contrib/viewportSemanticTokens/
src/vs/editor/contrib/viewportSemanticTokens/browser/
src/vs/editor/contrib/wordHighlighter/
src/vs/editor/contrib/wordHighlighter/browser/
src/vs/editor/contrib/wordOperations/
src/vs/editor/contrib/wordOperations/browser/
src/vs/editor/contrib/wordPartOperations/
src/vs/editor/contrib/wordPartOperations/browser/
src/vs/editor/contrib/zoneWidget/
src/vs/editor/contrib/zoneWidget/browser/
src/vs/editor/standalone/
src/vs/editor/standalone/browser/
src/vs/editor/standalone/browser/accessibilityHelp/
src/vs/editor/standalone/browser/iPadShowKeyboard/
src/vs/editor/standalone/browser/inspectTokens/
src/vs/editor/standalone/browser/quickAccess/
src/vs/editor/standalone/browser/quickInput/
src/vs/editor/standalone/browser/referenceSearch/
src/vs/editor/standalone/browser/toggleHighContrast/
src/vs/editor/standalone/common/
src/vs/editor/standalone/common/monarch/
src/vs/platform/
src/vs/platform/accessibility/
src/vs/platform/accessibility/browser/
src/vs/platform/accessibility/common/
src/vs/platform/action/
src/vs/platform/action/common/
src/vs/platform/actions/
src/vs/platform/actions/browser/
src/vs/platform/actions/common/
src/vs/platform/assignment/
src/vs/platform/assignment/common/
src/vs/platform/backup/
src/vs/platform/backup/common/
src/vs/platform/backup/electron-main/
src/vs/platform/backup/node/
src/vs/platform/checksum/
src/vs/platform/checksum/common/
src/vs/platform/checksum/node/
src/vs/platform/clipboard/
src/vs/platform/clipboard/browser/
src/vs/platform/clipboard/common/
src/vs/platform/commands/
src/vs/platform/commands/common/
src/vs/platform/configuration/
src/vs/platform/configuration/common/
src/vs/platform/contextkey/
src/vs/platform/contextkey/browser/
src/vs/platform/contextkey/common/
src/vs/platform/contextview/
src/vs/platform/contextview/browser/
src/vs/platform/credentials/
src/vs/platform/credentials/common/
src/vs/platform/credentials/electron-main/
src/vs/platform/credentials/node/
src/vs/platform/debug/
src/vs/platform/debug/common/
src/vs/platform/debug/electron-main/
src/vs/platform/diagnostics/
src/vs/platform/diagnostics/common/
src/vs/platform/diagnostics/electron-main/
src/vs/platform/diagnostics/electron-sandbox/
src/vs/platform/diagnostics/node/
src/vs/platform/dialogs/
src/vs/platform/dialogs/common/
src/vs/platform/dialogs/electron-main/
src/vs/platform/dnd/
src/vs/platform/dnd/browser/
src/vs/platform/download/
src/vs/platform/download/common/
src/vs/platform/driver/
src/vs/platform/driver/browser/
src/vs/platform/driver/common/
src/vs/platform/driver/electron-sandbox/
src/vs/platform/editor/
src/vs/platform/editor/common/
src/vs/platform/encryption/
src/vs/platform/encryption/common/
src/vs/platform/encryption/node/
src/vs/platform/environment/
src/vs/platform/environment/common/
src/vs/platform/environment/electron-main/
src/vs/platform/environment/node/
src/vs/platform/extensionManagement/
src/vs/platform/extensionManagement/common/
src/vs/platform/extensionManagement/electron-main/
src/vs/platform/extensionManagement/electron-sandbox/
src/vs/platform/extensionManagement/node/
src/vs/platform/extensionRecommendations/
src/vs/platform/extensionRecommendations/common/
src/vs/platform/extensionRecommendations/electron-sandbox/
src/vs/platform/extensions/
src/vs/platform/extensions/common/
src/vs/platform/extensions/electron-main/
src/vs/platform/externalServices/
src/vs/platform/externalServices/common/
src/vs/platform/externalTerminal/
src/vs/platform/externalTerminal/common/
src/vs/platform/externalTerminal/electron-main/
src/vs/platform/externalTerminal/electron-sandbox/
src/vs/platform/externalTerminal/node/
src/vs/platform/files/
src/vs/platform/files/browser/
src/vs/platform/files/common/
src/vs/platform/files/electron-main/
src/vs/platform/files/node/
src/vs/platform/files/node/watcher/
src/vs/platform/files/node/watcher/nodejs/
src/vs/platform/files/node/watcher/parcel/
src/vs/platform/history/
src/vs/platform/history/browser/
src/vs/platform/instantiation/
src/vs/platform/instantiation/common/
src/vs/platform/ipc/
src/vs/platform/ipc/electron-browser/
src/vs/platform/ipc/electron-sandbox/
src/vs/platform/issue/
src/vs/platform/issue/common/
src/vs/platform/issue/electron-main/
src/vs/platform/issue/electron-sandbox/
src/vs/platform/jsonschemas/
src/vs/platform/jsonschemas/common/
src/vs/platform/keybinding/
src/vs/platform/keybinding/common/
src/vs/platform/keyboardLayout/
src/vs/platform/keyboardLayout/common/
src/vs/platform/keyboardLayout/electron-main/
src/vs/platform/label/
src/vs/platform/label/common/
src/vs/platform/languagePacks/
src/vs/platform/languagePacks/browser/
src/vs/platform/languagePacks/common/
src/vs/platform/languagePacks/node/
src/vs/platform/launch/
src/vs/platform/launch/common/
src/vs/platform/launch/electron-main/
src/vs/platform/layout/
src/vs/platform/layout/browser/
src/vs/platform/lifecycle/
src/vs/platform/lifecycle/common/
src/vs/platform/lifecycle/electron-main/
src/vs/platform/list/
src/vs/platform/list/browser/
src/vs/platform/log/
src/vs/platform/log/browser/
src/vs/platform/log/common/
src/vs/platform/log/node/
src/vs/platform/markers/
src/vs/platform/markers/common/
src/vs/platform/menubar/
src/vs/platform/menubar/common/
src/vs/platform/menubar/electron-main/
src/vs/platform/menubar/electron-sandbox/
src/vs/platform/native/
src/vs/platform/native/common/
src/vs/platform/native/electron-main/
src/vs/platform/native/electron-sandbox/
src/vs/platform/notification/
src/vs/platform/notification/common/
src/vs/platform/opener/
src/vs/platform/opener/browser/
src/vs/platform/opener/common/
src/vs/platform/policy/
src/vs/platform/policy/common/
src/vs/platform/policy/node/
src/vs/platform/product/
src/vs/platform/product/common/
src/vs/platform/profiling/
src/vs/platform/profiling/common/
src/vs/platform/profiling/electron-sandbox/
src/vs/platform/profiling/node/
src/vs/platform/progress/
src/vs/platform/progress/common/
src/vs/platform/protocol/
src/vs/platform/protocol/electron-main/
src/vs/platform/quickinput/
src/vs/platform/quickinput/browser/
src/vs/platform/quickinput/common/
src/vs/platform/registry/
src/vs/platform/registry/common/
src/vs/platform/remote/
src/vs/platform/remote/browser/
src/vs/platform/remote/common/
src/vs/platform/remote/electron-sandbox/
src/vs/platform/remote/node/
src/vs/platform/request/
src/vs/platform/request/browser/
src/vs/platform/request/common/
src/vs/platform/request/electron-browser/
src/vs/platform/request/electron-main/
src/vs/platform/request/node/
src/vs/platform/severityIcon/
src/vs/platform/severityIcon/common/
src/vs/platform/sharedProcess/
src/vs/platform/sharedProcess/common/
src/vs/platform/sharedProcess/electron-browser/
src/vs/platform/sharedProcess/electron-main/
src/vs/platform/sharedProcess/node/
src/vs/platform/shell/
src/vs/platform/shell/node/
src/vs/platform/sign/
src/vs/platform/sign/browser/
src/vs/platform/sign/common/
src/vs/platform/sign/node/
src/vs/platform/state/
src/vs/platform/state/electron-main/
src/vs/platform/state/node/
src/vs/platform/storage/
src/vs/platform/storage/common/
src/vs/platform/storage/electron-main/
src/vs/platform/storage/electron-sandbox/
src/vs/platform/telemetry/
src/vs/platform/telemetry/browser/
src/vs/platform/telemetry/common/
src/vs/platform/telemetry/electron-sandbox/
src/vs/platform/telemetry/node/
src/vs/platform/terminal/
src/vs/platform/terminal/common/
src/vs/platform/terminal/common/capabilities/
src/vs/platform/terminal/common/xterm/
src/vs/platform/terminal/electron-sandbox/
src/vs/platform/terminal/node/
src/vs/platform/theme/
src/vs/platform/theme/browser/
src/vs/platform/theme/common/
src/vs/platform/theme/electron-main/
src/vs/platform/tunnel/
src/vs/platform/tunnel/common/
src/vs/platform/tunnel/node/
src/vs/platform/undoRedo/
src/vs/platform/undoRedo/common/
src/vs/platform/update/
src/vs/platform/update/common/
src/vs/platform/update/electron-main/
src/vs/platform/uriIdentity/
src/vs/platform/uriIdentity/common/
src/vs/platform/url/
src/vs/platform/url/common/
src/vs/platform/url/electron-main/
src/vs/platform/userData/
src/vs/platform/userData/common/
src/vs/platform/userDataProfile/
src/vs/platform/userDataProfile/browser/
src/vs/platform/userDataProfile/common/
src/vs/platform/userDataProfile/electron-main/
src/vs/platform/userDataProfile/electron-sandbox/
src/vs/platform/userDataProfile/node/
src/vs/platform/userDataSync/
src/vs/platform/userDataSync/common/
src/vs/platform/userDataSync/electron-sandbox/
src/vs/platform/webview/
src/vs/platform/webview/common/
src/vs/platform/webview/electron-main/
src/vs/platform/window/
src/vs/platform/window/common/
src/vs/platform/window/electron-main/
src/vs/platform/window/electron-sandbox/
src/vs/platform/windows/
src/vs/platform/windows/electron-main/
src/vs/platform/windows/node/
src/vs/platform/workspace/
src/vs/platform/workspace/common/
src/vs/platform/workspaces/
src/vs/platform/workspaces/common/
src/vs/platform/workspaces/electron-main/
src/vs/server/
src/vs/server/node/
src/vs/workbench/
src/vs/workbench/api/
src/vs/workbench/api/browser/
src/vs/workbench/api/common/
src/vs/workbench/api/common/shared/
src/vs/workbench/api/node/
src/vs/workbench/api/worker/
src/vs/workbench/browser/
src/vs/workbench/browser/actions/
src/vs/workbench/browser/actions/media/
src/vs/workbench/browser/media/
src/vs/workbench/browser/parts/
src/vs/workbench/browser/parts/activitybar/
src/vs/workbench/browser/parts/activitybar/media/
src/vs/workbench/browser/parts/auxiliarybar/
src/vs/workbench/browser/parts/auxiliarybar/media/
src/vs/workbench/browser/parts/banner/
src/vs/workbench/browser/parts/banner/media/
src/vs/workbench/browser/parts/dialogs/
src/vs/workbench/browser/parts/editor/
src/vs/workbench/browser/parts/editor/media/
src/vs/workbench/browser/parts/media/
src/vs/workbench/browser/parts/notifications/
src/vs/workbench/browser/parts/notifications/media/
src/vs/workbench/browser/parts/panel/
src/vs/workbench/browser/parts/panel/media/
src/vs/workbench/browser/parts/sidebar/
src/vs/workbench/browser/parts/sidebar/media/
src/vs/workbench/browser/parts/statusbar/
src/vs/workbench/browser/parts/statusbar/media/
src/vs/workbench/browser/parts/titlebar/
src/vs/workbench/browser/parts/titlebar/media/
src/vs/workbench/browser/parts/views/
src/vs/workbench/browser/parts/views/media/
src/vs/workbench/common/
src/vs/workbench/common/editor/
src/vs/workbench/contrib/
src/vs/workbench/contrib/audioCues/
src/vs/workbench/contrib/audioCues/browser/
src/vs/workbench/contrib/audioCues/browser/media/
src/vs/workbench/contrib/bracketPairColorizer2Telemetry/
src/vs/workbench/contrib/bracketPairColorizer2Telemetry/browser/
src/vs/workbench/contrib/bulkEdit/
src/vs/workbench/contrib/bulkEdit/browser/
src/vs/workbench/contrib/bulkEdit/browser/preview/
src/vs/workbench/contrib/callHierarchy/
src/vs/workbench/contrib/callHierarchy/browser/
src/vs/workbench/contrib/callHierarchy/browser/media/
src/vs/workbench/contrib/callHierarchy/common/
src/vs/workbench/contrib/codeActions/
src/vs/workbench/contrib/codeActions/browser/
src/vs/workbench/contrib/codeActions/common/
src/vs/workbench/contrib/codeEditor/
src/vs/workbench/contrib/codeEditor/browser/
src/vs/workbench/contrib/codeEditor/browser/accessibility/
src/vs/workbench/contrib/codeEditor/browser/find/
src/vs/workbench/contrib/codeEditor/browser/inspectEditorTokens/
src/vs/workbench/contrib/codeEditor/browser/outline/
src/vs/workbench/contrib/codeEditor/browser/quickaccess/
src/vs/workbench/contrib/codeEditor/browser/suggestEnabledInput/
src/vs/workbench/contrib/codeEditor/electron-sandbox/
src/vs/workbench/contrib/comments/
src/vs/workbench/contrib/comments/browser/
src/vs/workbench/contrib/comments/browser/media/
src/vs/workbench/contrib/comments/common/
src/vs/workbench/contrib/configExporter/
src/vs/workbench/contrib/configExporter/electron-sandbox/
src/vs/workbench/contrib/contextmenu/
src/vs/workbench/contrib/contextmenu/browser/
src/vs/workbench/contrib/customEditor/
src/vs/workbench/contrib/customEditor/browser/
src/vs/workbench/contrib/customEditor/common/
src/vs/workbench/contrib/debug/
src/vs/workbench/contrib/debug/browser/
src/vs/workbench/contrib/debug/browser/media/
src/vs/workbench/contrib/debug/common/
src/vs/workbench/contrib/debug/electron-sandbox/
src/vs/workbench/contrib/debug/node/
src/vs/workbench/contrib/deprecatedExtensionMigrator/
src/vs/workbench/contrib/deprecatedExtensionMigrator/browser/
src/vs/workbench/contrib/editSessions/
src/vs/workbench/contrib/editSessions/browser/
src/vs/workbench/contrib/editSessions/common/
src/vs/workbench/contrib/emmet/
src/vs/workbench/contrib/emmet/browser/
src/vs/workbench/contrib/emmet/browser/actions/
src/vs/workbench/contrib/experiments/
src/vs/workbench/contrib/experiments/browser/
src/vs/workbench/contrib/experiments/common/
src/vs/workbench/contrib/extensions/
src/vs/workbench/contrib/extensions/browser/
src/vs/workbench/contrib/extensions/browser/media/
src/vs/workbench/contrib/extensions/common/
src/vs/workbench/contrib/extensions/electron-sandbox/
src/vs/workbench/contrib/externalTerminal/
src/vs/workbench/contrib/externalTerminal/browser/
src/vs/workbench/contrib/externalTerminal/electron-sandbox/
src/vs/workbench/contrib/externalTerminal/node/
src/vs/workbench/contrib/externalUriOpener/
src/vs/workbench/contrib/externalUriOpener/common/
src/vs/workbench/contrib/feedback/
src/vs/workbench/contrib/feedback/browser/
src/vs/workbench/contrib/feedback/browser/media/
src/vs/workbench/contrib/files/
src/vs/workbench/contrib/files/browser/
src/vs/workbench/contrib/files/browser/editors/
src/vs/workbench/contrib/files/browser/media/
src/vs/workbench/contrib/files/browser/views/
src/vs/workbench/contrib/files/browser/views/media/
src/vs/workbench/contrib/files/common/
src/vs/workbench/contrib/files/electron-sandbox/
src/vs/workbench/contrib/format/
src/vs/workbench/contrib/format/browser/
src/vs/workbench/contrib/inlayHints/
src/vs/workbench/contrib/inlayHints/browser/
src/vs/workbench/contrib/interactive/
src/vs/workbench/contrib/interactive/browser/
src/vs/workbench/contrib/interactive/browser/docs/
src/vs/workbench/contrib/interactive/browser/media/
src/vs/workbench/contrib/issue/
src/vs/workbench/contrib/issue/browser/
src/vs/workbench/contrib/issue/common/
src/vs/workbench/contrib/issue/electron-sandbox/
src/vs/workbench/contrib/keybindings/
src/vs/workbench/contrib/keybindings/browser/
src/vs/workbench/contrib/languageDetection/
src/vs/workbench/contrib/languageDetection/browser/
src/vs/workbench/contrib/languageStatus/
src/vs/workbench/contrib/languageStatus/browser/
src/vs/workbench/contrib/languageStatus/browser/media/
src/vs/workbench/contrib/list/
src/vs/workbench/contrib/list/browser/
src/vs/workbench/contrib/localHistory/
src/vs/workbench/contrib/localHistory/browser/
src/vs/workbench/contrib/localHistory/electron-sandbox/
src/vs/workbench/contrib/localization/
src/vs/workbench/contrib/localization/browser/
src/vs/workbench/contrib/localization/common/
src/vs/workbench/contrib/localization/electron-sandbox/
src/vs/workbench/contrib/logs/
src/vs/workbench/contrib/logs/browser/
src/vs/workbench/contrib/logs/common/
src/vs/workbench/contrib/logs/electron-sandbox/
src/vs/workbench/contrib/markdown/
src/vs/workbench/contrib/markdown/browser/
src/vs/workbench/contrib/markers/
src/vs/workbench/contrib/markers/browser/
src/vs/workbench/contrib/markers/browser/media/
src/vs/workbench/contrib/markers/common/
src/vs/workbench/contrib/mergeEditor/
src/vs/workbench/contrib/mergeEditor/browser/
src/vs/workbench/contrib/mergeEditor/browser/commands/
src/vs/workbench/contrib/mergeEditor/browser/model/
src/vs/workbench/contrib/mergeEditor/browser/view/
src/vs/workbench/contrib/mergeEditor/browser/view/editors/
src/vs/workbench/contrib/mergeEditor/browser/view/media/
src/vs/workbench/contrib/mergeEditor/common/
src/vs/workbench/contrib/mergeEditor/electron-sandbox/
src/vs/workbench/contrib/notebook/
src/vs/workbench/contrib/notebook/browser/
src/vs/workbench/contrib/notebook/browser/contrib/
src/vs/workbench/contrib/notebook/browser/contrib/breakpoints/
src/vs/workbench/contrib/notebook/browser/contrib/cellCommands/
src/vs/workbench/contrib/notebook/browser/contrib/cellStatusBar/
src/vs/workbench/contrib/notebook/browser/contrib/clipboard/
src/vs/workbench/contrib/notebook/browser/contrib/editorStatusBar/
src/vs/workbench/contrib/notebook/browser/contrib/execute/
src/vs/workbench/contrib/notebook/browser/contrib/find/
src/vs/workbench/contrib/notebook/browser/contrib/find/media/
src/vs/workbench/contrib/notebook/browser/contrib/format/
src/vs/workbench/contrib/notebook/browser/contrib/gettingStarted/
src/vs/workbench/contrib/notebook/browser/contrib/layout/
src/vs/workbench/contrib/notebook/browser/contrib/marker/
src/vs/workbench/contrib/notebook/browser/contrib/navigation/
src/vs/workbench/contrib/notebook/browser/contrib/outline/
src/vs/workbench/contrib/notebook/browser/contrib/profile/
src/vs/workbench/contrib/notebook/browser/contrib/troubleshoot/
src/vs/workbench/contrib/notebook/browser/contrib/undoRedo/
src/vs/workbench/contrib/notebook/browser/contrib/viewportCustomMarkdown/
src/vs/workbench/contrib/notebook/browser/controller/
src/vs/workbench/contrib/notebook/browser/diff/
src/vs/workbench/contrib/notebook/browser/docs/
src/vs/workbench/contrib/notebook/browser/media/
src/vs/workbench/contrib/notebook/browser/services/
src/vs/workbench/contrib/notebook/browser/view/
src/vs/workbench/contrib/notebook/browser/view/cellParts/
src/vs/workbench/contrib/notebook/browser/view/renderers/
src/vs/workbench/contrib/notebook/browser/viewModel/
src/vs/workbench/contrib/notebook/browser/viewParts/
src/vs/workbench/contrib/notebook/common/
src/vs/workbench/contrib/notebook/common/model/
src/vs/workbench/contrib/notebook/common/services/
src/vs/workbench/contrib/offline/
src/vs/workbench/contrib/offline/browser/
src/vs/workbench/contrib/outline/
src/vs/workbench/contrib/outline/browser/
src/vs/workbench/contrib/output/
src/vs/workbench/contrib/output/browser/
src/vs/workbench/contrib/output/browser/media/
src/vs/workbench/contrib/output/common/
src/vs/workbench/contrib/output/electron-sandbox/
src/vs/workbench/contrib/performance/
src/vs/workbench/contrib/performance/browser/
src/vs/workbench/contrib/performance/electron-sandbox/
src/vs/workbench/contrib/preferences/
src/vs/workbench/contrib/preferences/browser/
src/vs/workbench/contrib/preferences/browser/media/
src/vs/workbench/contrib/preferences/common/
src/vs/workbench/contrib/quickaccess/
src/vs/workbench/contrib/quickaccess/browser/
src/vs/workbench/contrib/relauncher/
src/vs/workbench/contrib/relauncher/browser/
src/vs/workbench/contrib/remote/
src/vs/workbench/contrib/remote/browser/
src/vs/workbench/contrib/remote/browser/media/
src/vs/workbench/contrib/remote/common/
src/vs/workbench/contrib/remote/electron-sandbox/
src/vs/workbench/contrib/sash/
src/vs/workbench/contrib/sash/browser/
src/vs/workbench/contrib/scm/
src/vs/workbench/contrib/scm/browser/
src/vs/workbench/contrib/scm/browser/media/
src/vs/workbench/contrib/scm/common/
src/vs/workbench/contrib/search/
src/vs/workbench/contrib/search/browser/
src/vs/workbench/contrib/search/browser/media/
src/vs/workbench/contrib/search/common/
src/vs/workbench/contrib/searchEditor/
src/vs/workbench/contrib/searchEditor/browser/
src/vs/workbench/contrib/searchEditor/browser/media/
src/vs/workbench/contrib/snippets/
src/vs/workbench/contrib/snippets/browser/
src/vs/workbench/contrib/snippets/browser/commands/
src/vs/workbench/contrib/splash/
src/vs/workbench/contrib/splash/browser/
src/vs/workbench/contrib/splash/electron-sandbox/
src/vs/workbench/contrib/surveys/
src/vs/workbench/contrib/surveys/browser/
src/vs/workbench/contrib/tags/
src/vs/workbench/contrib/tags/browser/
src/vs/workbench/contrib/tags/common/
src/vs/workbench/contrib/tags/electron-sandbox/
src/vs/workbench/contrib/tasks/
src/vs/workbench/contrib/tasks/browser/
src/vs/workbench/contrib/tasks/common/
src/vs/workbench/contrib/tasks/electron-sandbox/
src/vs/workbench/contrib/telemetry/
src/vs/workbench/contrib/telemetry/browser/
src/vs/workbench/contrib/terminal/
src/vs/workbench/contrib/terminal/browser/
src/vs/workbench/contrib/terminal/browser/links/
src/vs/workbench/contrib/terminal/browser/media/
src/vs/workbench/contrib/terminal/browser/widgets/
src/vs/workbench/contrib/terminal/browser/xterm/
src/vs/workbench/contrib/terminal/common/
src/vs/workbench/contrib/terminal/electron-sandbox/
src/vs/workbench/contrib/themes/
src/vs/workbench/contrib/themes/browser/
src/vs/workbench/contrib/timeline/
src/vs/workbench/contrib/timeline/browser/
src/vs/workbench/contrib/timeline/browser/media/
src/vs/workbench/contrib/timeline/common/
src/vs/workbench/contrib/typeHierarchy/
src/vs/workbench/contrib/typeHierarchy/browser/
src/vs/workbench/contrib/typeHierarchy/browser/media/
src/vs/workbench/contrib/typeHierarchy/common/
src/vs/workbench/contrib/update/
src/vs/workbench/contrib/update/browser/
src/vs/workbench/contrib/update/browser/media/
src/vs/workbench/contrib/update/common/
src/vs/workbench/contrib/url/
src/vs/workbench/contrib/url/browser/
src/vs/workbench/contrib/url/common/
src/vs/workbench/contrib/userDataProfile/
src/vs/workbench/contrib/userDataProfile/browser/
src/vs/workbench/contrib/userDataSync/
src/vs/workbench/contrib/userDataSync/browser/
src/vs/workbench/contrib/userDataSync/browser/media/
src/vs/workbench/contrib/userDataSync/electron-sandbox/
src/vs/workbench/contrib/watermark/
src/vs/workbench/contrib/watermark/browser/
src/vs/workbench/contrib/watermark/browser/media/
src/vs/workbench/contrib/webview/
src/vs/workbench/contrib/webview/browser/
src/vs/workbench/contrib/webview/browser/pre/
src/vs/workbench/contrib/webview/electron-sandbox/
src/vs/workbench/contrib/webviewPanel/
src/vs/workbench/contrib/webviewPanel/browser/
src/vs/workbench/contrib/webviewView/
src/vs/workbench/contrib/webviewView/browser/
src/vs/workbench/contrib/welcomeBanner/
src/vs/workbench/contrib/welcomeBanner/browser/
src/vs/workbench/contrib/welcomeGettingStarted/
src/vs/workbench/contrib/welcomeGettingStarted/browser/
src/vs/workbench/contrib/welcomeGettingStarted/browser/media/
src/vs/workbench/contrib/welcomeGettingStarted/common/
src/vs/workbench/contrib/welcomeGettingStarted/common/media/
src/vs/workbench/contrib/welcomeGettingStarted/common/media/notebookThemes/
src/vs/workbench/contrib/welcomeOverlay/
src/vs/workbench/contrib/welcomeOverlay/browser/
src/vs/workbench/contrib/welcomeOverlay/browser/media/
src/vs/workbench/contrib/welcomeViews/
src/vs/workbench/contrib/welcomeViews/common/
src/vs/workbench/contrib/welcomeWalkthrough/
src/vs/workbench/contrib/welcomeWalkthrough/browser/
src/vs/workbench/contrib/welcomeWalkthrough/browser/editor/
src/vs/workbench/contrib/welcomeWalkthrough/browser/media/
src/vs/workbench/contrib/welcomeWalkthrough/common/
src/vs/workbench/contrib/workspace/
src/vs/workbench/contrib/workspace/browser/
src/vs/workbench/contrib/workspace/browser/media/
src/vs/workbench/contrib/workspace/common/
src/vs/workbench/contrib/workspaces/
src/vs/workbench/contrib/workspaces/browser/
src/vs/workbench/electron-sandbox/
src/vs/workbench/electron-sandbox/actions/
src/vs/workbench/electron-sandbox/actions/media/
src/vs/workbench/electron-sandbox/parts/
src/vs/workbench/electron-sandbox/parts/dialogs/
src/vs/workbench/electron-sandbox/parts/titlebar/
src/vs/workbench/services/
src/vs/workbench/services/accessibility/
src/vs/workbench/services/accessibility/electron-sandbox/
src/vs/workbench/services/actions/
src/vs/workbench/services/actions/common/
src/vs/workbench/services/activity/
src/vs/workbench/services/activity/browser/
src/vs/workbench/services/activity/common/
src/vs/workbench/services/assignment/
src/vs/workbench/services/assignment/common/
src/vs/workbench/services/authentication/
src/vs/workbench/services/authentication/browser/
src/vs/workbench/services/authentication/common/
src/vs/workbench/services/banner/
src/vs/workbench/services/banner/browser/
src/vs/workbench/services/checksum/
src/vs/workbench/services/checksum/electron-sandbox/
src/vs/workbench/services/clipboard/
src/vs/workbench/services/clipboard/browser/
src/vs/workbench/services/clipboard/electron-sandbox/
src/vs/workbench/services/commands/
src/vs/workbench/services/commands/common/
src/vs/workbench/services/configuration/
src/vs/workbench/services/configuration/browser/
src/vs/workbench/services/configuration/common/
src/vs/workbench/services/configurationResolver/
src/vs/workbench/services/configurationResolver/browser/
src/vs/workbench/services/configurationResolver/common/
src/vs/workbench/services/configurationResolver/electron-sandbox/
src/vs/workbench/services/contextmenu/
src/vs/workbench/services/contextmenu/electron-sandbox/
src/vs/workbench/services/credentials/
src/vs/workbench/services/credentials/browser/
src/vs/workbench/services/credentials/electron-sandbox/
src/vs/workbench/services/decorations/
src/vs/workbench/services/decorations/browser/
src/vs/workbench/services/decorations/common/
src/vs/workbench/services/dialogs/
src/vs/workbench/services/dialogs/browser/
src/vs/workbench/services/dialogs/common/
src/vs/workbench/services/dialogs/electron-sandbox/
src/vs/workbench/services/editor/
src/vs/workbench/services/editor/browser/
src/vs/workbench/services/editor/common/
src/vs/workbench/services/encryption/
src/vs/workbench/services/encryption/browser/
src/vs/workbench/services/encryption/common/
src/vs/workbench/services/encryption/electron-sandbox/
src/vs/workbench/services/environment/
src/vs/workbench/services/environment/browser/
src/vs/workbench/services/environment/common/
src/vs/workbench/services/environment/electron-sandbox/
src/vs/workbench/services/extensionManagement/
src/vs/workbench/services/extensionManagement/browser/
src/vs/workbench/services/extensionManagement/common/
src/vs/workbench/services/extensionManagement/common/media/
src/vs/workbench/services/extensionManagement/electron-sandbox/
src/vs/workbench/services/extensionRecommendations/
src/vs/workbench/services/extensionRecommendations/common/
src/vs/workbench/services/extensionResourceLoader/
src/vs/workbench/services/extensionResourceLoader/browser/
src/vs/workbench/services/extensionResourceLoader/common/
src/vs/workbench/services/extensionResourceLoader/electron-sandbox/
src/vs/workbench/services/extensions/
src/vs/workbench/services/extensions/browser/
src/vs/workbench/services/extensions/common/
src/vs/workbench/services/extensions/electron-sandbox/
src/vs/workbench/services/extensions/worker/
src/vs/workbench/services/files/
src/vs/workbench/services/files/browser/
src/vs/workbench/services/files/common/
src/vs/workbench/services/files/electron-sandbox/
src/vs/workbench/services/filesConfiguration/
src/vs/workbench/services/filesConfiguration/common/
src/vs/workbench/services/history/
src/vs/workbench/services/history/browser/
src/vs/workbench/services/history/common/
src/vs/workbench/services/host/
src/vs/workbench/services/host/browser/
src/vs/workbench/services/host/electron-sandbox/
src/vs/workbench/services/hover/
src/vs/workbench/services/hover/browser/
src/vs/workbench/services/hover/browser/media/
src/vs/workbench/services/integrity/
src/vs/workbench/services/integrity/browser/
src/vs/workbench/services/integrity/common/
src/vs/workbench/services/integrity/electron-sandbox/
src/vs/workbench/services/issue/
src/vs/workbench/services/issue/common/
src/vs/workbench/services/issue/electron-sandbox/
src/vs/workbench/services/keybinding/
src/vs/workbench/services/keybinding/browser/
src/vs/workbench/services/keybinding/browser/keyboardLayouts/
src/vs/workbench/services/keybinding/common/
src/vs/workbench/services/keybinding/electron-sandbox/
src/vs/workbench/services/label/
src/vs/workbench/services/label/common/
src/vs/workbench/services/language/
src/vs/workbench/services/language/common/
src/vs/workbench/services/languageDetection/
src/vs/workbench/services/languageDetection/browser/
src/vs/workbench/services/languageDetection/common/
src/vs/workbench/services/languageStatus/
src/vs/workbench/services/languageStatus/common/
src/vs/workbench/services/layout/
src/vs/workbench/services/layout/browser/
src/vs/workbench/services/lifecycle/
src/vs/workbench/services/lifecycle/browser/
src/vs/workbench/services/lifecycle/common/
src/vs/workbench/services/lifecycle/electron-sandbox/
src/vs/workbench/services/localization/
src/vs/workbench/services/localization/electron-sandbox/
src/vs/workbench/services/log/
src/vs/workbench/services/log/electron-sandbox/
src/vs/workbench/services/menubar/
src/vs/workbench/services/menubar/electron-sandbox/
src/vs/workbench/services/model/
src/vs/workbench/services/model/common/
src/vs/workbench/services/notification/
src/vs/workbench/services/notification/common/
src/vs/workbench/services/outline/
src/vs/workbench/services/outline/browser/
src/vs/workbench/services/output/
src/vs/workbench/services/output/common/
src/vs/workbench/services/panecomposite/
src/vs/workbench/services/panecomposite/browser/
src/vs/workbench/services/path/
src/vs/workbench/services/path/browser/
src/vs/workbench/services/path/common/
src/vs/workbench/services/path/electron-sandbox/
src/vs/workbench/services/preferences/
src/vs/workbench/services/preferences/browser/
src/vs/workbench/services/preferences/common/
src/vs/workbench/services/progress/
src/vs/workbench/services/progress/browser/
src/vs/workbench/services/progress/browser/media/
src/vs/workbench/services/quickinput/
src/vs/workbench/services/quickinput/browser/
src/vs/workbench/services/remote/
src/vs/workbench/services/remote/browser/
src/vs/workbench/services/remote/common/
src/vs/workbench/services/remote/electron-sandbox/
src/vs/workbench/services/request/
src/vs/workbench/services/request/browser/
src/vs/workbench/services/request/electron-sandbox/
src/vs/workbench/services/search/
src/vs/workbench/services/search/browser/
src/vs/workbench/services/search/common/
src/vs/workbench/services/search/electron-sandbox/
src/vs/workbench/services/search/node/
src/vs/workbench/services/search/worker/
src/vs/workbench/services/sharedProcess/
src/vs/workbench/services/sharedProcess/electron-sandbox/
src/vs/workbench/services/statusbar/
src/vs/workbench/services/statusbar/browser/
src/vs/workbench/services/storage/
src/vs/workbench/services/storage/browser/
src/vs/workbench/services/storage/electron-sandbox/
src/vs/workbench/services/telemetry/
src/vs/workbench/services/telemetry/browser/
src/vs/workbench/services/telemetry/electron-sandbox/
src/vs/workbench/services/textMate/
src/vs/workbench/services/textMate/browser/
src/vs/workbench/services/textMate/common/
src/vs/workbench/services/textfile/
src/vs/workbench/services/textfile/browser/
src/vs/workbench/services/textfile/common/
src/vs/workbench/services/textfile/electron-sandbox/
src/vs/workbench/services/textmodelResolver/
src/vs/workbench/services/textmodelResolver/common/
src/vs/workbench/services/textresourceProperties/
src/vs/workbench/services/textresourceProperties/common/
src/vs/workbench/services/themes/
src/vs/workbench/services/themes/browser/
src/vs/workbench/services/themes/common/
src/vs/workbench/services/themes/electron-sandbox/
src/vs/workbench/services/timer/
src/vs/workbench/services/timer/browser/
src/vs/workbench/services/timer/electron-sandbox/
src/vs/workbench/services/title/
src/vs/workbench/services/title/common/
src/vs/workbench/services/title/electron-sandbox/
src/vs/workbench/services/tunnel/
src/vs/workbench/services/tunnel/browser/
src/vs/workbench/services/tunnel/electron-sandbox/
src/vs/workbench/services/untitled/
src/vs/workbench/services/untitled/common/
src/vs/workbench/services/update/
src/vs/workbench/services/update/browser/
src/vs/workbench/services/update/electron-sandbox/
src/vs/workbench/services/url/
src/vs/workbench/services/url/browser/
src/vs/workbench/services/url/electron-sandbox/
src/vs/workbench/services/userData/
src/vs/workbench/services/userData/browser/
src/vs/workbench/services/userDataProfile/
src/vs/workbench/services/userDataProfile/browser/
src/vs/workbench/services/userDataProfile/common/
src/vs/workbench/services/userDataSync/
src/vs/workbench/services/userDataSync/browser/
src/vs/workbench/services/userDataSync/common/
src/vs/workbench/services/userDataSync/electron-sandbox/
src/vs/workbench/services/views/
src/vs/workbench/services/views/browser/
src/vs/workbench/services/views/common/
src/vs/workbench/services/workingCopy/
src/vs/workbench/services/workingCopy/browser/
src/vs/workbench/services/workingCopy/common/
src/vs/workbench/services/workingCopy/electron-sandbox/
src/vs/workbench/services/workspaces/
src/vs/workbench/services/workspaces/browser/
src/vs/workbench/services/workspaces/common/
src/vs/workbench/services/workspaces/electron-sandbox/
```

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

## print デバッグ

```diff
+++ b/scripts/code.sh
@@ -41,6 +41,7 @@ function code() {
        export VSCODE_CLI=1
        export ELECTRON_ENABLE_STACK_DUMPING=1
        export ELECTRON_ENABLE_LOGGING=1
+       export VSCODE_BUILD_BUILTIN_EXTENSIONS_SILENCE_PLEASE=1

        # Launch Code
        exec "$CODE" . "$@"
diff --git a/src/vs/workbench/services/output/common/output.ts b/src/vs/workbench/services/output/common/output.ts
index 1d96dcd198a..fe1cc99a9e7 100644
--- a/src/vs/workbench/services/output/common/output.ts
+++ b/src/vs/workbench/services/output/common/output.ts
@@ -11,7 +11,7 @@ import { createDecorator } from 'vs/platform/instantiation/common/instantiation'
 import { IFileService, whenProviderRegistered } from 'vs/platform/files/common/files';
 import { ILogService } from 'vs/platform/log/common/log';
 import { CancellationToken } from 'vs/base/common/cancellation';
-import { CancellationError, getErrorMessage, isCancellationError } from 'vs/base/common/errors';
+import { CancellationError, isCancellationError } from 'vs/base/common/errors';
 import { CancelablePromise, createCancelablePromise, timeout } from 'vs/base/common/async';

 /**
@@ -235,7 +235,7 @@ export function registerLogChannel(id: string, label: string, file: URI, fileSer
                        outputChannelRegistry.registerChannel({ id, label, file, log: true });
                } catch (error) {
                        if (!isCancellationError(error)) {
-                               logService.error('Error while registering log channel', file.toString(), getErrorMessage(error));
+                               //                              logService.error('Error while registering log channel', file.toString(), getErrorMessage(error));
                        }
                }
        });
```

