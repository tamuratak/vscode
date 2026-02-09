/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../../../base/browser/window.js';
import { FuzzyScore } from '../../../../../../base/common/filters.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ITreeNode } from '../../../../../../base/browser/ui/tree/tree.js';
import { assertSnapshot } from '../../../../../../base/test/common/snapshot.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IChatTipService } from '../../../browser/chatTipService.js';
import { ChatEditorOptions } from '../../../browser/widget/chatOptions.js';
import { ChatListItemRenderer, IChatRendererDelegate } from '../../../browser/widget/chatListRenderer.js';
import { CodeBlockModelCollection } from '../../../common/widget/codeBlockModelCollection.js';
import { ChatTreeItem, IChatListItemRendererOptions } from '../../../browser/chat.js';
import { IChatPendingDividerViewModel } from '../../../common/model/chatViewModel.js';
import { ChatModeKind } from '../../../common/constants.js';
import { ChatRequestQueueKind, IChatService } from '../../../common/chatService/chatService.js';
import { MockChatService } from '../../common/chatService/mockChatService.js';
import { ITestInstantiationService, workbenchInstantiationService } from '../../../../../test/browser/workbenchTestServices.js';

suite('ChatListItemRenderer', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let instantiationService: ITestInstantiationService;
	let renderer: ChatListItemRenderer;
	let container: HTMLElement;

	function createRenderer(options: IChatListItemRendererOptions = {}): ChatListItemRenderer {
		const editorOptions = store.add(instantiationService.createInstance(
			ChatEditorOptions,
			undefined,
			'foreground',
			'chat.requestEditor.background',
			'chat.responseEditor.background'
		));

		const delegate: IChatRendererDelegate = {
			container,
			getListLength: () => 1,
			currentChatMode: () => ChatModeKind.Ask,
		};

		const codeBlockModelCollection = store.add(instantiationService.createInstance(CodeBlockModelCollection, 'test'));

		return store.add(instantiationService.createInstance(
			ChatListItemRenderer,
			editorOptions,
			options,
			delegate,
			codeBlockModelCollection,
			undefined,
			undefined
		));
	}

	setup(() => {
		instantiationService = store.add(workbenchInstantiationService(undefined, store));
		instantiationService.stub(IChatService, new MockChatService());
		instantiationService.stub(IChatTipService, { _serviceBrand: undefined, getNextTip: () => undefined });
		container = mainWindow.document.createElement('div');
		renderer = createRenderer();
	});

	test('pending divider queued', async () => {
		const template = renderer.renderTemplate(container);
		store.add(template.templateDisposables);

		const element: IChatPendingDividerViewModel = {
			kind: 'pendingDivider',
			id: 'pending-divider-queued',
			sessionResource: URI.parse('test://session'),
			isComplete: true,
			dividerKind: ChatRequestQueueKind.Queued,
			currentRenderedHeight: undefined,
		};

		renderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		await assertSnapshot(template.rowContainer.outerHTML);
	});

	test('pending divider steering', async () => {
		const template = renderer.renderTemplate(container);
		store.add(template.templateDisposables);

		const element: IChatPendingDividerViewModel = {
			kind: 'pendingDivider',
			id: 'pending-divider-steering',
			sessionResource: URI.parse('test://session'),
			isComplete: true,
			dividerKind: ChatRequestQueueKind.Steering,
			currentRenderedHeight: undefined,
		};

		renderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		await assertSnapshot(template.rowContainer.outerHTML);
	});
});
