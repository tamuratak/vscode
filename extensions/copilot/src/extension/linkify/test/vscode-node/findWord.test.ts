/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { IParserService } from '../../../../platform/parser/node/parserService';
import { CancellationToken } from '../../../../util/vs/base/common/cancellation';
import { URI } from '../../../../util/vs/base/common/uri';
import { findSymbolLocationInFile, ReferencesSymbolResolver, SymbolFileCache } from '../../vscode-node/findWord';
import { asParserService, createTestFile, declaration, symbol, TestParserService } from './util';

suite('Find symbol location in file', () => {

	test('Should return the exact symbol location', async () => {
		const contents = [
			'const value = 1;',
			'',
			'class Foo {',
			'}',
		].join('\n');
		const { uri } = await createTestFile('src/file.ts', contents);

		const location = await findSymbolLocationInFile(
			asParserService(new TestParserService([symbol(contents, 'Foo')])),
			uri,
			'Foo',
			CancellationToken.None,
		);

		assert(location);
		assert.strictEqual(location.uri.toString(), uri.toString());
		assert.strictEqual(location.range.start.line, 2);
		assert.strictEqual(location.range.start.character, 6);
	});

	test('Should prefer declaration matches over earlier generic symbol references', async () => {
		const declarationText = 'class Foo(Base):';
		const contents = [
			'if isinstance(module, Foo):',
			'',
			declarationText,
			'\tpass',
		].join('\n');
		const { uri } = await createTestFile('src/file.py', contents);

		const parserService = new TestParserService(
			[symbol(contents, 'Foo')],
			[declaration(contents, 'Foo', declarationText)],
		);
		const location = await findSymbolLocationInFile(
			asParserService(parserService),
			uri,
			'Foo',
			CancellationToken.None,
		);

		assert(location);
		assert.strictEqual(location.range.start.line, 2);
		assert.strictEqual(location.range.start.character, 0);
		assert.strictEqual(parserService.genericSymbolQueryCount, 0);
	});

	test('Should prefer declaration fallback over generic symbol references for qualified names', async () => {
		const declarationText = 'class Foo:';
		const contents = [
			'if value.bar:',
			'\tpass',
			'',
			declarationText,
			'\tpass',
		].join('\n');
		const { uri } = await createTestFile('src/file.py', contents);

		const parserService = new TestParserService(
			[symbol(contents, 'bar')],
			[declaration(contents, 'Foo', declarationText)],
		);
		const location = await findSymbolLocationInFile(
			asParserService(parserService),
			uri,
			'Foo.bar',
			CancellationToken.None,
		);

		assert(location);
		assert.strictEqual(location.range.start.line, 3);
		assert.strictEqual(location.range.start.character, 0);
		assert.strictEqual(parserService.genericSymbolQueryCount, 0);
	});

	test('Should use the highest-index qualified name part when there is no exact match', async () => {
		const contents = [
			'class Foo {',
			'\tmethod() {',
			'\t}',
			'}',
		].join('\n');
		const { uri } = await createTestFile('src/file.ts', contents);

		const location = await findSymbolLocationInFile(
			asParserService(new TestParserService([
				symbol(contents, 'Foo'),
				symbol(contents, 'method'),
			])),
			uri,
			'Foo.method',
			CancellationToken.None,
		);

		assert(location);
		assert.strictEqual(location.range.start.line, 1);
		assert.strictEqual(location.range.start.character, 1);
	});

	test('Should return undefined for unsupported, missing, or unmatched files', async () => {
		const contents = 'class Foo {}';
		const { workspace, uri: tsUri } = await createTestFile('src/file.ts', contents);
		const txtUri = URI.joinPath(workspace, 'src/file.txt');

		const parserService = asParserService(new TestParserService([symbol(contents, 'Foo')]));

		assert.strictEqual(await findSymbolLocationInFile(parserService, txtUri, 'Foo', CancellationToken.None), undefined);
		assert.strictEqual(await findSymbolLocationInFile(parserService, URI.file('/workspace/src/missing.ts'), 'Foo', CancellationToken.None), undefined);
		assert.strictEqual(await findSymbolLocationInFile(parserService, tsUri, 'Missing', CancellationToken.None), undefined);
	});

	test('Should reuse cached file symbols for repeated URI lookups', async () => {
		const contents = [
			'class Foo {',
			'\tmethod() {',
			'\t}',
			'}',
		].join('\n');
		const { uri } = await createTestFile('src/file.ts', contents);

		const parserService = new TestParserService([
			symbol(contents, 'Foo'),
			symbol(contents, 'method'),
		]);
		const cache: SymbolFileCache = new Map();

		const classLocation = await findSymbolLocationInFile(asParserService(parserService), uri, 'Foo', CancellationToken.None, cache);
		const methodLocation = await findSymbolLocationInFile(asParserService(parserService), uri, 'Foo.method', CancellationToken.None, cache);

		assert(classLocation);
		assert(methodLocation);
		assert.strictEqual(parserService.parseCount, 1);
		assert.strictEqual(parserService.genericSymbolQueryCount, 1);
		assert.deepStrictEqual(parserService.genericSymbolRanges, [{ startIndex: 0, endIndex: contents.length }]);
	});
});

