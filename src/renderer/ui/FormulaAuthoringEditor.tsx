import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import {
  FORMULA_SLOT,
  FormulaLinearParseError,
  formulaAstContainsSlot,
  formulaAstToAccessibleText,
  insertFormulaTemplate,
  parseFormulaLinear,
  serializeFormulaAst,
} from '../../shared/formulaLinear'
import { renderFormulaNodeCanvas } from '../../shared/formulaRenderer'
import { formulaAstSchema } from '../../shared/contracts/native-v1'
import type { FormulaAstNode, FormulaNode } from '../../shared/contracts/native-v1'

export interface FormulaAuthoringDraftChange {
  readonly source: string
  readonly ast: FormulaAstNode | null
  readonly accessibleText: string
  readonly error: string | null
  readonly hasSlots: boolean
  readonly committable: boolean
}

interface FormulaAuthoringEditorProps {
  node: FormulaNode
  onCommit(ast: FormulaAstNode, accessibleText: string): void
  autoFocus?: boolean
  onCancel?: () => void
  /** When provided, the formula source is controlled by the owning authoring session. */
  draftSource?: string
  onDraftChange?: (draft: FormulaAuthoringDraftChange) => void
  onCompositionChange?: (composing: boolean) => void
  onBeginEdit?: () => void
}

interface ParsedDraft {
  ast: FormulaAstNode | null
  accessibleText: string
  error: string | null
  hasSlots: boolean
}

interface FormulaTemplate {
  label: string
  value: string
  title?: string
  selectedSlotIndex?: number
}

const STRUCTURE_TEMPLATES: readonly FormulaTemplate[] = [
  { label: '分式', value: `\\frac{${FORMULA_SLOT}}{${FORMULA_SLOT}}` },
  { label: '平方根', value: `\\sqrt{${FORMULA_SLOT}}` },
  {
    label: 'n 次根',
    value: `\\sqrt[${FORMULA_SLOT}]{${FORMULA_SLOT}}`,
    selectedSlotIndex: 1,
  },
  // Group the base without adding a visible fence. Otherwise selecting a
  // sequence such as `a+b` would produce `a+b^{□}` and attach the script only
  // to the final token instead of the selected expression.
  { label: '上标', value: `{${FORMULA_SLOT}}^{${FORMULA_SLOT}}` },
  { label: '下标', value: `{${FORMULA_SLOT}}_{${FORMULA_SLOT}}` },
  { label: '上下标', value: `{${FORMULA_SLOT}}_{${FORMULA_SLOT}}^{${FORMULA_SLOT}}` },
  { label: '圆括号', value: `(${FORMULA_SLOT})` },
  { label: '方括号', value: `[${FORMULA_SLOT}]` },
  { label: '大括号', value: `\\{${FORMULA_SLOT}\\}` },
]

const SYMBOL_TEMPLATES: readonly FormulaTemplate[] = [
  { label: '+', value: '+' },
  { label: '−', value: '−' },
  { label: '×', value: '×' },
  { label: '÷', value: '÷' },
  { label: '=', value: '=' },
  { label: '≠', value: '≠' },
  { label: '≤', value: '≤' },
  { label: '≥', value: '≥' },
  { label: '±', value: '±' },
  { label: 'α', value: 'α', title: '阿尔法' },
  { label: 'β', value: 'β', title: '贝塔' },
  { label: 'θ', value: 'θ', title: '西塔' },
  { label: 'π', value: 'π', title: '圆周率' },
  { label: 'φ', value: 'φ', title: '斐' },
  { label: 'ω', value: 'ω', title: '欧米伽' },
]

function formatParseFailure(error: unknown): string {
  if (error instanceof FormulaLinearParseError) {
    return `第 ${error.position + 1} 个字符：${error.message}`
  }
  return error instanceof Error ? error.message : String(error)
}

function parseDraft(source: string): ParsedDraft {
  try {
    const parsed = parseFormulaLinear(source)
    const validated = formulaAstSchema.safeParse(parsed)
    if (!validated.success) {
      const issue = validated.error.issues[0]
      const path = issue?.path.length ? `${issue.path.join('.')}：` : ''
      return {
        ast: null,
        accessibleText: '',
        error: `${path}${issue?.message ?? '公式超出 Project V8 限制'}`,
        hasSlots: false,
      }
    }
    return {
      ast: validated.data,
      accessibleText: formulaAstToAccessibleText(validated.data),
      error: null,
      hasSlots: formulaAstContainsSlot(validated.data),
    }
  } catch (error) {
    return {
      ast: null,
      accessibleText: '',
      error: formatParseFailure(error),
      hasSlots: false,
    }
  }
}

function sameAst(left: FormulaAstNode | null, right: FormulaAstNode): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right)
}

