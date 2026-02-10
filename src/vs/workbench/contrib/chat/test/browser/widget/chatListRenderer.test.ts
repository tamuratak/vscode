/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { ITreeNode } from '../../../../../../base/browser/ui/tree/tree.js';
import { Event } from '../../../../../../base/common/event.js';
import { toDisposable } from '../../../../../../base/common/lifecycle.js';
import { FuzzyScore } from '../../../../../../base/common/filters.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { observableValue } from '../../../../../../base/common/observable.js';
import { URI } from '../../../../../../base/common/uri.js';
import { assertSnapshot } from '../../../../../../base/test/common/snapshot.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { IUserInteractionService, MockUserInteractionService } from '../../../../../../platform/userInteraction/browser/userInteractionService.js';
import { IChatTipService } from '../../../browser/chatTipService.js';
import { ChatEditorOptions } from '../../../browser/widget/chatOptions.js';
import { ChatListItemRenderer, IChatRendererDelegate } from '../../../browser/widget/chatListRenderer.js';
import { CodeBlockModelCollection } from '../../../common/widget/codeBlockModelCollection.js';
import { ChatTreeItem, IChatListItemRendererOptions } from '../../../browser/chat.js';
import { IChatRequestVariableEntry } from '../../../common/attachments/chatVariableEntries.js';
import { IChatPendingDividerViewModel, IChatRequestViewModel, IChatResponseViewModel, IChatViewModel } from '../../../common/model/chatViewModel.js';
import { ChatModeKind, CollapsedToolsDisplayMode, ThinkingDisplayMode } from '../../../common/constants.js';
import { ChatRequestQueueKind, IChatMarkdownContent, IChatService, IChatThinkingPart } from '../../../common/chatService/chatService.js';
import { IResponse } from '../../../common/model/chatModel.js';
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
	let configurationService: TestConfigurationService;

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

	function createParsedRequest(text: string = 'Hello'): IParsedChatRequest {
		return {
			text,
			parts: []
		};
	}

	function createFileVariable(name: string): IChatRequestVariableEntry {
		return {
			kind: 'file',
			id: `file-${name}`,
			name,
			fullName: `/test/${name}`,
			value: URI.file(`/test/${name}`)
		};
	}

	function createRequest(options: Partial<IChatRequestViewModel> = {}): IChatRequestViewModel {
		const id = options.id ?? 'request-1';
		return {
			id,
			sessionResource: URI.parse('test://session'),
			dataId: `${id}-data`,
			username: 'User',
			message: createParsedRequest(),
			messageText: 'unused',
			attempt: 0,
			confirmation: undefined,
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
			...options,
		};
	}

	function createConfirmationRequest(id: string, confirmation: string): IChatRequestViewModel {
		return createRequest({ id, confirmation });
	}

	function createViewModel(): IChatViewModel {
		return {
			model: {
				checkpoint: undefined,
				getPendingRequests: () => []
			} as unknown as IChatViewModel['model'],
			sessionResource: URI.parse('test://session'),
			onDidDisposeModel: Event.None,
			onDidChange: Event.None,
			getItems: () => [],
			setInputPlaceholder: () => { },
			resetInputPlaceholder: () => { },
			editing: undefined,
			setEditing: () => { }
		};
	}

	function createResponse(options: Partial<IChatResponseViewModel> = {}): IChatResponseViewModel {
		const id = options.id ?? 'response-1';
		const response: IResponse = {
			value: [],
			getMarkdown: () => '',
			toString: () => ''
		};

		return {
			model: {
				response,
				entireResponse: response
			} as IChatResponseViewModel['model'],
			id,
			session: createViewModel(),
			sessionResource: URI.parse('test://session'),
			dataId: `${id}-data`,
			requestId: options.requestId ?? 'request-1',
			username: 'Copilot',
			agent: undefined,
			slashCommand: undefined,
			agentOrSlashCommandDetected: false,
			response,
			usedContext: undefined,
			contentReferences: [],
			codeCitations: [],
			progressMessages: [],
			isComplete: true,
			isCanceled: false,
			isStale: false,
			vote: undefined,
			voteDownReason: undefined,
			replyFollowups: undefined,
			errorDetails: undefined,
			result: undefined,
			contentUpdateTimings: undefined,
			shouldBeRemovedOnSend: undefined,
			isCompleteAddedRequest: false,
			renderData: undefined,
			currentRenderedHeight: undefined,
			setVote: () => { },
			setVoteDownReason: () => { },
			usedReferencesExpanded: undefined,
			vulnerabilitiesListExpanded: false,
			setEditApplied: () => { },
			shouldBeBlocked: observableValue('shouldBeBlocked', false),
			...options,
		};
	}

	function createResponseWithParts(parts: ReadonlyArray<IChatMarkdownContent | IChatThinkingPart>): IChatResponseViewModel {
		const response: IResponse = {
			value: parts,
			getMarkdown: () => '',
			toString: () => ''
		};

		return createResponse({
			response,
			model: {
				response,
				entireResponse: response
			} as IChatResponseViewModel['model'],
			isComplete: true
		});
	}

	setup(() => {
		instantiationService = store.add(workbenchInstantiationService(undefined, store));
		configurationService = new TestConfigurationService({
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
		});
		instantiationService.stub(IConfigurationService, configurationService);
		viewDescriptorService = new TestViewDescriptorService() as IViewDescriptorService;
		instantiationService.stub(IViewDescriptorService, viewDescriptorService);
		instantiationService.stub(IChatService, new MockChatService());
		instantiationService.stub(IChatTipService, { _serviceBrand: undefined, getNextTip: () => undefined });
		instantiationService.stub(IUserInteractionService, new MockUserInteractionService());
		container = mainWindow.document.createElement('div');
		renderer = createRenderer();
	});

	test('pending divider queued', async () => {
		const template = renderer.renderTemplate(container);
		store.add(template.templateDisposables);
		store.add(toDisposable(() => renderer.disposeTemplate(template)));

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

	test('pending divider hides header elements and toolbars', () => {
		const template = renderer.renderTemplate(container);
		store.add(template.templateDisposables);
		store.add(toDisposable(() => renderer.disposeTemplate(template)));

		const element: IChatPendingDividerViewModel = {
			kind: 'pendingDivider',
			id: 'pending-divider-queued-hidden',
			sessionResource: URI.parse('test://session'),
			isComplete: true,
			dividerKind: ChatRequestQueueKind.Queued,
			currentRenderedHeight: undefined,
		};

		renderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		assert.ok(template.avatarContainer.classList.contains('hidden'));
		assert.ok(template.username.classList.contains('hidden'));
		assert.ok(template.requestHover.classList.contains('hidden'));
		assert.ok(template.checkpointContainer.classList.contains('hidden'));
		assert.ok(template.checkpointRestoreContainer.classList.contains('hidden'));
		assert.ok(template.footerToolbar.getElement().classList.contains('hidden'));
		if (template.titleToolbar) {
			assert.ok(template.titleToolbar.getElement().classList.contains('hidden'));
		}
	});

	test('pending divider steering', async () => {
		const template = renderer.renderTemplate(container);
		store.add(template.templateDisposables);
		store.add(toDisposable(() => renderer.disposeTemplate(template)));

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
		store.add(toDisposable(() => renderer.disposeTemplate(template)));

		const element = createConfirmationRequest('request-confirmation', 'Keep');

		renderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		await assertSnapshot(template.rowContainer.outerHTML);
	});

	test('confirmation request toggles header state', () => {
		const template = renderer.renderTemplate(container);
		store.add(template.templateDisposables);
		store.add(toDisposable(() => renderer.disposeTemplate(template)));

		const element = createConfirmationRequest('request-confirmation-toggle', 'Keep');

		renderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		assert.ok(template.rowContainer.classList.contains('confirmation-message'));
		assert.ok(template.header?.classList.contains('partially-disabled'));
		assert.ok(!template.header?.classList.contains('header-disabled'));
		assert.ok(template.detail.textContent?.includes('Selected "Keep"'));
	});

	test('copilot username hides avatar and name', () => {
		const template = renderer.renderTemplate(container);
		store.add(template.templateDisposables);
		store.add(toDisposable(() => renderer.disposeTemplate(template)));

		const element = createRequest({ id: 'request-copilot', username: 'GitHub Copilot' });

		renderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		assert.ok(template.username.classList.contains('hidden'));
		assert.ok(template.avatarContainer.classList.contains('hidden'));
	});

	test('minimal request renders inline progress when incomplete', () => {
		const minimalRenderer = createRenderer({ renderStyle: 'minimal' });
		const template = minimalRenderer.renderTemplate(container);
		store.add(template.templateDisposables);
		store.add(toDisposable(() => minimalRenderer.disposeTemplate(template)));

		const element = createRequest({ id: 'request-incomplete', isComplete: false });

		minimalRenderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		assert.ok(template.value.classList.contains('inline-progress'));
	});

	test('minimal request clears inline progress when complete', () => {
		const minimalRenderer = createRenderer({ renderStyle: 'minimal' });
		const template = minimalRenderer.renderTemplate(container);
		store.add(template.templateDisposables);
		store.add(toDisposable(() => minimalRenderer.disposeTemplate(template)));

		const element = createRequest({ id: 'request-complete', isComplete: true });

		minimalRenderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		assert.ok(!template.value.classList.contains('inline-progress'));
	});

	test('request renders attachments when variables exist', () => {
		const template = renderer.renderTemplate(container);
		store.add(template.templateDisposables);
		store.add(toDisposable(() => renderer.disposeTemplate(template)));

		const element = createRequest({
			id: 'request-attachments',
			variables: [createFileVariable('file.ts')]
		});

		renderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		assert.ok(!!template.value.querySelector('.chat-attached-context'));
	});

	test('request keydown fires onDidClickRequest when editable', async () => {
		await configurationService.setUserConfiguration('chat.editRequests', 'input');
		const editableRenderer = createRenderer({ editable: true });
		const template = editableRenderer.renderTemplate(container);
		store.add(template.templateDisposables);
		store.add(toDisposable(() => editableRenderer.disposeTemplate(template)));

		const element = createRequest({ id: 'request-keydown' });
		let fired = false;
		store.add(editableRenderer.onDidClickRequest(() => {
			fired = true;
		}));

		editableRenderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		const event = new mainWindow.KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
		Object.defineProperty(event, 'keyCode', { get: () => 13 });
		Object.defineProperty(event, 'which', { get: () => 13 });
		template.rowContainer.dispatchEvent(event);

		assert.ok(fired);
	});

	test('response detail rerun link fires event', () => {
		const template = renderer.renderTemplate(container);
		store.add(template.templateDisposables);
		store.add(toDisposable(() => renderer.disposeTemplate(template)));

		const element = createResponse({
			id: 'response-rerun',
			requestId: 'request-rerun',
			agentOrSlashCommandDetected: true,
			isComplete: false,
		});
		let firedRequestId: string | undefined;
		store.add(renderer.onDidClickRerunWithAgentOrCommandDetection(e => {
			firedRequestId = e.requestId;
		}));

		renderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		const link = template.detail.querySelector('a') as HTMLAnchorElement | null;
		assert.ok(link);
		link.dispatchEvent(new mainWindow.MouseEvent('click', { bubbles: true }));

		assert.strictEqual(firedRequestId, 'request-rerun');
	});

	test('footer details are shown when result details exist', () => {
		const template = renderer.renderTemplate(container);
		store.add(template.templateDisposables);
		store.add(toDisposable(() => renderer.disposeTemplate(template)));

		const element = createResponse({
			id: 'response-details',
			result: { details: 'Processed 3 files' } as IChatResponseViewModel['result']
		});

		renderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		assert.ok(!template.footerDetailsContainer.classList.contains('hidden'));
		assert.strictEqual(template.footerDetailsContainer.textContent, 'Processed 3 files');
	});

	test('final markdown renders outside thinking', async () => {
		await configurationService.setUserConfiguration('chat.agent.thinking.collapsedTools', CollapsedToolsDisplayMode.Always);
		await configurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.CollapsedPreview);

		const template = renderer.renderTemplate(container);
		store.add(template.templateDisposables);
		store.add(toDisposable(() => renderer.disposeTemplate(template)));

		const thinking: IChatThinkingPart = { kind: 'thinking', value: 'Thinking...' };
		const finalMarkdown: IChatMarkdownContent = { kind: 'markdownContent', content: new MarkdownString('Final answer.') };
		const element = createResponseWithParts([thinking, finalMarkdown]);

		renderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		const thinkingBox = template.value.querySelector('.chat-thinking-box');
		assert.ok(thinkingBox);

		const markdownParts = Array.from(template.value.querySelectorAll('.chat-markdown-part'));
		assert.strictEqual(markdownParts.length, 1);
		assert.strictEqual(markdownParts[0]?.closest('.chat-thinking-box'), null);
	});

	test('final markdown renders outside thinking with codeblock uri', async () => {
		await configurationService.setUserConfiguration('chat.agent.thinking.collapsedTools', CollapsedToolsDisplayMode.Always);
		await configurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.CollapsedPreview);

		const template = renderer.renderTemplate(container);
		store.add(template.templateDisposables);
		store.add(toDisposable(() => renderer.disposeTemplate(template)));

		const thinking: IChatThinkingPart = { kind: 'thinking', value: 'Thinking...' };
		const finalMarkdown: IChatMarkdownContent = {
			kind: 'markdownContent',
			content: new MarkdownString('```ts\n<vscode_codeblock_uri>file:///a/b.ts</vscode_codeblock_uri>\n```')
		};
		const element = createResponseWithParts([thinking, finalMarkdown]);

		renderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		const thinkingBox = template.value.querySelector('.chat-thinking-box');
		assert.ok(thinkingBox);

		const markdownParts = Array.from(template.value.querySelectorAll('.chat-markdown-part'));
		assert.strictEqual(markdownParts.length, 1);
		assert.strictEqual(markdownParts[0]?.closest('.chat-thinking-box'), null);
	});

	test('pinned markdown stays in thinking while final markdown is outside', async () => {
		await configurationService.setUserConfiguration('chat.agent.thinking.collapsedTools', CollapsedToolsDisplayMode.Always);
		await configurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.CollapsedPreview);

		const template = renderer.renderTemplate(container);
		store.add(template.templateDisposables);
		store.add(toDisposable(() => renderer.disposeTemplate(template)));

		const thinking: IChatThinkingPart = { kind: 'thinking', value: 'Thinking...' };
		const pinnedMarkdown: IChatMarkdownContent = {
			kind: 'markdownContent',
			content: new MarkdownString('```ts\n<vscode_codeblock_uri>file:///a/edit.ts</vscode_codeblock_uri>\n```')
		};
		const finalMarkdown: IChatMarkdownContent = { kind: 'markdownContent', content: new MarkdownString('Final answer.') };
		const element = createResponseWithParts([thinking, pinnedMarkdown, finalMarkdown]);

		renderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		const thinkingBox = template.value.querySelector('.chat-thinking-box');
		assert.ok(thinkingBox);

		const markdownParts = Array.from(template.value.querySelectorAll('.chat-markdown-part'));
		const outsideThinking = markdownParts.filter(part => !part.closest('.chat-thinking-box'));
		assert.strictEqual(outsideThinking.length, 1);
	});

	test('final markdown renders outside thinking in collapsed mode', async () => {
		await configurationService.setUserConfiguration('chat.agent.thinking.collapsedTools', CollapsedToolsDisplayMode.Always);
		await configurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.Collapsed);

		const template = renderer.renderTemplate(container);
		store.add(template.templateDisposables);
		store.add(toDisposable(() => renderer.disposeTemplate(template)));

		const thinking: IChatThinkingPart = { kind: 'thinking', value: 'Thinking...' };
		const finalMarkdown: IChatMarkdownContent = { kind: 'markdownContent', content: new MarkdownString('Final answer.') };
		const element = createResponseWithParts([thinking, finalMarkdown]);

		renderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		const thinkingBox = template.value.querySelector('.chat-thinking-box');
		assert.ok(thinkingBox);

		const markdownParts = Array.from(template.value.querySelectorAll('.chat-markdown-part'));
		assert.strictEqual(markdownParts.length, 1);
		assert.strictEqual(markdownParts[0]?.closest('.chat-thinking-box'), null);
	});

	test('final markdown renders outside thinking with multiple thinking parts', async () => {
		await configurationService.setUserConfiguration('chat.agent.thinking.collapsedTools', CollapsedToolsDisplayMode.Always);
		await configurationService.setUserConfiguration('chat.agent.thinkingStyle', ThinkingDisplayMode.FixedScrolling);

		const template = renderer.renderTemplate(container);
		store.add(template.templateDisposables);
		store.add(toDisposable(() => renderer.disposeTemplate(template)));

		const thinkingOne: IChatThinkingPart = { kind: 'thinking', value: 'Thinking 1...' };
		const thinkingTwo: IChatThinkingPart = { kind: 'thinking', value: 'Thinking 2...' };
		const finalMarkdown: IChatMarkdownContent = { kind: 'markdownContent', content: new MarkdownString('Final answer.') };
		const element = createResponseWithParts([thinkingOne, thinkingTwo, finalMarkdown]);

		renderer.renderElement({ element } as ITreeNode<ChatTreeItem, FuzzyScore>, 0, template);

		const thinkingBox = template.value.querySelector('.chat-thinking-box');
		assert.ok(thinkingBox);

		const markdownParts = Array.from(template.value.querySelectorAll('.chat-markdown-part'));
		assert.strictEqual(markdownParts.length, 1);
		assert.strictEqual(markdownParts[0]?.closest('.chat-thinking-box'), null);
	});
});