suite('ReferencesSymbolResolver', () => {

	function createResolver(parserService: TestParserService): ReferencesSymbolResolver {
		return new ReferencesSymbolResolver(
			{ symbolMatchesOnly: true, maxResultCount: 8 },
			{
				_serviceBrand: undefined,
				invokeFunction: (fn: Function, ...args: unknown[]) => {
					return fn({
						get: (id: unknown) => {
							if (id === IParserService) {
								return asParserService(parserService);
							}
							return undefined;
						}
					}, ...args);
				},
				createInstance: () => { throw new Error('Not implemented'); },
				createChild: () => { throw new Error('Not implemented'); },
				dispose: () => { },
			} as any,
		);
	}

	test('Should not attempt symbol resolution for command-line flags', async () => {
		const contents = 'export function path(): void {}';
		const { uri } = await createTestFile('src/file.ts', contents);
		const parserService = new TestParserService([symbol(contents, 'path')]);
		const resolver = createResolver(parserService);

		const references = [{ anchor: uri }];
		const result = await resolver.resolve('-D ALLOW_RW_ROOT_0=/path', references, CancellationToken.None);

		assert.strictEqual(result, undefined);
	});

	test('Should not attempt symbol resolution for long flags', async () => {
		const contents = 'export function verbose(): void {}';
		const { uri } = await createTestFile('src/file.ts', contents);
		const parserService = new TestParserService([symbol(contents, 'verbose')]);
		const resolver = createResolver(parserService);

		const references = [{ anchor: uri }];
		const result = await resolver.resolve('--verbose', references as any, CancellationToken.None);

		assert.strictEqual(result, undefined);
	});

	test('Should not attempt symbol resolution for paths', async () => {
		const contents = 'export function path(): void {}';
		const { uri } = await createTestFile('src/file.ts', contents);
		const parserService = new TestParserService([symbol(contents, 'path')]);
		const resolver = createResolver(parserService);

		const references = [{ anchor: uri }];
		const result = await resolver.resolve('/usr/local/bin', references as any, CancellationToken.None);

		assert.strictEqual(result, undefined);
	});

	test('Should attempt symbol resolution for identifier-like code with whitespace', async () => {
		const contents = 'export function func_name(): void {}';
		const { uri } = await createTestFile('src/file.ts', contents);
		const parserService = new TestParserService([symbol(contents, 'func_name')]);
		const resolver = createResolver(parserService);

		const references = [{ anchor: uri }];
		const result = await resolver.resolve('type func_name()', references as any, CancellationToken.None);

		assert.ok(result, 'Expected symbol resolution to succeed for identifier-like code with whitespace');
		assert.strictEqual(result.length, 1);
	});

	test('Should attempt symbol resolution for generic types', async () => {
		const contents = 'export class Array<T> {}';
		const { uri } = await createTestFile('src/file.ts', contents);
		const parserService = new TestParserService([symbol(contents, 'Array')]);
		const resolver = createResolver(parserService);

		const references = [{ anchor: uri }];
		// `Array<string>` should pass the guard — `<`, `>`, and `,` are not blocked
		const result = await resolver.resolve('Array<string>', references as any, CancellationToken.None);

		assert.ok(result, 'Expected symbol resolution to succeed for generic types');
	});

	test('Should attempt symbol resolution for array types', async () => {
		const contents = 'export type string = any;';
		const { uri } = await createTestFile('src/file.ts', contents);
		const parserService = new TestParserService([symbol(contents, 'string')]);
		const resolver = createResolver(parserService);

		const references = [{ anchor: uri }];
		// `string[]` should pass the guard — `[` and `]` are not blocked
		const result = await resolver.resolve('string[]', references as any, CancellationToken.None);

		assert.ok(result, 'Expected symbol resolution to succeed for array types');
	});

	test('Should attempt symbol resolution for private fields', async () => {
		const contents = 'export class Foo { #bar = 1; }';
		const { uri } = await createTestFile('src/file.ts', contents);
		const parserService = new TestParserService([symbol(contents, '#bar')]);
		const resolver = createResolver(parserService);

		const references = [{ anchor: uri }];
		// `#bar` should pass the guard — `#` is not blocked
		const result = await resolver.resolve('#bar', references as any, CancellationToken.None);

		assert.ok(result, 'Expected symbol resolution to succeed for private fields');
	});
});