function isAutomaticAccessibleText(node: FormulaNode): boolean {
  const normalize = (value: string) => value.replace(/\s+/gu, '')
  return normalize(node.accessibleText) === normalize(formulaAstToAccessibleText(node.ast))
}

function FormulaDraftPreview({ node, draft }: {
  node: FormulaNode
  draft: ParsedDraft
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    if (!draft.ast) {
      host.replaceChildren()
      setPreviewError(null)
      return
    }
    let renderedCanvas: HTMLCanvasElement | null = null
    try {
      const width = Math.max(280, Math.min(520, node.width))
      const height = Math.max(112, Math.min(220, node.height))
      const rendered = renderFormulaNodeCanvas({
        ...node,
        ast: draft.ast,
        width,
        height,
        style: {
          ...node.style,
          fontSize: Math.min(node.style.fontSize, 56),
        },
      }, width, height, Math.min(2, window.devicePixelRatio || 1))
      renderedCanvas = rendered.canvas
      renderedCanvas.className = 'formula-authoring-preview__canvas'
      renderedCanvas.setAttribute('aria-hidden', 'true')
      host.replaceChildren(renderedCanvas)
      setPreviewError(null)
    } catch (error) {
      host.replaceChildren()
      setPreviewError(error instanceof Error ? error.message : String(error))
    }
    return () => {
      renderedCanvas?.remove()
    }
  }, [draft.ast, node])

  return (
    <div className="formula-authoring-preview">
      <span className="formula-authoring-preview__label">实时排版预览</span>
      <div
        ref={hostRef}
        className="formula-authoring-preview__surface"
        role="img"
        aria-label={draft.ast
          ? `公式预览：${draft.accessibleText}`
          : '公式预览暂不可用'}
        data-testid="formula-preview"
      />
      {previewError && (
        <span className="formula-authoring-preview__fallback">
          预览暂不可用；已保留当前公式。
        </span>
      )}
    </div>
  )
}

