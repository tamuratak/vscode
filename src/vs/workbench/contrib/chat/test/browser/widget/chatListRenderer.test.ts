/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../../../base/browser/window.js';
import { ITreeNode } from '../../../../../../base/browser/ui/tree/tree.js';
import { Event } from '../../../../../../base/common/event.js';
import { FuzzyScore } from '../../../../../../base/common/filters.js';
import { observableValue } from '../../../../../../base/common/observable.js';
import { URI } from '../../../../../../base/common/uri.js';
import { assertSnapshot } from '../../../../../../base/test/common/snapshot.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IChatTipService } from '../../../browser/chatTipService.js';
import { ChatEditorOptions } from '../../../browser/widget/chatOptions.js';
import { ChatListItemRenderer, IChatRendererDelegate } from '../../../browser/widget/chatListRenderer.js';
import { CodeBlockModelCollection } from '../../../common/widget/codeBlockModelCollection.js';
import { ChatTreeItem, IChatListItemRendererOptions } from '../../../browser/chat.js';
import { IChatPendingDividerViewModel, IChatRequestViewModel } from '../../../common/model/chatViewModel.js';
import { ChatModeKind } from '../../../common/constants.js';
import { ChatRequestQueueKind, IChatService } from '../../../common/chatService/chatService.js';
import { IParsedChatRequest } from '../../../common/requestParser/chatParserTypes.js';
import { MockChatService } from '../../common/chatService/mockChatService.js';
import { IViewDescriptorService } from '../../../../../common/views.js';
import { ITestInstantiationService, workbenchInstantiationService } from '../../../../../test/browser/workbenchTestServices.js';

suite('ChatListItemRenderer', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	let instantiationService: ITestInstantiationService;
	let renderer: ChatListItemRenderer;
	let container: HTMLElement;
	let viewDescriptorService: IViewDescriptorService;

	class TestViewDescriptorService implements Partial<IViewDescriptorService> {
		onDidChangeLocation = Event.None;
	}

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

	function createConfirmationRequest(id: string, confirmation: string): IChatRequestViewModel {
		return {
			id,
			sessionResource: URI.parse('test://session'),
			dataId: `${id}-data`,
			username: 'User',
			message: {} as IParsedChatRequest,
			messageText: 'unused',
			attempt: 0,
			confirmation,
			pendingKind: undefined,
			timestamp: 0,
			isComplete: true,
			isCompleteAddedRequest: false,
			shouldBeBlocked: observableValue('shouldBeBlocked', false),
			variables: [],
			contentReferences: [],
			agentOrSlashCommandDetected: false,
			slashCommand: undefined,
			shouldBeRemovedOnSend: undefined,
			currentRenderedHeight: undefined,
			modelId: undefined,
		};
	}

	setup(() => {
		instantiationService = store.add(workbenchInstantiationService(undefined, store));
		instantiationService.stub(IConfigurationService, new TestConfigurationService({
			editor: {
				fontFamily: 'monospace',
				fontWeight: 'normal',
				wordWrap: 'on',
				accessibilitySupport: 'auto',
				fontLigatures: false,
				bracketPairColorization: {
					enabled: false,
					independentColorPoolPerBracketType: false,
				}
			},
			chat: {
				editor: {
					fontSize: 14,
					fontFamily: 'default',
					fontWeight: 'normal',
					wordWrap: 'on',
				}
			},
			files: {
				participants: {
					timeout: 60000
				}
			}
		}));
		viewDescriptorService = new TestViewDescriptorService() as IViewDescriptorService;
		instantiationService.stub(IViewDescriptorService, viewDescriptorService);
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

	test('confirmation request detail', async () => {
		const template = renderer.renderTemplate(container);
		store.add(template.templateDisposables);

		const element = createConfirmationRequest('request-confirmation', 'Keep');

		renderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		await assertSnapshot(template.rowContainer.outerHTML);
	});
});
