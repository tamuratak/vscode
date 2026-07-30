/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import * as dom from '../../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../../base/browser/window.js';
import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { DisposableStore, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { observableValue } from '../../../../../../base/common/observable.js';
import { OffsetRange } from '../../../../../../editor/common/core/ranges/offsetRange.js';
import { Range } from '../../../../../../editor/common/core/range.js';
import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { workbenchInstantiationService } from '../../../../../test/browser/workbenchTestServices.js';
import { buildPlanReviewProgressContent, ChatListItemRenderer, endsWithSubagentContent, getWorkingProgressRelevantParts, IChatListItemTemplate, isWaitingForMcpServers, reconcileChatItemHeight, renderChatRequestTimestamp, renderChatResponseDetails, shouldCreateGroupedThinkingPart, shouldHideChatUserIdentity, shouldPinToolInvocationToThinking, shouldRenderInitialProgressiveContentImmediately, shouldScheduleInitialHeightChange, shouldShowFileChangesSummaryForSettings, shouldShowPillsSummaryForSettings, shouldStartNewCollapsedThinkingGroup } from '../../../browser/widget/chatListRenderer.js';
import { codeblockHasClosingBackticks } from '../../../browser/widget/chatContentParts/chatMarkdownContentPart.js';
import { ChatWorkingProgressContentPart } from '../../../browser/widget/chatContentParts/chatProgressContentPart.js';
import { hasCodeblockUriTag } from '../../../common/widget/annotations.js';
import { isChatTurnStatusPillsEnabled } from '../../../browser/widget/chatTurnPills.js';
import { IChatMcpServersStartingSlow, IChatService, IChatToolInvocation, IChatToolInvocationSerialized, ToolConfirmKind } from '../../../common/chatService/chatService.js';
import { formatChatRequestTimestamp, formatChatResponseDetails, formatElapsedTime } from '../../../common/chatProgressFormatting.js';
import { ChatAgentLocation, ChatConfiguration, ChatModeKind, CollapsedToolsDisplayMode, ThinkingDisplayMode } from '../../../common/constants.js';
import { ChatModel } from '../../../common/model/chatModel.js';
import { ChatViewModel, IChatRendererContent, IChatResponseViewModel, isResponseVM } from '../../../common/model/chatViewModel.js';
import { ChatToolInvocation } from '../../../common/model/chatProgressTypes/chatToolInvocation.js';
import { ChatAgentService, IChatAgentService } from '../../../common/participants/chatAgents.js';
import { ChatRequestTextPart } from '../../../common/requestParser/chatParserTypes.js';
import { ToolDataSource } from '../../../common/tools/languageModelToolsService.js';
import { ChatEditorOptions } from '../../../browser/widget/chatOptions.js';
import { MockChatService } from '../../common/chatService/mockChatService.js';

suite('ChatListRenderer', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	suite('shouldScheduleInitialHeightChange', () => {
		test('only schedules first measurement updates when needed to avoid clipping', () => {
			assert.deepStrictEqual([
				shouldScheduleInitialHeightChange(120, undefined),
				shouldScheduleInitialHeightChange(120, 120),
				shouldScheduleInitialHeightChange(120, 120.1),
				shouldScheduleInitialHeightChange(121, 120),
				shouldScheduleInitialHeightChange(121, 120.1),
			], [
				true,
				false,
				false,
				true,
				true,
			]);
		});
	});

	suite('reconcileChatItemHeight', () => {
		// Helper: run a sequence of measurements through the reconciler, threading
		// `currentRenderedHeight` the way `fireItemHeightChange` does, and capture the
		// notification kind + the stored height after each step. `initialStored` is the
		// element's `currentRenderedHeight` before the first step (undefined = never measured).
		const run = (steps: readonly { measured: number; isBeingRendered: boolean }[], allocatedHeight: number | undefined, initialStored: number | undefined) => {
			let stored: number | undefined = initialStored;
			return steps.map(({ measured, isBeingRendered }) => {
				const update = reconcileChatItemHeight(measured, stored, isBeingRendered, allocatedHeight);
				stored = update.nextRenderedHeight;
				return { kind: update.kind, height: update.height, stored };
			});
		};

		// Regression test for https://github.com/microsoft/vscode/issues/326952.
		// A row grows during streaming and is measured synchronously while it is being rendered
		// (notification suppressed). The stored height must NOT advance, and a deferred re-measure
		// must be requested, so a follow-up measurement of the grown height actually reaches the
		// tree instead of being deduped away (which would strand the content until a window resize).
		test('does not strand a grown height first seen while the row is being rendered', () => {
			assert.deepStrictEqual(
				run([
					{ measured: 900, isBeingRendered: true },   // grew mid-render -> suppressed, defer
					{ measured: 900, isBeingRendered: false },  // deferred re-measure delivers the height
				], /*allocatedHeight*/ 500, /*initialStored*/ 500),
				[
					{ kind: 'deferReMeasure', height: 900, stored: 500 },
					{ kind: 'fire', height: 900, stored: 900 },
				],
			);
		});

		test('notifies the tree on async growth and ignores an unchanged measurement', () => {
			assert.deepStrictEqual(
				run([
					{ measured: 700, isBeingRendered: false },  // async growth -> notify
					{ measured: 700, isBeingRendered: false },  // unchanged -> no-op
				], /*allocatedHeight*/ 500, /*initialStored*/ 500),
				[
					{ kind: 'fire', height: 700, stored: 700 },
					{ kind: 'none', height: 700, stored: 700 },
				],
			);
		});

		test('first measurement (no stored height) only schedules an update when content would clip', () => {
			assert.deepStrictEqual([
				// Initial measurement that fits within the allocated height -> no notification.
				run([{ measured: 500, isBeingRendered: false }], /*allocatedHeight*/ 500, /*initialStored*/ undefined),
				// Initial measurement larger than the allocation -> schedule an initial update.
				run([{ measured: 700, isBeingRendered: false }], /*allocatedHeight*/ 500, /*initialStored*/ undefined),
			], [
				[{ kind: 'none', height: 500, stored: 500 }],
				[{ kind: 'scheduleInitial', height: 700, stored: 700 }],
			]);
		});

		test('does not store an initial height measured during rendering', () => {
			assert.deepStrictEqual(
				run([
					{ measured: 700, isBeingRendered: true },
					{ measured: 700, isBeingRendered: false },
				], /*allocatedHeight*/ 500, /*initialStored*/ undefined),
				[
					{ kind: 'deferReMeasure', height: 700, stored: undefined },
					{ kind: 'scheduleInitial', height: 700, stored: 700 },
				],
			);
		});
	});

	suite('shouldRenderInitialProgressiveContentImmediately', () => {
		test('renders accumulated markdown immediately only when progressive rendering has not started', () => {
			assert.deepStrictEqual([
				shouldRenderInitialProgressiveContentImmediately(false, true, false),
				shouldRenderInitialProgressiveContentImmediately(false, true, true),
				shouldRenderInitialProgressiveContentImmediately(true, true, false),
				shouldRenderInitialProgressiveContentImmediately(false, false, false),
			], [
				true,
				false,
				false,
				false,
			]);
		});
	});

	suite('shouldStartNewCollapsedThinkingGroup', () => {
		test('separates reasoning and grouped items only in collapsed mode', () => {
			assert.deepStrictEqual({
				reasoningToItems: shouldStartNewCollapsedThinkingGroup(ThinkingDisplayMode.Collapsed, 'reasoning', 'items'),
				itemsToReasoning: shouldStartNewCollapsedThinkingGroup(ThinkingDisplayMode.Collapsed, 'items', 'reasoning'),
				reasoningToReasoning: shouldStartNewCollapsedThinkingGroup(ThinkingDisplayMode.Collapsed, 'reasoning', 'reasoning'),
				itemsToItems: shouldStartNewCollapsedThinkingGroup(ThinkingDisplayMode.Collapsed, 'items', 'items'),
				fixedScrolling: shouldStartNewCollapsedThinkingGroup(ThinkingDisplayMode.FixedScrolling, 'reasoning', 'items'),
				collapsedPreview: shouldStartNewCollapsedThinkingGroup(ThinkingDisplayMode.CollapsedPreview, 'reasoning', 'items'),
			}, {
				reasoningToItems: true,
				itemsToReasoning: true,
				reasoningToReasoning: false,
				itemsToItems: false,
				fixedScrolling: false,
				collapsedPreview: false,
			});
		});
	});

	suite('shouldCreateGroupedThinkingPart', () => {
		test('honors withThinking unless a reasoning group was just separated', () => {
			assert.deepStrictEqual({
				withThinkingWithoutReasoning: shouldCreateGroupedThinkingPart(CollapsedToolsDisplayMode.WithThinking, false),
				withThinkingAfterReasoning: shouldCreateGroupedThinkingPart(CollapsedToolsDisplayMode.WithThinking, true),
				alwaysWithoutReasoning: shouldCreateGroupedThinkingPart(CollapsedToolsDisplayMode.Always, false),
			}, {
				withThinkingWithoutReasoning: false,
				withThinkingAfterReasoning: true,
				alwaysWithoutReasoning: true,
			});
		});
	});

	suite('formatChatResponseDetails', () => {
		test('formats completion metadata for the footer', () => {
			assert.deepStrictEqual([
				formatChatResponseDetails('GPT-5.6 Sol \u2022 1.5 credits', '4:56 PM'),
				formatChatResponseDetails('GPT-5.6 Sol', undefined),
				formatChatResponseDetails(undefined, '4:56 PM'),
				formatElapsedTime(83_000),
			], [
				'4:56 PM \u2022 GPT-5.6 Sol \u2022 1.5 credits',
				'GPT-5.6 Sol',
				'4:56 PM',
				'1m 23s',
			]);
		});

		test('renders completion time with elapsed-time alternate only in verbose mode', () => {
			const container = document.createElement('div');
			container.className = 'chat-footer-details';
			const completedAt = Date.now() - 60 * 60 * 1000;

			renderChatResponseDetails(container, 'Claude Opus 4.8', completedAt, 24_000, false);
			const compact = {
				text: container.textContent,
				timing: container.querySelector('.chat-response-timing'),
				tabIndex: container.tabIndex,
			};

			renderChatResponseDetails(container, 'Claude Opus 4.8', completedAt, 24_000, true);
			assert.deepStrictEqual({
				compact,
				completionDateTime: container.querySelector('time')?.dateTime,
				hasAlternate: container.querySelector('.chat-response-timing')?.classList.contains('has-alternate'),
				duration: container.querySelector('.chat-response-alternate')?.textContent,
				details: container.querySelector('.chat-response-model-details')?.textContent,
				separatorHidden: container.querySelector('.chat-response-details-separator')?.getAttribute('aria-hidden'),
				ariaIncludesElapsed: container.ariaLabel?.includes('24s') ?? false,
				tabIndex: container.tabIndex,
			}, {
				compact: {
					text: 'Claude Opus 4.8',
					timing: null,
					tabIndex: 0,
				},
				completionDateTime: new Date(completedAt).toISOString(),
				hasAlternate: true,
				duration: '24s',
				details: 'Claude Opus 4.8',
				separatorHidden: 'true',
				ariaIncludesElapsed: true,
				tabIndex: 0,
			});

			renderChatResponseDetails(container, undefined, undefined, 24_000, true);
			assert.deepStrictEqual({
				text: container.textContent,
				timing: container.querySelector('.chat-response-timing'),
				hidden: container.classList.contains('hidden'),
				tabIndex: container.tabIndex,
			}, {
				text: '',
				timing: null,
				hidden: true,
				tabIndex: -1,
			});

			const oldCompletion = Date.now() - 25 * 60 * 60 * 1000;
			renderChatResponseDetails(container, undefined, oldCompletion, 24_000, true);
			assert.deepStrictEqual({
				compact: container.querySelector('.chat-response-completed-at')?.textContent,
				alternateEndsWithElapsed: container.querySelector('.chat-response-alternate')?.textContent?.endsWith(' \u2022 24s'),
				hasAlternate: container.querySelector('.chat-response-timing')?.classList.contains('has-alternate'),
			}, {
				compact: '1 day',
				alternateEndsWithElapsed: true,
				hasAlternate: true,
			});
		});
	});

	suite('formatChatRequestTimestamp', () => {
		test('formats valid persisted timestamps and rejects legacy placeholders', () => {
			const timestamp = Date.UTC(2026, 6, 8, 23, 18, 41);
			const formatted = formatChatRequestTimestamp(timestamp);
			assert.deepStrictEqual({
				hasText: !!formatted?.text,
				hasFullText: !!formatted?.fullText,
				dateTime: formatted?.dateTime,
				invalid: formatChatRequestTimestamp(-1),
			}, {
				hasText: true,
				hasFullText: true,
				dateTime: '2026-07-08T23:18:41.000Z',
				invalid: undefined,
			});
		});

		test('uses relative days after 24 hours', () => {
			assert.deepStrictEqual([
				formatChatRequestTimestamp(Date.now() - 25 * 60 * 60 * 1000)?.text,
				formatChatRequestTimestamp(Date.now() - 49 * 60 * 60 * 1000)?.text,
			], [
				'1 day',
				'2 days',
			]);
		});

		test('renders compact days with an animated full date alternate', () => {
			const container = document.createElement('div');
			const timestamp = Date.now() - 25 * 60 * 60 * 1000;

			const rendered = renderChatRequestTimestamp(container, timestamp);

			assert.deepStrictEqual({
				compact: container.querySelector('.chat-request-relative')?.textContent,
				fullDate: container.querySelector('.chat-request-full-date')?.textContent,
				hasAlternate: container.querySelector('.chat-request-timing')?.classList.contains('has-alternate'),
				focusable: rendered?.element.tabIndex,
				managedHoverText: rendered?.hoverText,
			}, {
				compact: '1 day',
				fullDate: formatChatRequestTimestamp(timestamp)?.fullText,
				hasAlternate: true,
				focusable: 0,
				managedHoverText: undefined,
			});
		});
	});

	suite('turn status pills setting', () => {
		test('normalizes boolean and legacy object values', () => {
			assert.deepStrictEqual([
				isChatTurnStatusPillsEnabled(undefined),
				isChatTurnStatusPillsEnabled(false),
				isChatTurnStatusPillsEnabled(true),
				isChatTurnStatusPillsEnabled({}),
				isChatTurnStatusPillsEnabled({ changes: false, preview: false, browser: false }),
				isChatTurnStatusPillsEnabled({ changes: true }),
				isChatTurnStatusPillsEnabled({ preview: true }),
				isChatTurnStatusPillsEnabled({ browser: true }),
			], [false, false, true, false, false, true, true, true]);
		});

		test('computes pill and legacy file summaries independently', () => {
			assert.deepStrictEqual({
				fileSummary: shouldShowFileChangesSummaryForSettings(true, true, true),
				fileSummaryIncomplete: shouldShowFileChangesSummaryForSettings(false, true, true),
				fileSummaryNonLocal: shouldShowFileChangesSummaryForSettings(true, false, true),
				fileSummaryDisabled: shouldShowFileChangesSummaryForSettings(true, true, false),
				pillsSummary: shouldShowPillsSummaryForSettings(true, true, true),
				pillsSummaryLegacy: shouldShowPillsSummaryForSettings(true, true, { preview: true }),
				pillsSummaryIncomplete: shouldShowPillsSummaryForSettings(false, true, true),
				pillsSummaryNonAgentHost: shouldShowPillsSummaryForSettings(true, false, true),
				pillsSummaryDisabled: shouldShowPillsSummaryForSettings(true, true, false),
			}, {
				fileSummary: true,
				fileSummaryIncomplete: false,
				fileSummaryNonLocal: false,
				fileSummaryDisabled: false,
				pillsSummary: true,
				pillsSummaryLegacy: true,
				pillsSummaryIncomplete: false,
				pillsSummaryNonAgentHost: false,
				pillsSummaryDisabled: false,
			});
		});
	});

	suite('shouldPinToolInvocationToThinking', () => {
		test('keeps tool invocations requiring user input or MCP apps outside Thinking', () => {
			assert.deepStrictEqual({
				executionConfirmation: shouldPinToolInvocationToThinking(IChatToolInvocation.StateKind.WaitingForConfirmation, false, false),
				resultApproval: shouldPinToolInvocationToThinking(IChatToolInvocation.StateKind.WaitingForPostApproval, false, false),
				authentication: shouldPinToolInvocationToThinking(IChatToolInvocation.StateKind.WaitingForAuthentication, false, false),
				streaming: shouldPinToolInvocationToThinking(IChatToolInvocation.StateKind.Streaming, false, false),
				executingWithConfirmation: shouldPinToolInvocationToThinking(IChatToolInvocation.StateKind.Executing, true, false),
				executingWithoutConfirmation: shouldPinToolInvocationToThinking(IChatToolInvocation.StateKind.Executing, false, false),
				completed: shouldPinToolInvocationToThinking(IChatToolInvocation.StateKind.Completed, false, false),
				cancelled: shouldPinToolInvocationToThinking(IChatToolInvocation.StateKind.Cancelled, false, false),
				executingWithMcpApp: shouldPinToolInvocationToThinking(IChatToolInvocation.StateKind.Executing, false, true),
				streamingWithMcpApp: shouldPinToolInvocationToThinking(IChatToolInvocation.StateKind.Streaming, false, true),
			}, {
				executionConfirmation: false,
				resultApproval: false,
				authentication: false,
				streaming: true,
				executingWithConfirmation: false,
				executingWithoutConfirmation: true,
				completed: true,
				cancelled: true,
				executingWithMcpApp: false,
				streamingWithMcpApp: false,
			});
		});
	});

	suite('shouldHideChatUserIdentity', () => {
		test('hides local Copilot and Agent Host Copilot response identity', () => {
			assert.deepStrictEqual([
				shouldHideChatUserIdentity('GitHub Copilot', URI.from({ scheme: 'vscode-chat-editor' }), true, false, false),
				shouldHideChatUserIdentity('Copilot', URI.from({ scheme: 'agent-host-copilotcli' }), true, false, false),
				shouldHideChatUserIdentity('Copilot', URI.from({ scheme: 'agent-host-copilotcli' }), false, false, false),
				shouldHideChatUserIdentity('Copilot', URI.from({ scheme: 'remote-test-authority-copilotcli' }), true, false, false),
				shouldHideChatUserIdentity('Copilot', URI.from({ scheme: 'remote-test-authority-copilotcli' }), false, false, false),
				shouldHideChatUserIdentity('Claude', URI.from({ scheme: 'remote-test-authority-claude' }), true, false, false),
				shouldHideChatUserIdentity('Claude', URI.from({ scheme: 'agent-host-claude' }), true, false, false),
				shouldHideChatUserIdentity('Claude', URI.from({ scheme: 'agent-host-claude' }), true, true, false),
				shouldHideChatUserIdentity('User', URI.from({ scheme: 'vscode-chat-editor' }), false, false, true),
			], [
				true,
				true,
				false,
				true,
				false,
				false,
				false,
				true,
				true,
			]);
		});
	});

	suite('buildPlanReviewProgressContent', () => {
		test('keeps plan summary and full plan link after approval', () => {
			const content = buildPlanReviewProgressContent({
				kind: 'planReview',
				title: 'Review Plan',
				content: '## Plan summary',
				actions: [{ id: 'interactive', label: 'Implement Plan' }],
				canProvideFeedback: true,
				planUri: URI.file('/sessions/abc/plan.md').toJSON(),
				isUsed: true,
				data: { rejected: false, action: 'Implement Plan', actionId: 'interactive' },
			}, 'Approved plan');

			assert.strictEqual(content.value, 'Approved&nbsp;plan\n\n## Plan summary\n\n[Open full plan file (plan.md)](file:///sessions/abc/plan.md?vscodeLinkType=file)');
		});

		test('does not expose plan content while review is pending', () => {
			const content = buildPlanReviewProgressContent({
				kind: 'planReview',
				title: 'Review Plan',
				content: '## Secret plan details',
				actions: [{ id: 'interactive', label: 'Implement Plan' }],
				canProvideFeedback: true,
				planUri: URI.file('/sessions/abc/plan.md').toJSON(),
				isUsed: false,
				data: undefined,
			}, 'Plan review required');

			assert.deepStrictEqual({
				value: content.value,
				containsPlan: content.value.includes('Secret plan details'),
				containsLink: content.value.includes('plan.md'),
			}, {
				value: 'Plan&nbsp;review&nbsp;required',
				containsPlan: false,
				containsLink: false,
			});
		});

		test('renders structured feedback and preserves an existing plan URI query', () => {
			const feedback = buildPlanReviewProgressContent({
				kind: 'planReview',
				title: 'Review Plan',
				content: '',
				actions: [{ id: 'interactive', label: 'Implement Plan' }],
				canProvideFeedback: true,
				planUri: URI.parse('file:///sessions/abc/plan.md?view=full').toJSON(),
				isUsed: true,
				data: {
					rejected: false,
					action: 'Implement Plan',
					actionId: 'interactive',
					feedbackOverall: 'Needs more detail',
					feedbackInlineMarkdown: '**Inline comment**',
				},
			}, 'Provided feedback');

			assert.deepStrictEqual({
				value: feedback.value,
				containsNormalizedFeedback: feedback.value.includes('Provided&nbsp;feedback:&nbsp;Needs&nbsp;more&nbsp;detail'),
				containsInlineFeedback: feedback.value.includes('**Inline comment**'),
				planLink: feedback.value.match(/\]\([^)]*\)/)?.[0],
			}, {
				value: 'Provided&nbsp;feedback:&nbsp;Needs&nbsp;more&nbsp;detail\n\n[Open full plan file (plan.md)](file:///sessions/abc/plan.md?view=full&vscodeLinkType=file)\n\n**Inline comment**',
				containsNormalizedFeedback: true,
				containsInlineFeedback: true,
				planLink: '](file:///sessions/abc/plan.md?view=full&vscodeLinkType=file)',
			});
		});
	});

	test('working progress ignores subagent-owned response parts', () => {
		const parentSubagent: IChatToolInvocationSerialized = {
			kind: 'toolInvocationSerialized',
			toolCallId: 'subagent-1',
			toolId: 'task',
			source: ToolDataSource.Internal,
			invocationMessage: 'Running subagent',
			originMessage: undefined,
			pastTenseMessage: undefined,
			isConfirmed: { type: ToolConfirmKind.ConfirmationNotNeeded },
			isComplete: true,
			presentation: undefined,
			toolSpecificData: { kind: 'subagent', description: 'Investigate' },
		};
		const childTool: IChatToolInvocationSerialized = {
			...parentSubagent,
			toolCallId: 'child-1',
			toolId: 'search',
			subAgentInvocationId: 'subagent-1',
			toolSpecificData: undefined,
		};
		const regularTool: IChatToolInvocationSerialized = {
			...childTool,
			toolCallId: 'regular-1',
			subAgentInvocationId: undefined,
		};
		const parts: IChatRendererContent[] = [
			{ kind: 'references', references: [] },
			parentSubagent,
			childTool,
			{ kind: 'markdownContent', content: { value: '<vscode_codeblock_uri subAgentInvocationId="subagent-1">file:///test.txt</vscode_codeblock_uri>' } },
			{ kind: 'hook', hookType: 'PreToolUse', subAgentInvocationId: 'subagent-1' },
			regularTool,
			{ kind: 'markdownContent', content: { value: 'regular response' } },
			{ kind: 'hook', hookType: 'PostToolUse' },
		];

		assert.deepStrictEqual({
			relevantParts: getWorkingProgressRelevantParts(parts).map(part => part.kind),
			endsWithTaggedMarkdown: endsWithSubagentContent(parts.slice(0, 4)),
			endsWithSubagentHook: endsWithSubagentContent(parts),
			endsWithSubagentChildTool: endsWithSubagentContent(parts.slice(0, 3)),
			endsWithParentSubagentTool: endsWithSubagentContent(parts.slice(0, 2)),
			endsWithParentSubagentToolBeforeEmptyMarkdown: endsWithSubagentContent([
				...parts.slice(0, 2),
				{ kind: 'markdownContent', content: { value: '  \n' } },
			]),
		}, {
			relevantParts: ['references', 'toolInvocationSerialized', 'markdownContent', 'hook'],
			endsWithTaggedMarkdown: false,
			endsWithSubagentHook: false,
			endsWithSubagentChildTool: false,
			endsWithParentSubagentTool: true,
			endsWithParentSubagentToolBeforeEmptyMarkdown: true,
		});
	});

	test('working progress is hidden while MCP servers are starting', () => {
		const servers = observableValue('servers', [{ id: 'a', name: 'alpha' }]);
		const part: IChatMcpServersStartingSlow = {
			kind: 'mcpServersStartingSlow',
			sessionResource: URI.parse('chat-session://test/session1'),
			servers,
		};

		const whileStarting = isWaitingForMcpServers([part]);
		servers.set([], undefined);
		const afterStarting = isWaitingForMcpServers([part]);

		assert.deepStrictEqual({ whileStarting, afterStarting }, { whileStarting: true, afterStarting: false });
	});

	test('final markdown remains mounted after thinking and tool progress completes with reduced motion', async () => {
		const disposables = store.add(new DisposableStore());
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(ChatConfiguration.IncrementalRendering, false);
		configurationService.setUserConfiguration(ChatConfiguration.ThinkingStyle, ThinkingDisplayMode.FixedScrolling);
		configurationService.setUserConfiguration('chat.agent.thinking.collapsedTools', CollapsedToolsDisplayMode.Always);
		configurationService.setUserConfiguration('chat.checkpoints.enabled', false);
		configurationService.setUserConfiguration('chat.checkpoints.showFileChanges', false);
		configurationService.setUserConfiguration(ChatConfiguration.TurnStatusPills, false);
		configurationService.setUserConfiguration(ChatConfiguration.Verbose, false);
		configurationService.setUserConfiguration('workbench.reduceMotion', 'on');
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IChatService, new MockChatService());
		instantiationService.stub(IChatAgentService, disposables.add(instantiationService.createInstance(ChatAgentService)));

		const model = disposables.add(instantiationService.createInstance(ChatModel, undefined, { initialLocation: ChatAgentLocation.Chat, canUseTools: true }));
		const viewModel = disposables.add(instantiationService.createInstance(ChatViewModel, model, undefined));
		const text = 'test';
		const request = model.addRequest({
			text,
			parts: [new ChatRequestTextPart(new OffsetRange(0, text.length), new Range(1, 1, 1, text.length + 1), text)]
		}, { variables: [] }, 0);
		const response = viewModel.getItems().find(isResponseVM);
		assert.ok(response);

		const container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const renderer = disposables.add(instantiationService.createInstance(
			ChatListItemRenderer,
			{} as ChatEditorOptions,
			{ progressMessageAtBottomOfResponse: true },
			{
				getListLength: () => 1,
				onDidScroll: () => toDisposable(() => { }),
				container,
				currentChatMode: () => ChatModeKind.Agent,
			},
			undefined,
			viewModel,
		));
		const template = renderer.renderTemplate(container);
		disposables.add(toDisposable(() => renderer.disposeTemplate(template)));
		const node = { element: response, children: [], depth: 0, visibleChildrenCount: 0, visibleChildIndex: 0, collapsible: false, collapsed: false, visible: true, filterData: undefined };

		model.acceptResponseProgress(request, { kind: 'thinking', value: 'Thinking ...', id: 'thinking-1' });
		renderer.renderElement(node, 0, template);

		const toolInvocation = new ChatToolInvocation({
			invocationMessage: 'Running tool...',
			pastTenseMessage: 'Tool completed',
		}, {
			id: 'my-tool',
			displayName: 'My Tool',
			modelDescription: 'Test tool',
			source: ToolDataSource.Internal,
		}, 'call-1', undefined, {}, {}, request.id);
		model.acceptResponseProgress(request, toolInvocation);
		renderer.renderElement(node, 0, template);

		await toolInvocation.didExecuteTool(undefined);
		renderer.renderElement(node, 0, template);

		model.acceptResponseProgress(request, { kind: 'markdownContent', content: new MarkdownString('Final response') });
		renderer.renderElement(node, 0, template);
		const mountedWhileStreaming = template.value.textContent?.includes('Final response') ?? false;

		request.response?.complete();
		renderer.renderElement(node, 0, template);
		assert.deepStrictEqual({
			mountedWhileStreaming,
			mountedAfterCompletion: template.value.textContent?.includes('Final response') ?? false,
		}, {
			mountedWhileStreaming: true,
			mountedAfterCompletion: true,
		});

		disposables.dispose();
	});

	test('final markdown mounts after thinking and tools with default motion', async () => {
		const disposables = store.add(new DisposableStore());
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(ChatConfiguration.IncrementalRendering, false);
		configurationService.setUserConfiguration(ChatConfiguration.ThinkingStyle, ThinkingDisplayMode.FixedScrolling);
		configurationService.setUserConfiguration('chat.agent.thinking.collapsedTools', CollapsedToolsDisplayMode.Always);
		configurationService.setUserConfiguration('chat.checkpoints.enabled', false);
		configurationService.setUserConfiguration('chat.checkpoints.showFileChanges', false);
		configurationService.setUserConfiguration(ChatConfiguration.TurnStatusPills, false);
		configurationService.setUserConfiguration(ChatConfiguration.Verbose, false);
		configurationService.setUserConfiguration('workbench.reduceMotion', 'off');
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IChatService, new MockChatService());
		instantiationService.stub(IChatAgentService, disposables.add(instantiationService.createInstance(ChatAgentService)));

		const model = disposables.add(instantiationService.createInstance(ChatModel, undefined, { initialLocation: ChatAgentLocation.Chat, canUseTools: true }));
		const viewModel = disposables.add(instantiationService.createInstance(ChatViewModel, model, undefined));
		const text = 'test';
		const request = model.addRequest({
			text,
			parts: [new ChatRequestTextPart(new OffsetRange(0, text.length), new Range(1, 1, 1, text.length + 1), text)]
		}, { variables: [] }, 0);
		const response = viewModel.getItems().find(isResponseVM);
		assert.ok(response);

		const container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const renderer = disposables.add(instantiationService.createInstance(
			ChatListItemRenderer,
			{} as ChatEditorOptions,
			{ progressMessageAtBottomOfResponse: true },
			{
				getListLength: () => 1,
				onDidScroll: () => toDisposable(() => { }),
				container,
				currentChatMode: () => ChatModeKind.Agent,
			},
			undefined,
			viewModel,
		));
		const template = renderer.renderTemplate(container);
		disposables.add(toDisposable(() => renderer.disposeTemplate(template)));
		const node = { element: response, children: [], depth: 0, visibleChildrenCount: 0, visibleChildIndex: 0, collapsible: false, collapsed: false, visible: true, filterData: undefined };

		model.acceptResponseProgress(request, { kind: 'thinking', value: 'Thinking ...', id: 'thinking-1' });
		renderer.renderElement(node, 0, template);

		const toolInvocation = new ChatToolInvocation({
			invocationMessage: 'Running tool...',
			pastTenseMessage: 'Tool completed',
		}, {
			id: 'my-tool',
			displayName: 'My Tool',
			modelDescription: 'Test tool',
			source: ToolDataSource.Internal,
		}, 'call-1', undefined, {}, {}, request.id);
		model.acceptResponseProgress(request, toolInvocation);
		renderer.renderElement(node, 0, template);

		await toolInvocation.didExecuteTool(undefined);
		renderer.renderElement(node, 0, template);

		model.acceptResponseProgress(request, { kind: 'markdownContent', content: new MarkdownString('Final response') });
		renderer.renderElement(node, 0, template);
		const mountedWhileStreaming = template.value.textContent?.includes('Final response') ?? false;

		request.response?.complete();
		renderer.renderElement(node, 0, template);
		assert.deepStrictEqual({
			mountedWhileStreaming,
			mountedAfterCompletion: template.value.textContent?.includes('Final response') ?? false,
		}, {
			mountedWhileStreaming: true,
			mountedAfterCompletion: true,
		});

		disposables.dispose();
	});

	test('final markdown mounts with incremental rendering enabled', async () => {
		const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
		const disposables = store.add(new DisposableStore());
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(ChatConfiguration.IncrementalRendering, true);
		configurationService.setUserConfiguration(ChatConfiguration.ThinkingStyle, ThinkingDisplayMode.FixedScrolling);
		configurationService.setUserConfiguration('chat.agent.thinking.collapsedTools', CollapsedToolsDisplayMode.Always);
		configurationService.setUserConfiguration('chat.checkpoints.enabled', false);
		configurationService.setUserConfiguration('chat.checkpoints.showFileChanges', false);
		configurationService.setUserConfiguration(ChatConfiguration.TurnStatusPills, false);
		configurationService.setUserConfiguration(ChatConfiguration.Verbose, false);
		configurationService.setUserConfiguration('workbench.reduceMotion', 'on');
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IChatService, new MockChatService());
		instantiationService.stub(IChatAgentService, disposables.add(instantiationService.createInstance(ChatAgentService)));

		const model = disposables.add(instantiationService.createInstance(ChatModel, undefined, { initialLocation: ChatAgentLocation.Chat, canUseTools: true }));
		const viewModel = disposables.add(instantiationService.createInstance(ChatViewModel, model, undefined));
		const text = 'test';
		const request = model.addRequest({
			text,
			parts: [new ChatRequestTextPart(new OffsetRange(0, text.length), new Range(1, 1, 1, text.length + 1), text)]
		}, { variables: [] }, 0);
		const response = viewModel.getItems().find(isResponseVM);
		assert.ok(response);

		const container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const renderer = disposables.add(instantiationService.createInstance(
			ChatListItemRenderer,
			{} as ChatEditorOptions,
			{ progressMessageAtBottomOfResponse: true },
			{
				getListLength: () => 1,
				onDidScroll: () => toDisposable(() => { }),
				container,
				currentChatMode: () => ChatModeKind.Agent,
			},
			undefined,
			viewModel,
		));
		const template = renderer.renderTemplate(container);
		disposables.add(toDisposable(() => renderer.disposeTemplate(template)));
		const node = { element: response, children: [], depth: 0, visibleChildrenCount: 0, visibleChildIndex: 0, collapsible: false, collapsed: false, visible: true, filterData: undefined };

		model.acceptResponseProgress(request, { kind: 'thinking', value: 'Reasoning step...', id: 'thinking-1' });
		renderer.renderElement(node, 0, template);

		model.acceptResponseProgress(request, { kind: 'markdownContent', content: new MarkdownString('Partial response') });
		renderer.renderElement(node, 0, template);
		const partialMounted = template.value.textContent?.includes('Partial response') ?? false;

		model.acceptResponseProgress(request, { kind: 'markdownContent', content: new MarkdownString('Final response') });
		renderer.renderElement(node, 0, template);

		// Incremental rendering uses a morpher to transition between content chunks;
		// allow time for the morpher to drain before checking the DOM.
		await sleep(100);
		const finalMounted = template.value.textContent?.includes('Final response') ?? false;

		request.response?.complete();
		renderer.renderElement(node, 0, template);
		await sleep(100);
		assert.deepStrictEqual({
			partialMounted,
			finalMounted,
			mountedAfterCompletion: template.value.textContent?.includes('Final response') ?? false,
		}, {
			partialMounted: true,
			finalMounted: true,
			mountedAfterCompletion: true,
		});

		disposables.dispose();
	});

	test('final markdown mounts with collapsed preview thinking mode', async () => {
		const disposables = store.add(new DisposableStore());
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(ChatConfiguration.IncrementalRendering, false);
		configurationService.setUserConfiguration(ChatConfiguration.ThinkingStyle, ThinkingDisplayMode.CollapsedPreview);
		configurationService.setUserConfiguration('chat.agent.thinking.collapsedTools', CollapsedToolsDisplayMode.WithThinking);
		configurationService.setUserConfiguration('chat.checkpoints.enabled', false);
		configurationService.setUserConfiguration('chat.checkpoints.showFileChanges', false);
		configurationService.setUserConfiguration(ChatConfiguration.TurnStatusPills, false);
		configurationService.setUserConfiguration(ChatConfiguration.Verbose, false);
		configurationService.setUserConfiguration('workbench.reduceMotion', 'on');
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IChatService, new MockChatService());
		instantiationService.stub(IChatAgentService, disposables.add(instantiationService.createInstance(ChatAgentService)));

		const model = disposables.add(instantiationService.createInstance(ChatModel, undefined, { initialLocation: ChatAgentLocation.Chat, canUseTools: true }));
		const viewModel = disposables.add(instantiationService.createInstance(ChatViewModel, model, undefined));
		const text = 'test';
		const request = model.addRequest({
			text,
			parts: [new ChatRequestTextPart(new OffsetRange(0, text.length), new Range(1, 1, 1, text.length + 1), text)]
		}, { variables: [] }, 0);
		const response = viewModel.getItems().find(isResponseVM);
		assert.ok(response);

		const container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const renderer = disposables.add(instantiationService.createInstance(
			ChatListItemRenderer,
			{} as ChatEditorOptions,
			{ progressMessageAtBottomOfResponse: true },
			{
				getListLength: () => 1,
				onDidScroll: () => toDisposable(() => { }),
				container,
				currentChatMode: () => ChatModeKind.Agent,
			},
			undefined,
			viewModel,
		));
		const template = renderer.renderTemplate(container);
		disposables.add(toDisposable(() => renderer.disposeTemplate(template)));
		const node = { element: response, children: [], depth: 0, visibleChildrenCount: 0, visibleChildIndex: 0, collapsible: false, collapsed: false, visible: true, filterData: undefined };

		model.acceptResponseProgress(request, { kind: 'thinking', value: 'Step 1 thinking...', id: 'thinking-1' });
		renderer.renderElement(node, 0, template);

		const toolInvocation = new ChatToolInvocation({
			invocationMessage: 'Running tool...',
			pastTenseMessage: 'Tool completed',
		}, {
			id: 'my-tool',
			displayName: 'My Tool',
			modelDescription: 'Test tool',
			source: ToolDataSource.Internal,
		}, 'call-1', undefined, {}, {}, request.id);
		model.acceptResponseProgress(request, toolInvocation);
		renderer.renderElement(node, 0, template);

		await toolInvocation.didExecuteTool(undefined);
		renderer.renderElement(node, 0, template);

		model.acceptResponseProgress(request, { kind: 'markdownContent', content: new MarkdownString('Final response') });
		renderer.renderElement(node, 0, template);
		const mountedWhileStreaming = template.value.textContent?.includes('Final response') ?? false;

		request.response?.complete();
		renderer.renderElement(node, 0, template);
		assert.deepStrictEqual({
			mountedWhileStreaming,
			mountedAfterCompletion: template.value.textContent?.includes('Final response') ?? false,
		}, {
			mountedWhileStreaming: true,
			mountedAfterCompletion: true,
		});

		disposables.dispose();
	});

	test('final markdown mounts with collapsed thinking mode', async () => {
		const disposables = store.add(new DisposableStore());
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(ChatConfiguration.IncrementalRendering, false);
		configurationService.setUserConfiguration(ChatConfiguration.ThinkingStyle, ThinkingDisplayMode.Collapsed);
		configurationService.setUserConfiguration('chat.agent.thinking.collapsedTools', CollapsedToolsDisplayMode.WithThinking);
		configurationService.setUserConfiguration('chat.checkpoints.enabled', false);
		configurationService.setUserConfiguration('chat.checkpoints.showFileChanges', false);
		configurationService.setUserConfiguration(ChatConfiguration.TurnStatusPills, false);
		configurationService.setUserConfiguration(ChatConfiguration.Verbose, false);
		configurationService.setUserConfiguration('workbench.reduceMotion', 'on');
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IChatService, new MockChatService());
		instantiationService.stub(IChatAgentService, disposables.add(instantiationService.createInstance(ChatAgentService)));

		const model = disposables.add(instantiationService.createInstance(ChatModel, undefined, { initialLocation: ChatAgentLocation.Chat, canUseTools: true }));
		const viewModel = disposables.add(instantiationService.createInstance(ChatViewModel, model, undefined));
		const text = 'test';
		const request = model.addRequest({
			text,
			parts: [new ChatRequestTextPart(new OffsetRange(0, text.length), new Range(1, 1, 1, text.length + 1), text)]
		}, { variables: [] }, 0);
		const response = viewModel.getItems().find(isResponseVM);
		assert.ok(response);

		const container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const renderer = disposables.add(instantiationService.createInstance(
			ChatListItemRenderer,
			{} as ChatEditorOptions,
			{ progressMessageAtBottomOfResponse: true },
			{
				getListLength: () => 1,
				onDidScroll: () => toDisposable(() => { }),
				container,
				currentChatMode: () => ChatModeKind.Agent,
			},
			undefined,
			viewModel,
		));
		const template = renderer.renderTemplate(container);
		disposables.add(toDisposable(() => renderer.disposeTemplate(template)));
		const node = { element: response, children: [], depth: 0, visibleChildrenCount: 0, visibleChildIndex: 0, collapsible: false, collapsed: false, visible: true, filterData: undefined };

		model.acceptResponseProgress(request, { kind: 'thinking', value: 'Step 1 thinking...', id: 'thinking-1' });
		renderer.renderElement(node, 0, template);

		const toolInvocation = new ChatToolInvocation({
			invocationMessage: 'Running tool...',
			pastTenseMessage: 'Tool completed',
		}, {
			id: 'my-tool',
			displayName: 'My Tool',
			modelDescription: 'Test tool',
			source: ToolDataSource.Internal,
		}, 'call-1', undefined, {}, {}, request.id);
		model.acceptResponseProgress(request, toolInvocation);
		renderer.renderElement(node, 0, template);

		await toolInvocation.didExecuteTool(undefined);
		renderer.renderElement(node, 0, template);

		model.acceptResponseProgress(request, { kind: 'markdownContent', content: new MarkdownString('Final response') });
		renderer.renderElement(node, 0, template);
		const mountedWhileStreaming = template.value.textContent?.includes('Final response') ?? false;

		request.response?.complete();
		renderer.renderElement(node, 0, template);
		assert.deepStrictEqual({
			mountedWhileStreaming,
			mountedAfterCompletion: template.value.textContent?.includes('Final response') ?? false,
		}, {
			mountedWhileStreaming: true,
			mountedAfterCompletion: true,
		});

		disposables.dispose();
	});

	test('final markdown mounts after async delays between progress updates', async () => {
		const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
		const disposables = store.add(new DisposableStore());
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(ChatConfiguration.IncrementalRendering, false);
		configurationService.setUserConfiguration(ChatConfiguration.ThinkingStyle, ThinkingDisplayMode.FixedScrolling);
		configurationService.setUserConfiguration('chat.agent.thinking.collapsedTools', CollapsedToolsDisplayMode.Always);
		configurationService.setUserConfiguration('chat.checkpoints.enabled', false);
		configurationService.setUserConfiguration('chat.checkpoints.showFileChanges', false);
		configurationService.setUserConfiguration(ChatConfiguration.TurnStatusPills, false);
		configurationService.setUserConfiguration(ChatConfiguration.Verbose, false);
		configurationService.setUserConfiguration('workbench.reduceMotion', 'on');
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IChatService, new MockChatService());
		instantiationService.stub(IChatAgentService, disposables.add(instantiationService.createInstance(ChatAgentService)));

		const model = disposables.add(instantiationService.createInstance(ChatModel, undefined, { initialLocation: ChatAgentLocation.Chat, canUseTools: true }));
		const viewModel = disposables.add(instantiationService.createInstance(ChatViewModel, model, undefined));
		const text = 'test';
		const request = model.addRequest({
			text,
			parts: [new ChatRequestTextPart(new OffsetRange(0, text.length), new Range(1, 1, 1, text.length + 1), text)]
		}, { variables: [] }, 0);
		const response = viewModel.getItems().find(isResponseVM);
		assert.ok(response);

		const container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const renderer = disposables.add(instantiationService.createInstance(
			ChatListItemRenderer,
			{} as ChatEditorOptions,
			{ progressMessageAtBottomOfResponse: true },
			{
				getListLength: () => 1,
				onDidScroll: () => toDisposable(() => { }),
				container,
				currentChatMode: () => ChatModeKind.Agent,
			},
			undefined,
			viewModel,
		));
		const template = renderer.renderTemplate(container);
		disposables.add(toDisposable(() => renderer.disposeTemplate(template)));
		const node = { element: response, children: [], depth: 0, visibleChildrenCount: 0, visibleChildIndex: 0, collapsible: false, collapsed: false, visible: true, filterData: undefined };

		model.acceptResponseProgress(request, { kind: 'thinking', value: 'Thinking ...', id: 'thinking-1' });
		renderer.renderElement(node, 0, template);

		await sleep(50);

		const toolInvocation = new ChatToolInvocation({
			invocationMessage: 'Running tool...',
			pastTenseMessage: 'Tool completed',
		}, {
			id: 'my-tool',
			displayName: 'My Tool',
			modelDescription: 'Test tool',
			source: ToolDataSource.Internal,
		}, 'call-1', undefined, {}, {}, request.id);
		model.acceptResponseProgress(request, toolInvocation);
		renderer.renderElement(node, 0, template);

		await sleep(50);
		await toolInvocation.didExecuteTool(undefined);
		renderer.renderElement(node, 0, template);

		await sleep(50);

		model.acceptResponseProgress(request, { kind: 'markdownContent', content: new MarkdownString('Final response') });
		renderer.renderElement(node, 0, template);

		await sleep(50);

		request.response?.complete();
		renderer.renderElement(node, 0, template);

		assert.strictEqual(template.value.textContent?.includes('Final response'), true);

		disposables.dispose();
	});

	test('final markdown mounts after multiple sequential tool invocations', async () => {
		const disposables = store.add(new DisposableStore());
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(ChatConfiguration.IncrementalRendering, false);
		configurationService.setUserConfiguration(ChatConfiguration.ThinkingStyle, ThinkingDisplayMode.FixedScrolling);
		configurationService.setUserConfiguration('chat.agent.thinking.collapsedTools', CollapsedToolsDisplayMode.Always);
		configurationService.setUserConfiguration('chat.checkpoints.enabled', false);
		configurationService.setUserConfiguration('chat.checkpoints.showFileChanges', false);
		configurationService.setUserConfiguration(ChatConfiguration.TurnStatusPills, false);
		configurationService.setUserConfiguration(ChatConfiguration.Verbose, false);
		configurationService.setUserConfiguration('workbench.reduceMotion', 'on');
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IChatService, new MockChatService());
		instantiationService.stub(IChatAgentService, disposables.add(instantiationService.createInstance(ChatAgentService)));

		const model = disposables.add(instantiationService.createInstance(ChatModel, undefined, { initialLocation: ChatAgentLocation.Chat, canUseTools: true }));
		const viewModel = disposables.add(instantiationService.createInstance(ChatViewModel, model, undefined));
		const text = 'test';
		const request = model.addRequest({
			text,
			parts: [new ChatRequestTextPart(new OffsetRange(0, text.length), new Range(1, 1, 1, text.length + 1), text)]
		}, { variables: [] }, 0);
		const response = viewModel.getItems().find(isResponseVM);
		assert.ok(response);

		const container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const renderer = disposables.add(instantiationService.createInstance(
			ChatListItemRenderer,
			{} as ChatEditorOptions,
			{ progressMessageAtBottomOfResponse: true },
			{
				getListLength: () => 1,
				onDidScroll: () => toDisposable(() => { }),
				container,
				currentChatMode: () => ChatModeKind.Agent,
			},
			undefined,
			viewModel,
		));
		const template = renderer.renderTemplate(container);
		disposables.add(toDisposable(() => renderer.disposeTemplate(template)));
		const node = { element: response, children: [], depth: 0, visibleChildrenCount: 0, visibleChildIndex: 0, collapsible: false, collapsed: false, visible: true, filterData: undefined };

		model.acceptResponseProgress(request, { kind: 'thinking', value: 'Thinking ...', id: 'thinking-1' });
		renderer.renderElement(node, 0, template);

		const firstTool = new ChatToolInvocation({
			invocationMessage: 'Searching files...',
			pastTenseMessage: 'Searched files',
		}, {
			id: 'search-tool',
			displayName: 'Search',
			modelDescription: 'Search tool',
			source: ToolDataSource.Internal,
		}, 'call-1', undefined, {}, {}, request.id);
		model.acceptResponseProgress(request, firstTool);
		renderer.renderElement(node, 0, template);

		await firstTool.didExecuteTool(undefined);
		renderer.renderElement(node, 0, template);

		model.acceptResponseProgress(request, { kind: 'thinking', value: 'More thinking ...', id: 'thinking-2' });
		renderer.renderElement(node, 0, template);

		const secondTool = new ChatToolInvocation({
			invocationMessage: 'Reading file...',
			pastTenseMessage: 'Read file',
		}, {
			id: 'read-tool',
			displayName: 'Read',
			modelDescription: 'Read tool',
			source: ToolDataSource.Internal,
		}, 'call-2', undefined, {}, {}, request.id);
		model.acceptResponseProgress(request, secondTool);
		renderer.renderElement(node, 0, template);

		await secondTool.didExecuteTool(undefined);
		renderer.renderElement(node, 0, template);

		model.acceptResponseProgress(request, { kind: 'markdownContent', content: new MarkdownString('Final response after tools') });
		renderer.renderElement(node, 0, template);
		const mountedWhileStreaming = template.value.textContent?.includes('Final response after tools') ?? false;

		request.response?.complete();
		renderer.renderElement(node, 0, template);
		assert.deepStrictEqual({
			mountedWhileStreaming,
			mountedAfterCompletion: template.value.textContent?.includes('Final response after tools') ?? false,
		}, {
			mountedWhileStreaming: true,
			mountedAfterCompletion: true,
		});

		disposables.dispose();
	});

	test('final markdown mounts after tool execution with error', async () => {
		const disposables = store.add(new DisposableStore());
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(ChatConfiguration.IncrementalRendering, false);
		configurationService.setUserConfiguration(ChatConfiguration.ThinkingStyle, ThinkingDisplayMode.FixedScrolling);
		configurationService.setUserConfiguration('chat.agent.thinking.collapsedTools', CollapsedToolsDisplayMode.Always);
		configurationService.setUserConfiguration('chat.checkpoints.enabled', false);
		configurationService.setUserConfiguration('chat.checkpoints.showFileChanges', false);
		configurationService.setUserConfiguration(ChatConfiguration.TurnStatusPills, false);
		configurationService.setUserConfiguration(ChatConfiguration.Verbose, false);
		configurationService.setUserConfiguration('workbench.reduceMotion', 'on');
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IChatService, new MockChatService());
		instantiationService.stub(IChatAgentService, disposables.add(instantiationService.createInstance(ChatAgentService)));

		const model = disposables.add(instantiationService.createInstance(ChatModel, undefined, { initialLocation: ChatAgentLocation.Chat, canUseTools: true }));
		const viewModel = disposables.add(instantiationService.createInstance(ChatViewModel, model, undefined));
		const text = 'test';
		const request = model.addRequest({
			text,
			parts: [new ChatRequestTextPart(new OffsetRange(0, text.length), new Range(1, 1, 1, text.length + 1), text)]
		}, { variables: [] }, 0);
		const response = viewModel.getItems().find(isResponseVM);
		assert.ok(response);

		const container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const renderer = disposables.add(instantiationService.createInstance(
			ChatListItemRenderer,
			{} as ChatEditorOptions,
			{ progressMessageAtBottomOfResponse: true },
			{
				getListLength: () => 1,
				onDidScroll: () => toDisposable(() => { }),
				container,
				currentChatMode: () => ChatModeKind.Agent,
			},
			undefined,
			viewModel,
		));
		const template = renderer.renderTemplate(container);
		disposables.add(toDisposable(() => renderer.disposeTemplate(template)));
		const node = { element: response, children: [], depth: 0, visibleChildrenCount: 0, visibleChildIndex: 0, collapsible: false, collapsed: false, visible: true, filterData: undefined };

		model.acceptResponseProgress(request, { kind: 'thinking', value: 'Thinking ...', id: 'thinking-1' });
		renderer.renderElement(node, 0, template);

		const toolInvocation = new ChatToolInvocation({
			invocationMessage: 'Running tool...',
			pastTenseMessage: 'Tool completed',
		}, {
			id: 'my-tool',
			displayName: 'My Tool',
			modelDescription: 'Test tool',
			source: ToolDataSource.Internal,
		}, 'call-1', undefined, {}, {}, request.id);
		model.acceptResponseProgress(request, toolInvocation);
		renderer.renderElement(node, 0, template);

		// Tool completes with an error result.
		await toolInvocation.didExecuteTool({ content: [], toolResultError: 'Tool failed' });
		renderer.renderElement(node, 0, template);

		model.acceptResponseProgress(request, { kind: 'markdownContent', content: new MarkdownString('Final response despite error') });
		renderer.renderElement(node, 0, template);
		const mountedWhileStreaming = template.value.textContent?.includes('Final response despite error') ?? false;

		request.response?.complete();
		renderer.renderElement(node, 0, template);
		assert.deepStrictEqual({
			mountedWhileStreaming,
			mountedAfterCompletion: template.value.textContent?.includes('Final response despite error') ?? false,
		}, {
			mountedWhileStreaming: true,
			mountedAfterCompletion: true,
		});

		disposables.dispose();
	});

	test('direct markdown-only response without thinking or tools mounts', async () => {
		const disposables = store.add(new DisposableStore());
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(ChatConfiguration.IncrementalRendering, false);
		configurationService.setUserConfiguration(ChatConfiguration.ThinkingStyle, ThinkingDisplayMode.FixedScrolling);
		configurationService.setUserConfiguration('chat.agent.thinking.collapsedTools', CollapsedToolsDisplayMode.Always);
		configurationService.setUserConfiguration('chat.checkpoints.enabled', false);
		configurationService.setUserConfiguration('chat.checkpoints.showFileChanges', false);
		configurationService.setUserConfiguration(ChatConfiguration.TurnStatusPills, false);
		configurationService.setUserConfiguration(ChatConfiguration.Verbose, false);
		configurationService.setUserConfiguration('workbench.reduceMotion', 'on');
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IChatService, new MockChatService());
		instantiationService.stub(IChatAgentService, disposables.add(instantiationService.createInstance(ChatAgentService)));

		const model = disposables.add(instantiationService.createInstance(ChatModel, undefined, { initialLocation: ChatAgentLocation.Chat, canUseTools: true }));
		const viewModel = disposables.add(instantiationService.createInstance(ChatViewModel, model, undefined));
		const text = 'test';
		const request = model.addRequest({
			text,
			parts: [new ChatRequestTextPart(new OffsetRange(0, text.length), new Range(1, 1, 1, text.length + 1), text)]
		}, { variables: [] }, 0);
		const response = viewModel.getItems().find(isResponseVM);
		assert.ok(response);

		const container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const renderer = disposables.add(instantiationService.createInstance(
			ChatListItemRenderer,
			{} as ChatEditorOptions,
			{ progressMessageAtBottomOfResponse: true },
			{
				getListLength: () => 1,
				onDidScroll: () => toDisposable(() => { }),
				container,
				currentChatMode: () => ChatModeKind.Agent,
			},
			undefined,
			viewModel,
		));
		const template = renderer.renderTemplate(container);
		disposables.add(toDisposable(() => renderer.disposeTemplate(template)));
		const node = { element: response, children: [], depth: 0, visibleChildrenCount: 0, visibleChildIndex: 0, collapsible: false, collapsed: false, visible: true, filterData: undefined };

		// No thinking or tool progress — just direct markdown.
		model.acceptResponseProgress(request, { kind: 'markdownContent', content: new MarkdownString('Simple direct response') });
		renderer.renderElement(node, 0, template);
		const mountedWhileStreaming = template.value.textContent?.includes('Simple direct response') ?? false;

		request.response?.complete();
		renderer.renderElement(node, 0, template);
		assert.deepStrictEqual({
			mountedWhileStreaming,
			mountedAfterCompletion: template.value.textContent?.includes('Simple direct response') ?? false,
		}, {
			mountedWhileStreaming: true,
			mountedAfterCompletion: true,
		});

		disposables.dispose();
	});

	// Helper: sets up a ChatListItemRenderer, model, viewModel, and template for thinking tests.
	// Returns a dispose function and the objects needed for test assertions.
	function createThinkingTestSetup(
		store: Pick<DisposableStore, 'add'>,
		options?: {
			thinkingStyle?: ThinkingDisplayMode;
			collapsedTools?: CollapsedToolsDisplayMode;
			incrementalRendering?: boolean;
			reduceMotion?: string;
			collapseCompletedResponses?: boolean;
		}
	) {
		const instantiationService = workbenchInstantiationService(undefined, store);
		const configurationService = new TestConfigurationService();
		configurationService.setUserConfiguration(ChatConfiguration.IncrementalRendering, options?.incrementalRendering ?? false);
		configurationService.setUserConfiguration(ChatConfiguration.ThinkingStyle, options?.thinkingStyle ?? ThinkingDisplayMode.FixedScrolling);
		configurationService.setUserConfiguration('chat.agent.thinking.collapsedTools', options?.collapsedTools ?? CollapsedToolsDisplayMode.Always);
		configurationService.setUserConfiguration('chat.checkpoints.enabled', false);
		configurationService.setUserConfiguration('chat.checkpoints.showFileChanges', false);
		configurationService.setUserConfiguration(ChatConfiguration.TurnStatusPills, false);
		configurationService.setUserConfiguration(ChatConfiguration.Verbose, false);
		configurationService.setUserConfiguration(ChatConfiguration.CollapseCompletedResponses, options?.collapseCompletedResponses ?? false);
		configurationService.setUserConfiguration('workbench.reduceMotion', options?.reduceMotion ?? 'on');
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IChatService, new MockChatService());
		instantiationService.stub(IChatAgentService, store.add(instantiationService.createInstance(ChatAgentService)));

		const model = store.add(instantiationService.createInstance(ChatModel, undefined, { initialLocation: ChatAgentLocation.Chat, canUseTools: true }));
		const viewModel = store.add(instantiationService.createInstance(ChatViewModel, model, undefined));
		const text = 'test';
		const request = model.addRequest({
			text,
			parts: [new ChatRequestTextPart(new OffsetRange(0, text.length), new Range(1, 1, 1, text.length + 1), text)]
		}, { variables: [] }, 0);
		const response = viewModel.getItems().find(isResponseVM);
		assert.ok(response);

		const container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		store.add(toDisposable(() => container.remove()));
		const renderer = store.add(instantiationService.createInstance(
			ChatListItemRenderer,
			{} as ChatEditorOptions,
			{ progressMessageAtBottomOfResponse: true },
			{
				getListLength: () => 1,
				onDidScroll: () => toDisposable(() => { }),
				container,
				currentChatMode: () => ChatModeKind.Agent,
			},
			undefined,
			viewModel,
		));
		const template = renderer.renderTemplate(container);
		store.add(toDisposable(() => renderer.disposeTemplate(template)));
		const node = { element: response, children: [], depth: 0, visibleChildrenCount: 0, visibleChildIndex: 0, collapsible: false, collapsed: false, visible: true, filterData: undefined };

		return { model, request, response, container, renderer, template, node };
	}

	suite('completed response disclosure', () => {
		test('keeps the final response outside the disclosure and does not duplicate it on rerender', async () => {
			const setup = createThinkingTestSetup(store, {
				collapsedTools: CollapsedToolsDisplayMode.Off,
				collapseCompletedResponses: true,
			});

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'Reasoning step', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);

			const toolInvocation = new ChatToolInvocation({
				invocationMessage: 'Running tool...',
				pastTenseMessage: 'Tool completed',
			}, {
				id: 'my-tool',
				displayName: 'My Tool',
				modelDescription: 'Test tool',
				source: ToolDataSource.Internal,
			}, 'call-1', undefined, {}, {}, setup.request.id);
			setup.model.acceptResponseProgress(setup.request, toolInvocation);
			await toolInvocation.didExecuteTool(undefined);
			setup.model.acceptResponseProgress(setup.request, { kind: 'markdownContent', content: new MarkdownString('Final response') });
			setup.request.response?.complete();
			setup.renderer.renderElement(setup.node, 0, setup.template);

			const disclosure = setup.template.value.querySelector('details.completed-response-disclosure');
			const summary = disclosure?.querySelector('.completed-response-summary')?.textContent;
			const finalResponseInDisclosure = disclosure?.textContent?.includes('Final response') ?? false;
			setup.renderer.renderElement(setup.node, 0, setup.template);

			assert.deepStrictEqual({
				disclosureCount: setup.template.value.querySelectorAll('details.completed-response-disclosure').length,
				summary,
				finalResponseMounted: setup.template.value.textContent?.includes('Final response') ?? false,
				finalResponseInDisclosure,
			}, {
				disclosureCount: 1,
				summary: 'Completed 2 steps',
				finalResponseMounted: true,
				finalResponseInDisclosure: false,
			});
		});
	});

	suite('working progress display', () => {
		test('suppresses generic progress while MCP servers start', () => {
			const setup = createThinkingTestSetup(store);
			const servers = observableValue('servers', [{ id: 'a', name: 'alpha' }]);
			const part: IChatMcpServersStartingSlow = {
				kind: 'mcpServersStartingSlow',
				sessionResource: setup.response.sessionResource,
				servers,
			};

			setup.model.acceptResponseProgress(setup.request, part);
			setup.renderer.renderElement(setup.node, 0, setup.template);
			const hasWorkingProgress = setup.template.renderedParts?.some(part => part instanceof ChatWorkingProgressContentPart) ?? false;
			const mcpProgress = setup.template.value.querySelector<HTMLElement>('.chat-mcp-servers-interaction');
			const hasMcpProgress = !!mcpProgress && mcpProgress.style.display !== 'none';

			assert.deepStrictEqual({ hasWorkingProgress, hasMcpProgress }, {
				hasWorkingProgress: false,
				hasMcpProgress: true,
			});
		});
	});

	suite('thinking display', () => {
		test('renders thinking content in the DOM during streaming', () => {
			const setup = createThinkingTestSetup(store);

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'Analyzing the codebase...', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);

			const textContent = setup.template.value.textContent ?? '';
			assert.ok(textContent.includes('Analyzing the codebase'), 'thinking text should appear in DOM during streaming');
		});

		test('updates thinking content in the DOM when value changes (same id)', () => {
			const setup = createThinkingTestSetup(store);

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'Step 1...', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);
			assert.ok(setup.template.value.textContent?.includes('Step 1'), 'initial thinking text should render');

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'Step 1... now Step 2...', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);
			assert.ok(setup.template.value.textContent?.includes('Step 2'), 'updated thinking text should appear in DOM');
		});

		test('reflects multiple sequential thinking updates in the DOM', () => {
			const setup = createThinkingTestSetup(store);

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'A', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);
			assert.ok(setup.template.value.textContent?.includes('A'), 'first update renders');

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'A B', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);
			assert.ok(setup.template.value.textContent?.includes('A B'), 'second update renders');

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'A B C', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);
			assert.ok(setup.template.value.textContent?.includes('A B C'), 'third update renders');
		});

		test('renders thinking section in collapsed display mode', () => {
			const setup = createThinkingTestSetup(store, { thinkingStyle: ThinkingDisplayMode.Collapsed });

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'Reasoning in collapsed mode...', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);

			// In collapsed mode the body text is hidden inside the collapsed section.
			// Verify that the thinking section exists and has the default title.
			const textContent = setup.template.value.textContent ?? '';
			assert.ok(textContent.includes('Thinking'), 'thinking section title should appear in collapsed mode');
		});

		test('renders thinking content in collapsed preview display mode', () => {
			const setup = createThinkingTestSetup(store, { thinkingStyle: ThinkingDisplayMode.CollapsedPreview });

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'Previewing reasoning...', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);

			const textContent = setup.template.value.textContent ?? '';
			assert.ok(textContent.includes('Previewing reasoning'), 'thinking text should render in collapsed preview mode');
		});

		test('renders thinking content in fixed scrolling display mode', () => {
			const setup = createThinkingTestSetup(store, { thinkingStyle: ThinkingDisplayMode.FixedScrolling });

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'Scrolling reasoning...', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);

			const textContent = setup.template.value.textContent ?? '';
			assert.ok(textContent.includes('Scrolling reasoning'), 'thinking text should render in fixed scrolling mode');
		});

		test('handles thinking with empty value without error', () => {
			const setup = createThinkingTestSetup(store);

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: '', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);
			// Should not throw and DOM should be stable
			assert.ok(setup.template.value, 'DOM should remain stable after empty thinking');
		});

		test('handles thinking with undefined value without error', () => {
			const setup = createThinkingTestSetup(store);

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: undefined, id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);
			assert.ok(setup.template.value, 'DOM should remain stable after undefined thinking value');
		});

		test('thinking content remains visible after response completion', () => {
			const setup = createThinkingTestSetup(store);

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'Final thinking content', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);
			assert.ok(setup.template.value.textContent?.includes('Final thinking content'), 'thinking text should be visible before completion');

			setup.model.acceptResponseProgress(setup.request, { kind: 'markdownContent', content: new MarkdownString('Response after thinking') });
			setup.request.response?.complete();
			setup.renderer.renderElement(setup.node, 0, setup.template);

			const textContent = setup.template.value.textContent ?? '';
			assert.ok(textContent.includes('Final thinking content'), 'thinking text should remain visible after completion');
			assert.ok(textContent.includes('Response after thinking'), 'response text should also be visible after completion');
		});

		test('thinking content updates after tool execution completes', async () => {
			const setup = createThinkingTestSetup(store);

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'Before tool...', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);
			assert.ok(setup.template.value.textContent?.includes('Before tool'), 'initial thinking renders');

			const toolInvocation = new ChatToolInvocation({
				invocationMessage: 'Running search...',
				pastTenseMessage: 'Searched',
			}, {
				id: 'search-tool',
				displayName: 'Search',
				modelDescription: 'Search tool',
				source: ToolDataSource.Internal,
			}, 'call-1', undefined, {}, {}, setup.request.id);
			setup.model.acceptResponseProgress(setup.request, toolInvocation);
			setup.renderer.renderElement(setup.node, 0, setup.template);

			await toolInvocation.didExecuteTool(undefined);
			setup.renderer.renderElement(setup.node, 0, setup.template);

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'After tool: analyzing results...', id: 'think-2' });
			setup.renderer.renderElement(setup.node, 0, setup.template);

			assert.ok(setup.template.value.textContent?.includes('After tool'), 'thinking after tool should update in DOM');
		});

		test('thinking with extracted title from bold text', () => {
			const setup = createThinkingTestSetup(store);

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: '**Analyzing Code**\nLooking at the structure...', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);

			const textContent = setup.template.value.textContent ?? '';
			assert.ok(textContent.includes('Analyzing Code'), 'extracted title from bold text should appear');
			assert.ok(textContent.includes('Looking at the structure'), 'body text after title should also appear');
		});

		test('thinking DOM does not get stale after identical renderElement calls', () => {
			const setup = createThinkingTestSetup(store);

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'UniqueMarker123', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);
			// The first render may add a working-progress indicator that disappears once the
			// thinking part exists in renderedParts. Render once more to let the DOM stabilise.
			setup.renderer.renderElement(setup.node, 0, setup.template);
			const first = setup.template.value.textContent;

			// Render again without any new model content — the DOM must remain identical.
			setup.renderer.renderElement(setup.node, 0, setup.template);
			const second = setup.template.value.textContent;

			assert.strictEqual(first, second, 'DOM should be stable across repeated renderElement calls when no new content arrives');
		});

		test('thinking renders with reduced motion setting', () => {
			const setup = createThinkingTestSetup(store, { reduceMotion: 'on' });

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'Reduced motion thinking', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);

			assert.ok(setup.template.value.textContent?.includes('Reduced motion thinking'), 'thinking should render with reduced motion');
		});

		test('thinking renders with default motion setting', () => {
			const setup = createThinkingTestSetup(store, { reduceMotion: 'off' });

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'Default motion thinking', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);

			assert.ok(setup.template.value.textContent?.includes('Default motion thinking'), 'thinking should render with default motion');
		});

		test('thinking updates incrementally with incremental rendering enabled', async () => {
			const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
			const setup = createThinkingTestSetup(store, { incrementalRendering: true });

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'Incremental step 1', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);
			assert.ok(setup.template.value.textContent?.includes('Incremental step 1'), 'first incremental thinking renders');

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'Incremental step 1 now step 2', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);
			await sleep(100);
			assert.ok(setup.template.value.textContent?.includes('step 2'), 'incremental thinking update should appear');
		});

		test('thinking stays visible when interleaved with multiple tool invocations', async () => {
			const setup = createThinkingTestSetup(store);

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'Initial reasoning', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);

			const tool1 = new ChatToolInvocation(
				{ invocationMessage: 'Searching...', pastTenseMessage: 'Searched' },
				{ id: 'tool-1', displayName: 'Search', modelDescription: 'Search', source: ToolDataSource.Internal },
				'call-1', undefined, {}, {}, setup.request.id
			);
			setup.model.acceptResponseProgress(setup.request, tool1);
			setup.renderer.renderElement(setup.node, 0, setup.template);
			await tool1.didExecuteTool(undefined);
			setup.renderer.renderElement(setup.node, 0, setup.template);

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: 'After first tool, more reasoning', id: 'think-2' });
			setup.renderer.renderElement(setup.node, 0, setup.template);

			const tool2 = new ChatToolInvocation(
				{ invocationMessage: 'Reading...', pastTenseMessage: 'Read' },
				{ id: 'tool-2', displayName: 'Read', modelDescription: 'Read', source: ToolDataSource.Internal },
				'call-2', undefined, {}, {}, setup.request.id
			);
			setup.model.acceptResponseProgress(setup.request, tool2);
			setup.renderer.renderElement(setup.node, 0, setup.template);
			await tool2.didExecuteTool(undefined);
			setup.renderer.renderElement(setup.node, 0, setup.template);

			const textContent = setup.template.value.textContent ?? '';
			assert.ok(
				textContent.includes('Initial reasoning') || textContent.includes('After first tool'),
				'at least one thinking text should remain visible after interleaved tool invocations'
			);
		});

		test('thinking DOM reflects final content after rapid successive updates', () => {
			const setup = createThinkingTestSetup(store);

			const updates = ['A', 'AB', 'ABC', 'ABCD', 'ABCDE'];
			for (let i = 0; i < updates.length; i++) {
				setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: updates[i], id: 'think-1' });
				setup.renderer.renderElement(setup.node, 0, setup.template);
			}

			assert.ok(setup.template.value.textContent?.includes('ABCDE'), 'DOM should reflect the final thinking content after rapid updates');
		});

		test('thinking content with array value is rendered correctly', () => {
			const setup = createThinkingTestSetup(store);

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: ['Part 1 ', 'Part 2 ', 'Part 3'], id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);

			// Array values are joined and rendered as a single text
			const textContent = setup.template.value.textContent ?? '';
			assert.ok(
				textContent.includes('Part 1') || textContent.includes('Part 2') || textContent.includes('Part 3'),
				'array thinking value should have its parts rendered'
			);
		});

		test('thinking content with generatedTitle displays the title', () => {
			const setup = createThinkingTestSetup(store);

			setup.model.acceptResponseProgress(setup.request, {
				kind: 'thinking',
				value: 'Doing some analysis...',
				id: 'think-1',
				generatedTitle: 'Code Analysis',
			});
			setup.request.response?.complete();
			setup.renderer.renderElement(setup.node, 0, setup.template);

			// The generated title appears in the collapsible header area.
			const textContent = setup.template.value.textContent ?? '';
			assert.ok(textContent.includes('Code Analysis'), 'generated title should appear in the DOM');
		});

		test('thinking content with reasoningDurationMs renders without error in collapsed mode', () => {
			const setup = createThinkingTestSetup(store, { thinkingStyle: ThinkingDisplayMode.Collapsed });

			setup.model.acceptResponseProgress(setup.request, {
				kind: 'thinking',
				value: '**Analysis** Some reasoning text',
				id: 'think-1',
				reasoningDurationMs: 5000,
			});
			setup.request.response?.complete();
			setup.renderer.renderElement(setup.node, 0, setup.template);

			// The title should include the extracted heading and the duration suffix.
			// In collapsed mode the section is rendered as a collapsible header;
			// verify the title element contains the expected text.
			const titleElement = setup.template.value.querySelector('.chat-thinking-title-detail-text')
				?? setup.template.value.querySelector('.collapsible-section-title');
			const titleText = titleElement?.textContent ?? setup.template.value.textContent ?? '';
			assert.ok(titleText.includes('Analysis'), 'title should appear with reasoning duration');
		});

		test('empty thinking followed by markdown renders markdown correctly', () => {
			const setup = createThinkingTestSetup(store);

			setup.model.acceptResponseProgress(setup.request, { kind: 'thinking', value: '   ', id: 'think-1' });
			setup.renderer.renderElement(setup.node, 0, setup.template);

			setup.model.acceptResponseProgress(setup.request, { kind: 'markdownContent', content: new MarkdownString('Hello after empty thinking') });
			setup.renderer.renderElement(setup.node, 0, setup.template);

			assert.ok(setup.template.value.textContent?.includes('Hello after empty thinking'), 'markdown after empty thinking should render');
		});
	});

	suite('codeblockHasClosingBackticks', () => {
		test('detects standard closing backticks preceded by newline', () => {
			assert.strictEqual(codeblockHasClosingBackticks('```typescript\nconst x = 1;\n```'), true);
		});

		test('detects closing with four backticks', () => {
			assert.strictEqual(codeblockHasClosingBackticks('````\ncode\n````'), true);
		});

		test('returns false for incomplete code block', () => {
			assert.strictEqual(codeblockHasClosingBackticks('```typescript\nconst x = 1;'), false);
		});

		test('returns false for empty string', () => {
			assert.strictEqual(codeblockHasClosingBackticks(''), false);
		});

		test('trims trailing whitespace before checking', () => {
			assert.strictEqual(codeblockHasClosingBackticks('```ts\ncode\n```  '), true);
		});

		test('returns false when backticks are not preceded by newline', () => {
			assert.strictEqual(codeblockHasClosingBackticks('```typescript\ncode```'), false);
		});

		test('handles markdown with multiple code blocks', () => {
			assert.strictEqual(codeblockHasClosingBackticks('text\n```js\nfirst\n```\nmore\n```py\nsecond\n```'), true);
		});

		test('returns false for inline code only', () => {
			assert.strictEqual(codeblockHasClosingBackticks('use `code` here'), false);
		});
	});

	suite('hasCodeblockUriTag', () => {
		test('returns true for text containing a codeblock URI tag', () => {
			assert.strictEqual(hasCodeblockUriTag('<vscode_codeblock_uri>file:///test.ts</vscode_codeblock_uri>'), true);
		});

		test('returns true for edit codeblock URI tag', () => {
			assert.strictEqual(hasCodeblockUriTag('<vscode_codeblock_uri isEdit>file:///test.ts</vscode_codeblock_uri>'), true);
		});

		test('returns true for codeblock URI tag with subAgentInvocationId', () => {
			assert.strictEqual(hasCodeblockUriTag('<vscode_codeblock_uri isEdit subAgentInvocationId="agent-1">file:///test.ts</vscode_codeblock_uri>'), true);
		});

		test('returns false for plain text', () => {
			assert.strictEqual(hasCodeblockUriTag('some plain text'), false);
		});

		test('returns false for partial prefix', () => {
			assert.strictEqual(hasCodeblockUriTag('<vscode_codebloc'), false);
		});

		test('returns true when tag appears among other content', () => {
			assert.strictEqual(hasCodeblockUriTag('some text <vscode_codeblock_uri>file:///a.ts</vscode_codeblock_uri> more text'), true);
		});
	});



	// End-to-end regression test for https://github.com/microsoft/vscode/issues/326952: a height
	// measured synchronously *during* the render pass must be deferred (not fired re-entrantly and
	// not stored), then reliably delivered to the tree afterwards via a re-measure — so streamed
	// content can't get stranded below a stale row height until a window resize.
	// skipped for https://github.com/microsoft/vscode/issues/327402
	test.skip('fireItemHeightChange defers a mid-render measurement and delivers it after the render pass', async () => {
		const disposables = store.add(new DisposableStore());
		const instantiationService = workbenchInstantiationService(undefined, disposables);
		const configurationService = new TestConfigurationService();
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IChatService, new MockChatService());
		instantiationService.stub(IChatAgentService, disposables.add(instantiationService.createInstance(ChatAgentService)));

		const model = disposables.add(instantiationService.createInstance(ChatModel, undefined, { initialLocation: ChatAgentLocation.Chat, canUseTools: true }));
		const viewModel = disposables.add(instantiationService.createInstance(ChatViewModel, model, undefined));
		const text = 'test';
		const request = model.addRequest({
			text,
			parts: [new ChatRequestTextPart(new OffsetRange(0, text.length), new Range(1, 1, 1, text.length + 1), text)]
		}, { variables: [] }, 0);
		const response = viewModel.getItems().find(isResponseVM);
		assert.ok(response);

		const container = mainWindow.document.createElement('div');
		mainWindow.document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const renderer = disposables.add(instantiationService.createInstance(
			ChatListItemRenderer,
			{} as ChatEditorOptions,
			{ progressMessageAtBottomOfResponse: true },
			{
				getListLength: () => 1,
				onDidScroll: () => toDisposable(() => { }),
				container,
				currentChatMode: () => ChatModeKind.Agent,
			},
			undefined,
			viewModel,
		));
		const template = renderer.renderTemplate(container);
		disposables.add(toDisposable(() => renderer.disposeTemplate(template)));
		const node = { element: response, children: [], depth: 0, visibleChildrenCount: 0, visibleChildIndex: 0, collapsible: false, collapsed: false, visible: true, filterData: undefined };
		model.acceptResponseProgress(request, { kind: 'markdownContent', content: new MarkdownString('Some initial content') });
		renderer.renderElement(node, 0, template);
		// Complete the response so progressive rendering stops. Otherwise a streaming response keeps
		// scheduling `runProgressiveRender` on animation frames, which creates a
		// ChatWorkingProgressContentPart that outlives the test (leaked disposable + stray console
		// output during teardown).
		request.response?.complete();
		renderer.renderElement(node, 0, template);

		const privateRenderer = renderer as unknown as {
			_elementBeingRendered: IChatResponseViewModel | undefined;
			fireItemHeightChange(template: IChatListItemTemplate, measuredHeight?: number): void;
		};
		const nextFrame = () => new Promise<void>(resolve => dom.scheduleAtNextAnimationFrame(dom.getWindow(container), () => resolve()));

		// Let the initial render's height activity (ResizeObserver / scheduled updates) settle.
		await nextFrame();
		await nextFrame();

		// The row's real rendered height. The DOM is NOT mutated after this point, so the row's
		// ResizeObserver stays quiet and only the code under test can deliver a further update.
		const renderedHeight = Math.ceil(template.rowContainer.getBoundingClientRect().height);
		assert.ok(renderedHeight > 1, 'row should have a real rendered height');

		// Simulate streaming that grew the row past the height the tree last acknowledged.
		response.currentRenderedHeight = renderedHeight - 1;
		const heightEvents: number[] = [];
		disposables.add(renderer.onDidChangeItemHeight(e => heightEvents.push(e.height)));

		// (a) A measurement seen synchronously during the render pass must not notify the tree
		// re-entrantly and must not advance the stored height.
		privateRenderer._elementBeingRendered = response;
		privateRenderer.fireItemHeightChange(template);
		assert.deepStrictEqual(
			{ events: [...heightEvents], stored: response.currentRenderedHeight },
			{ events: [], stored: renderedHeight - 1 },
		);

		// (b) Once the render pass is over the deferred re-measure delivers the real height.
		privateRenderer._elementBeingRendered = undefined;
		await nextFrame();
		assert.deepStrictEqual(
			{ events: [...heightEvents], stored: response.currentRenderedHeight },
			{ events: [renderedHeight], stored: renderedHeight },
		);

		disposables.dispose();
	});

});