export function FormulaAuthoringEditor({
  node,
  onCommit,
  autoFocus = false,
  onCancel,
  draftSource: controlledDraftSource,
  onDraftChange,
  onCompositionChange,
  onBeginEdit,
}: FormulaAuthoringEditorProps) {
  const canonicalSource = useMemo(() => serializeFormulaAst(node.ast), [node.ast])
  const [localDraftSource, setLocalDraftSource] = useState(canonicalSource)
  const draftSource = controlledDraftSource ?? localDraftSource
  const [notice, setNotice] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const pendingSelectionRef = useRef<[number, number] | null>(null)
  const composingRef = useRef(false)
  const parsed = useMemo(() => parseDraft(draftSource), [draftSource])
  const accessibilityAutomatic = isAutomaticAccessibleText(node)
  const dirty = !sameAst(parsed.ast, node.ast)

  useEffect(() => {
    if (controlledDraftSource === undefined) setLocalDraftSource(canonicalSource)
  }, [canonicalSource, controlledDraftSource, node.id])

  useEffect(() => {
    setNotice(null)
  }, [node.id])

  useEffect(() => {
    if (!autoFocus) return
    inputRef.current?.focus({ preventScroll: true })
    inputRef.current?.setSelectionRange(0, inputRef.current.value.length)
  }, [autoFocus, node.id])

  useLayoutEffect(() => {
    const selection = pendingSelectionRef.current
    if (!selection) return
    pendingSelectionRef.current = null
    inputRef.current?.focus()
    inputRef.current?.setSelectionRange(selection[0], selection[1])
  }, [draftSource])

  const publishDraftSource = (source: string) => {
    if (controlledDraftSource === undefined) setLocalDraftSource(source)
    const next = parseDraft(source)
    onDraftChange?.({
      source,
      ast: next.ast,
      accessibleText: accessibilityAutomatic ? next.accessibleText : node.accessibleText,
      error: next.error,
      hasSlots: next.hasSlots,
      committable: Boolean(next.ast && !next.error && !next.hasSlots),
    })
  }

  const resetDraft = () => {
    if (controlledDraftSource === undefined) setLocalDraftSource(canonicalSource)
    if (onCancel) {
      onCancel()
      return
    }
    setNotice('已取消未应用的公式修改')
    queueMicrotask(() => inputRef.current?.focus())
  }

  const commitDraft = () => {
    if (parsed.error || !parsed.ast) {
      setNotice('请先修复输入错误，工程未变更')
      return
    }
    if (parsed.hasSlots) {
      setNotice(`请先补全公式中的“${FORMULA_SLOT}”占位符，工程未变更`)
      return
    }
    if (!dirty) {
      if (controlledDraftSource === undefined) setLocalDraftSource(canonicalSource)
      setNotice('公式内容没有变化')
      return
    }
    onCommit(
      parsed.ast,
      accessibilityAutomatic ? parsed.accessibleText : node.accessibleText,
    )
    setNotice(accessibilityAutomatic
      ? '公式已应用，无障碍描述已同步更新'
      : '公式已应用；请复核你的自定义无障碍描述')
  }

  const insertTemplate = (template: FormulaTemplate) => {
    const input = inputRef.current
    const selectionStart = input?.selectionStart ?? draftSource.length
    const selectionEnd = input?.selectionEnd ?? selectionStart
    const insertion = insertFormulaTemplate(
      draftSource,
      selectionStart,
      selectionEnd,
      template.value,
      template.selectedSlotIndex,
    )
    pendingSelectionRef.current = [
      insertion.selectionStart,
      insertion.selectionEnd,
    ]
    publishDraftSource(insertion.value)
    setNotice(null)
  }

  const selectNextSlot = () => {
    const input = inputRef.current
    if (!input) return
    const afterSelection = input.selectionEnd ?? 0
    let next = draftSource.indexOf(FORMULA_SLOT, afterSelection)
    if (next < 0) next = draftSource.indexOf(FORMULA_SLOT)
    if (next < 0) return
    input.setSelectionRange(next, next + FORMULA_SLOT.length)
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab' && draftSource.includes(FORMULA_SLOT)) {
      event.preventDefault()
      selectNextSlot()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      resetDraft()
      return
    }
    if (
      event.key === 'Enter' &&
      !event.nativeEvent.isComposing &&
      !composingRef.current
    ) {
      event.preventDefault()
      commitDraft()
    }
  }

  return (
    <div className="formula-authoring-editor" data-testid="formula-authoring-editor">
      <div className="form-field">
        <label htmlFor={`formula-linear-${node.id}`}>公式内容</label>
        <input
          ref={inputRef}
          id={`formula-linear-${node.id}`}
          className="form-input formula-linear-input"
          aria-label="公式内容（线性输入）"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          value={draftSource}
          onFocus={onBeginEdit}
          onChange={(event) => {
            publishDraftSource(event.currentTarget.value)
            setNotice(null)
          }}
          onCompositionStart={() => {
            composingRef.current = true
            onCompositionChange?.(true)
          }}
          onCompositionEnd={() => {
            composingRef.current = false
            onCompositionChange?.(false)
          }}
          onKeyDown={handleKeyDown}
        />
        <span className="property-hint">
          可直接输入 <code>x^2</code> 或 <code>a/b</code>；Enter 应用，Esc 取消，Tab 跳到下一个占位符。
        </span>
      </div>

      <div className="formula-template-group" aria-label="公式结构模板">
        <span>结构</span>
        <div className="formula-template-grid">
          {STRUCTURE_TEMPLATES.map((template) => (
            <button
              key={template.label}
              type="button"
              className="formula-template-button"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => insertTemplate(template)}
            >
              {template.label}
            </button>
          ))}
        </div>
      </div>

      <div className="formula-template-group" aria-label="常用数学符号">
        <span>符号</span>
        <div className="formula-symbol-grid">
          {SYMBOL_TEMPLATES.map((template) => (
            <button
              key={`${template.label}-${template.title ?? ''}`}
              type="button"
              className="formula-symbol-button"
              aria-label={template.title
                ? `插入${template.title} ${template.label}`
                : `插入符号 ${template.label}`}
              title={template.title}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => insertTemplate(template)}
            >
              {template.label}
            </button>
          ))}
        </div>
      </div>

      <FormulaDraftPreview node={node} draft={parsed} />

      {parsed.error ? (
        <p className="formula-authoring-message formula-authoring-message--error" role="alert">
          {parsed.error}
        </p>
      ) : parsed.hasSlots ? (
        <p className="formula-authoring-message formula-authoring-message--warning" role="status">
          请补全所有“{FORMULA_SLOT}”占位符后再应用。
        </p>
      ) : (
        <p className="formula-authoring-message" role="status">
          可读描述预览：{parsed.accessibleText}
        </p>
      )}

      <div className="button-row formula-authoring-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={draftSource === canonicalSource}
          onClick={resetDraft}
        >
          取消修改
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={!dirty || Boolean(parsed.error) || parsed.hasSlots}
          onClick={commitDraft}
        >
          应用公式
        </button>
      </div>
      {notice && (
        <p
          className={`formula-authoring-message${notice.includes('未变更') ? ' formula-authoring-message--error' : ''}`}
          role={notice.includes('未变更') ? 'alert' : 'status'}
        >
          {notice}
        </p>
      )}

      <details className="formula-linear-help">
        <summary>线性输入说明</summary>
        <p>
          支持分式、根式、上下标和括号。例如
          <code>{'\\sqrt[n]{x}'}</code>、<code>x_i^2</code>。本编辑器只接受当前 Project V8 可稳定保存和导出的子集。
        </p>
      </details>
    </div>
  )
}
