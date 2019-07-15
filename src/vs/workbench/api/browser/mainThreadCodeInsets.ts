/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UriComponents, URI } from 'vs/base/common/uri';
import * as modes from 'vs/editor/common/modes';
import { MainContext, MainThreadEditorInsetsShape, IExtHostContext, ExtHostEditorInsetsShape, ExtHostContext } from 'vs/workbench/api/common/extHost.protocol';
import { extHostNamedCustomer } from '../common/extHostCustomers';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { IWebviewService, Webview } from 'vs/workbench/contrib/webview/common/webview';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IActiveCodeEditor, IViewZone } from 'vs/editor/browser/editorBrowser';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';

// todo@joh move these things back into something like contrib/insets
class EditorWebviewZone implements IViewZone {

	readonly domNode: HTMLElement;
	readonly afterLineNumber: number;
	readonly afterColumn: number;
	readonly heightInLines: number;
	webview: Webview | undefined;

	private _id: number;
	// suppressMouseDown?: boolean | undefined;
	// heightInPx?: number | undefined;
	// minWidthInPx?: number | undefined;
	// marginDomNode?: HTMLElement | null | undefined;
	// onDomNodeTop?: ((top: number) => void) | undefined;
	// onComputedHeight?: ((height: number) => void) | undefined;

	constructor(
		readonly editor: IActiveCodeEditor,
		readonly line: number,
		readonly height: number,
	) {
		this.domNode = document.createElement('div');
		this.domNode.style.zIndex = '10'; // without this, the webview is not interactive
		this.afterLineNumber = line;
		this.afterColumn = 1;
		this.heightInLines = height;

		editor.changeViewZones(accessor => this._id = accessor.addZone(this));
	}

	dispose(): void {
		this.editor.changeViewZones(accessor => accessor.removeZone(this._id));
	}
}

@extHostNamedCustomer(MainContext.MainThreadEditorInsets)
export class MainThreadEditorInsets implements MainThreadEditorInsetsShape {

	private readonly _proxy: ExtHostEditorInsetsShape;
	private readonly _disposables = new DisposableStore();
	private readonly _insets = new Map<number, { inset: EditorWebviewZone, disposableStore: DisposableStore }>();

	constructor(
		context: IExtHostContext,
		@ICodeEditorService private readonly _editorService: ICodeEditorService,
		@IWebviewService private readonly _webviewService: IWebviewService,
	) {
		this._proxy = context.getProxy(ExtHostContext.ExtHostEditorInsets);
	}

	dispose(): void {
		this._disposables.dispose();
	}

	async $createEditorInset(handle: number, id: string, uri: UriComponents, line: number, height: number, options: modes.IWebviewOptions, extensionId: ExtensionIdentifier, extensionLocation: UriComponents): Promise<void> {

		let editor: IActiveCodeEditor | undefined;
		id = id.substr(0, id.indexOf(',')); //todo@joh HACK

		for (const candidate of this._editorService.listCodeEditors()) {
			if (candidate.getId() === id && candidate.hasModel() && candidate.getModel()!.uri.toString() === URI.revive(uri).toString()) {
				editor = candidate;
				break;
			}
		}

		if (!editor) {
			setTimeout(() => this._proxy.$onDidDispose(handle));
			return;
		}

		const disposables = new DisposableStore();
		const webviewZone = new EditorWebviewZone(editor, line, height);

		const remove = () => {
			disposables.dispose();
			this._proxy.$onDidDispose(handle);
			this._insets.delete(handle);
		};

		disposables.add(editor.onDidChangeModel(remove));
		disposables.add(editor.onDidDispose(remove));
		disposables.add(webviewZone);

		this._insets.set(handle, { inset: webviewZone, disposableStore: disposables });
	}

	$disposeEditorInset(handle: number): void {
		const inset = this.getInset(handle);
		this._insets.delete(handle);
		inset.dispose();

	}

	async $createWebView(handle: number, options: modes.IWebviewOptions, extensionId: ExtensionIdentifier, extensionLocation: UriComponents): Promise<boolean> {
		const inset = this.getInset(handle);
		if (inset.webview) {
			return false;
		}

		const webview = this._webviewService.createWebview('' + handle, {
			enableFindWidget: false,
			allowSvgs: false,
			extension: { id: extensionId, location: URI.revive(extensionLocation) }
		}, {
				allowScripts: options.enableScripts,
				localResourceRoots: options.localResourceRoots ? options.localResourceRoots.map(uri => URI.revive(uri)) : undefined
			});

		webview.mountTo(inset.domNode);
		console.log('mounted!!\n\n');
		const disposables = this.getDisposable(handle);
		disposables.add(webview);
		disposables.add(webview.onMessage(msg => this._proxy.$onDidReceiveMessage(handle, msg)));
		return true;
	}

	$disposeWebview(handle: number): void {
		const inset = this.getInset(handle);
		if (inset.webview) {
			inset.webview.dispose();
			inset.webview = undefined;
		}
	}

	$setHtml(handle: number, value: string): void {
		const inset = this.getInset(handle);
		if (inset.webview) {
			inset.webview.html = value;
		}
	}

	$setOptions(handle: number, options: modes.IWebviewOptions): void {
		const inset = this.getInset(handle);
		if (inset.webview) {
			inset.webview.options = options;
		}
	}

	async $postMessage(handle: number, value: any): Promise<boolean> {
		const inset = this.getInset(handle);
		if (inset.webview) {
			inset.webview.sendMessage(value);
			return true;
		}
		return false;
	}

	private getInset(handle: number): EditorWebviewZone {
		const insetObj = this._insets.get(handle);
		if (!insetObj) {
			throw new Error('Unknown inset');
		}
		return insetObj.inset;
	}

	private getDisposable(handle: number) {
		const insetObj = this._insets.get(handle);
		if (!insetObj) {
			throw new Error('Unknown inset');
		}
		return insetObj.disposableStore;
	}
}
