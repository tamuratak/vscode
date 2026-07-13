/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Disposable, DisposableStore } from '../../../../../../base/common/lifecycle.js';
import { constObservable } from '../../../../../../base/common/observable.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ChatTreeItem } from '../../../browser/chat.js';
import { buildPlanReviewProgressContent, diffChatContentParts, getWorkingProgressRelevantParts, shouldCreateGroupedThinkingPart, shouldHideChatUserIdentity, shouldRenderInitialProgressiveContentImmediately, shouldScheduleInitialHeightChange, shouldStartNewCollapsedThinkingGroup } from '../../../browser/widget/chatListRenderer.js';
import { IChatContentPart } from '../../../browser/widget/chatContentParts/chatContentParts.js';
import { IChatToolInvocation, IChatToolInvocationSerialized, ToolConfirmKind } from '../../../common/chatService/chatService.js';
import { CollapsedToolsDisplayMode, ThinkingDisplayMode } from '../../../common/constants.js';
import { IChatRendererContent } from '../../../common/model/chatViewModel.js';
import { ToolDataSource } from '../../../common/tools/languageModelToolsService.js';

suite('ChatListRenderer', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

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
		const parts: IChatRendererContent[] = [
			{ kind: 'references', references: [] },
			parentSubagent,
			childTool,
			{ kind: 'markdownContent', content: { value: '<vscode_codeblock_uri subAgentInvocationId="subagent-1">file:///test.txt</vscode_codeblock_uri>' } },
			{ kind: 'hook', hookType: 'PreToolUse', subAgentInvocationId: 'subagent-1' },
		];

		assert.deepStrictEqual(getWorkingProgressRelevantParts(parts).map(part => part.kind), ['references']);
	});

	suite('diffChatContentParts', () => {
		const fakeElement = {} as ChatTreeItem;
		let disposables: DisposableStore;

		setup(() => {
			disposables = new DisposableStore();
		});

		teardown(() => {
			disposables.dispose();
		});

		function createMockPart(hasSameContent: IChatContentPart['hasSameContent']): IChatContentPart {
			return disposables.add(new class extends Disposable {
				domNode = undefined;
				hasSameContent = hasSameContent;
			}());
		}

		/**
		 * Mimics the current (buggy) ChatToolInvocationPart.hasSameContent
		 * that only checks toolCallId and ignores state changes.
		 */
		function toolInvocationHasSameContentCurrent(
			thisToolCallId: string,
			other: IChatRendererContent,
		): boolean {
			return (other.kind === 'toolInvocation' || other.kind === 'toolInvocationSerialized')
				&& thisToolCallId === other.toolCallId;
		}

		test('tool invocation should be re-rendered when state changes from Streaming to Completed', () => {
			const toolCallId = 'call-1';

			// Rendered part was created during Streaming state
			const renderedPart = createMockPart(
				(other, followingContent, element) => toolInvocationHasSameContentCurrent(toolCallId, other),
			);

			// New content has same toolCallId but Completed state
			const newContent: IChatRendererContent = {
				kind: 'toolInvocation',
				toolCallId,
				toolId: 'search',
				source: ToolDataSource.Internal,
				invocationMessage: 'Searching...',
				originMessage: undefined,
				pastTenseMessage: 'Searched',
				state: constObservable({ type: IChatToolInvocation.StateKind.Completed, parameters: {}, confirmed: { type: ToolConfirmKind.ConfirmationNotNeeded }, resultDetails: undefined, postConfirmed: undefined, contentForModel: [] }),
				toolSpecificDataKind: constObservable(undefined),
				toolSpecificData: undefined,
				presentation: undefined,
				isAttachedToThinking: false,
				generatedTitle: undefined,
				kind: 'toolInvocation',
				toJSON(): IChatToolInvocationSerialized {
					return {
						kind: 'toolInvocationSerialized',
						toolCallId,
						toolId: 'search',
						source: ToolDataSource.Internal,
						invocationMessage: 'Searching...',
						originMessage: undefined,
						pastTenseMessage: 'Searched',
						isConfirmed: { type: ToolConfirmKind.ConfirmationNotNeeded },
						isComplete: true,
						presentation: undefined,
						toolSpecificData: undefined,
					};
				},
			} as unknown as IChatRendererContent;

			const result = diffChatContentParts([renderedPart], [newContent], fakeElement);

			// State changed from Streaming to Completed: diff should return the new content (not null)
			assert.strictEqual(result[0], newContent, 'State change should trigger re-render');
		});

		test('returns content when toolCallId differs', () => {
			const renderedPart = createMockPart(
				(other) => toolInvocationHasSameContentCurrent('call-1', other),
			);

			const newContent: IChatRendererContent = {
				kind: 'toolInvocation',
				toolCallId: 'call-2',
			} as unknown as IChatRendererContent;

			const result = diffChatContentParts([renderedPart], [newContent], fakeElement);

			assert.strictEqual(result[0], newContent, 'Different toolCallId should trigger re-render');
		});

		test('returns null for identical content', () => {
			const content: IChatRendererContent = {
				kind: 'markdownContent',
				content: { value: 'hello' },
			};

			const renderedPart = createMockPart(
				(other) => other.kind === 'markdownContent' && other.content.value === 'hello',
			);

			const result = diffChatContentParts([renderedPart], [content], fakeElement);

			assert.strictEqual(result[0], null, 'Same content should return null');
		});

		test('returns content when no rendered part exists', () => {
			const content: IChatRendererContent = {
				kind: 'markdownContent',
				content: { value: 'hello' },
			};

			const result = diffChatContentParts([], [content], fakeElement);

			assert.strictEqual(result[0], content, 'No rendered part should trigger render');
		});

		test('diff correctly handles mixed content with state-changing tool invocations', () => {
			const toolCallId = 'call-1';

			const renderedPart = createMockPart(
				(other) => toolInvocationHasSameContentCurrent(toolCallId, other),
			);
			const markdownPart = createMockPart(
				(other) => other.kind === 'markdownContent' && other.content.value === 'old text',
			);

			const toolContent: IChatRendererContent = {
				kind: 'toolInvocation',
				toolCallId,
			} as unknown as IChatRendererContent;

			const newMarkdown: IChatRendererContent = {
				kind: 'markdownContent',
				content: { value: 'new text' },
			};

			const result = diffChatContentParts(
				[renderedPart, markdownPart],
				[toolContent, newMarkdown],
				fakeElement,
			);

			// Tool invocation: state changed -> should re-render
			assert.strictEqual(result[0], toolContent, 'Tool invocation: state change should trigger re-render');
			// Markdown: different content -> re-render
			assert.strictEqual(result[1], newMarkdown, 'Markdown: different content triggers re-render');
		});

		test('fixed hasSameContent would detect state changes', () => {
			const toolCallId = 'call-1';

			// Simulate the FIXED hasSameContent that also checks state type
			const renderedPart = createMockPart(
				(other, followingContent, element) => {
					if (other.kind !== 'toolInvocation' && other.kind !== 'toolInvocationSerialized') {
						return false;
					}
					if (toolCallId !== other.toolCallId) {
						return false;
					}
					// The fix: also compare state type
					// In the real code, this.toolInvocation.state.get().type would be compared
					// Here we simulate it by always returning false (state changed)
					return false;
				},
			);

			const newContent: IChatRendererContent = {
				kind: 'toolInvocation',
				toolCallId,
			} as unknown as IChatRendererContent;

			const result = diffChatContentParts([renderedPart], [newContent], fakeElement);

			// With the fix: state change detected -> re-render
			assert.strictEqual(result[0], newContent, 'Fixed hasSameContent detects state change and triggers re-render');
		});
	});

});
