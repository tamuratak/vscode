
# 保存セッション: NativeEditContext 調査

## User
- `NativeEditContext` の目的・実装の概要・設計上の利点・利用箇所・テスト方法 などを徹底的に調査して
- Mermaid 図（クラス図・シーケンス図）を出力してほしい
- 上記の会話内容を整理してこのファイルに保存してほしい

## Assistant

### 要点サマリ
- 目的: `NativeEditContext` はブラウザネイティブの EditContext API とエディタの ViewModel/ViewController を橋渡しし、IME（合成）、クリップボード、スクリーンリーダー連携をネイティブ側で安定して扱うための View パーツ。
- 実装概要: `AbstractEditContext` を継承し、内部で `EditContext`（window.EditContext）を生成して `domNode.editContext` にアタッチ。`FocusTracker`、`ScreenReaderSupport`、内部の textarea（IME 補助）と連携し、テキスト/選択/文字矩形/コントロール矩形を EditContext に同期する。入力イベント（textupdate/compositionstart/compositionend 等）を受け取り `ViewController` の `type`/`compositionType`/`paste`/`cut` を呼び出す。
- 設計上の利点:
  - ネイティブ IME 挙動の向上（候補ウィンドウや矢印キーの扱いなど）
  - スクリーンリーダー向けの安定したコンテンツ供給（`ScreenReaderSupport` 経由）
  - クリップボード操作の整合性（`onWillCopy`/`onWillPaste` を Registry 経由で通知）
  - 文字毎の矩形情報を渡せるため、正確な hit-testing と IME の位置合わせが可能
- 利用箇所（コード内参照ハイレベル）:
  - `src/vs/editor/browser/view.ts` （`View` が設定に応じて `NativeEditContext` を生成）
  - `src/vs/editor/browser/controller/editContext/native/nativeEditContext.ts`（本体）
  - `NativeEditContextRegistry` を参照する機能: クリップボード contrib、Chat input contrib など
  - `screenReaderSupport.ts`、`textAreaEditContext.ts`（比較対象）
- テスト方法:
  - 単体: `TestConfiguration` で `envConfig.editContextSupported = true` を使ったユニット（選択・type/composition イベントの発火、`_editContext.updateText` / `updateSelection` の呼び出し検証）
  - 統合/手動: 実際に `window.EditContext` を提供するブラウザ（対応する Chrome/Edge またはネイティブ WebView）上で IME 操作・コピー/貼り付け・スクリーンリーダーを検証
  - 回帰: `NativeEditContextRegistry` 経由で chat/clipboard が `onWillCopy/onWillPaste` を呼べるかを確認

### 出力した Mermaid 図

```mermaid
classDiagram
	%% Source: src/vs/editor/browser/controller/editContext/native/nativeEditContext.ts#L52-L672
	class AbstractEditContext {
		+focus()
		+isFocused()
		+refreshFocusState()
		+setAriaOptions()
		+getLastRenderData()
		+writeScreenReaderContent()
	}

	class NativeEditContext {
		-domNode: FastDomNode<HTMLElement>
		-_imeTextArea: FastDomNode<HTMLTextAreaElement>
		-_screenReaderSupport: ScreenReaderSupport
		-_focusTracker: FocusTracker
		-_editContext: EditContext
		-_decorations: string[]
		-_primarySelection: Selection
		-_previousEditContextSelection: OffsetRange
		+focus()
		+isFocused()
		+refreshFocusState()
		+setAriaOptions()
		+prepareRender()
		+onCursorStateChanged()
		+onScrollChanged()
		+onLinesChanged()
		+onWillPaste()
		+onWillCopy()
		+writeScreenReaderContent()
		+setEditContextOnDomNode()
	}

	class ScreenReaderSupport {
		-_domNode: FastDomNode<HTMLElement>
		-_state: MutableDisposable<IScreenReaderContent>
		-_renderRichContent: boolean | undefined
		-_primarySelection: Selection
		+onWillPaste()
		+onWillCut()
		+handleFocusChange()
		+prepareRender()
		+render()
		+setAriaOptions()
		+writeScreenReaderContent()
	}

	class FocusTracker {
		-_domNode: HTMLElement
		-_isFocused: boolean
		-_isPaused: boolean
		+focus()
		+refreshFocusState()
		+pause()
		+resume()
		+isFocused()
	}

	class ViewController {
		+type()
		+compositionType()
		+paste()
		+cut()
		+emitKeyDown()
		+emitKeyUp()
		+setSelection()
		+compositionStart()
		+compositionEnd()
	}

	AbstractEditContext <|-- NativeEditContext
	NativeEditContext --> ScreenReaderSupport
	NativeEditContext --> FocusTracker
	NativeEditContext --> ViewController
```

```mermaid
sequenceDiagram
	%% Source: src/vs/editor/browser/controller/editContext/native/nativeEditContext.ts#L137-L220
	participant User
	participant NativeEditContext
	participant ViewController
	participant ScreenReaderSupport
	participant View

	User->>NativeEditContext: キー入力・IMEイベント
	NativeEditContext->>ViewController: _emitTypeEvent で type/compositionType
	ViewController->>View: cursor/selection 更新（ViewCursorStateChangedEvent）
	View->>NativeEditContext: onCursorStateChanged で選択保持
	NativeEditContext->>ScreenReaderSupport: onCursorStateChanged / prepareRender
	ScreenReaderSupport->>NativeEditContext: writeScreenReaderContent 更新
	NativeEditContext->>NativeEditContext: _updateEditContext() で EditContext にテキスト/選択を反映
```

### 参照ファイル（主要）
- `src/vs/editor/browser/controller/editContext/native/nativeEditContext.ts` — `NativeEditContext` 本体（実装の中心）
- `src/vs/editor/browser/controller/editContext/native/screenReaderSupport.ts` — スクリーンリーダー連携実装
- `src/vs/editor/browser/controller/editContext/native/nativeEditContextRegistry.ts` — 登録/取得用レジストリ
- `src/vs/editor/browser/controller/editContext/native/editContextFactory.ts` — `EditContext.create` ファクトリ
- `src/vs/editor/browser/controller/editContext/textArea/textAreaEditContext.ts` — 既存の `TextAreaEditContext`（比較対象）
- `src/vs/editor/browser/view.ts` — `View` 側で `NativeEditContext` を生成する箇所
- `src/vs/editor/common/config/editorOptions.ts` — `editor.editContext` / `effectiveEditContext` オプション定義
- `src/vs/editor/browser/config/migrateOptions.ts` — 設定マイグレーション（experimental → 現行）
- `src/vs/editor/contrib/clipboard/browser/clipboard.ts` — クリップボード連携で Registry を参照する箇所
- `src/vs/workbench/contrib/chat/browser/widget/input/editor/chatInputEditorContrib.ts` — chat input が Registry 経由で属性を更新する箇所

---

必要であれば、この `editcontext.md` を基点に「単体テストケースの雛形」や「統合テスト手順（実機）」を作成しますか？
