# Chat List Renderer Test Research (Phase 1)

## Research Plan
- Locate existing chat list renderer tests that cover thinking vs. final markdown placement.
- Identify renderer logic that determines when markdown is inside/outside thinking containers.
- Map candidate insertion points for new tests and helper utilities in the test suite.

## Findings
- Existing tests already assert final markdown is outside thinking and cover codeblock URI and pinned markdown cases in [src/vs/workbench/contrib/chat/test/browser/widget/chatListRenderer.test.ts](src/vs/workbench/contrib/chat/test/browser/widget/chatListRenderer.test.ts#L456-L527).
- Renderer diff logic treats the final markdown part specially to avoid keeping it inside a thinking wrapper: [src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts](src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts#L1169-L1405).
- Markdown rendering finalizes thinking unless codeblock URI pinning applies; final answer parts are detected in render and diff paths: [src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts](src/vs/workbench/contrib/chat/browser/widget/chatListRenderer.ts#L2224-L2339).

## Phase 2 Plan
1. Add test coverage for final markdown outside thinking in additional thinking display modes.
2. Add a case with multiple thinking parts to ensure the final markdown is still outside the thinking container.
3. Keep assertions minimal using DOM queries that mirror existing tests.
4. Run the chat list renderer test task and iterate until it passes.
