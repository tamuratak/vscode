/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MarkdownString } from '../../../../../../base/common/htmlContent.js';
import { URI } from '../../../../../../base/common/uri.js';
import { strictEqual } from 'assert';
import { assertSnapshot } from '../../../../../../base/test/common/snapshot.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IChatMarkdownContent } from '../../../common/chatService/chatService.js';
import { annotateSpecialMarkdownContent, extractVulnerabilitiesFromText } from '../../../common/widget/annotations.js';

function content(str: string): IChatMarkdownContent {
	return { kind: 'markdownContent', content: new MarkdownString(str) };
}

suite('Annotations', function () {
	ensureNoDisposablesAreLeakedInTestSuite();

	suite('extractVulnerabilitiesFromText', () => {
		test('single line', async () => {
			const before = 'some code ';
			const vulnContent = 'content with vuln';
			const after = ' after';
			const annotatedResult = annotateSpecialMarkdownContent([content(before), { kind: 'markdownVuln', content: new MarkdownString(vulnContent), vulnerabilities: [{ title: 'title', description: 'vuln' }] }, content(after)]);
			await assertSnapshot(annotatedResult);

			const markdown = annotatedResult[0] as IChatMarkdownContent;
			const result = extractVulnerabilitiesFromText(markdown.content.value);
			await assertSnapshot(result);
		});

		test('multiline', async () => {
			const before = 'some code\nover\nmultiple lines ';
			const vulnContent = 'content with vuln\nand\nnewlines';
			const after = 'more code\nwith newline';
			const annotatedResult = annotateSpecialMarkdownContent([content(before), { kind: 'markdownVuln', content: new MarkdownString(vulnContent), vulnerabilities: [{ title: 'title', description: 'vuln' }] }, content(after)]);
			await assertSnapshot(annotatedResult);

			const markdown = annotatedResult[0] as IChatMarkdownContent;
			const result = extractVulnerabilitiesFromText(markdown.content.value);
			await assertSnapshot(result);
		});

		test('multiple vulns', async () => {
			const before = 'some code\nover\nmultiple lines ';
			const vulnContent = 'content with vuln\nand\nnewlines';
			const after = 'more code\nwith newline';
			const annotatedResult = annotateSpecialMarkdownContent([
				content(before),
				{ kind: 'markdownVuln', content: new MarkdownString(vulnContent), vulnerabilities: [{ title: 'title', description: 'vuln' }] },
				content(after),
				{ kind: 'markdownVuln', content: new MarkdownString(vulnContent), vulnerabilities: [{ title: 'title', description: 'vuln' }] },
			]);
			await assertSnapshot(annotatedResult);

			const markdown = annotatedResult[0] as IChatMarkdownContent;
			const result = extractVulnerabilitiesFromText(markdown.content.value);
			await assertSnapshot(result);
		});
	});

	suite('codeblockUri annotations', () => {
		test('injects codeblock uri before closing fence', () => {
			const annotatedResult = annotateSpecialMarkdownContent([
				content('```ts\nconst a = 1;\n```'),
				{ kind: 'codeblockUri', uri: URI.parse('file:///foo/bar'), isEdit: true },
			]);
			const markdown = annotatedResult[0] as IChatMarkdownContent;
			strictEqual(markdown.content.value, '```ts\nconst a = 1;\n<vscode_codeblock_uri isEdit>file:///foo/bar</vscode_codeblock_uri>\n```');
		});
	});
});
