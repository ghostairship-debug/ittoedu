import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FORMULA_SLOT, insertFormulaTemplate } from '../../shared/formulaLinear'
import { describeDocumentMath, parseDocumentMath } from '../../shared/document/math'
import { renderDocumentMath } from '../../shared/document/render'
import 'katex/dist/katex.min.css'

export interface LatexFormulaDraftChange {
  source: string
  accessibleText: string
  error: string | null
  committable: boolean
}

export interface LatexFormulaAuthoringEditorProps {
  id: string
  latex: string
  accessibleText?: string
  draftSource?: string
  autoFocus?: boolean
  onCommit(latex: string, accessibleText: string): void
  onCancel?(): void
  onDraftChange?(draft: LatexFormulaDraftChange): void
  onCompositionChange?(composing: boolean): void
  onBeginEdit?(): void
  onFinishReady?(finish: () => void): void
}

const templates = [
  ['分式', `\\frac{${FORMULA_SLOT}}{${FORMULA_SLOT}}`],
  ['平方根', `\\sqrt{${FORMULA_SLOT}}`],
  ['n 次根', `\\sqrt[${FORMULA_SLOT}]{${FORMULA_SLOT}}`],
  ['上标', `{${FORMULA_SLOT}}^{${FORMULA_SLOT}}`],
  ['下标', `{${FORMULA_SLOT}}_{${FORMULA_SLOT}}`],
  ['圆括号', `(${FORMULA_SLOT})`],
] as const

function parseDraft(source: string) {
  try {
    const math = parseDocumentMath(source)
    return { accessibleText: describeDocumentMath(math), html: renderDocumentMath(source.replaceAll(FORMULA_SLOT, '\\square'), true), error: null }
  } catch (error) {
    return { accessibleText: '', html: '', error: error instanceof Error ? error.message : String(error) }
  }
}

export function LatexFormulaAuthoringEditor(props: LatexFormulaAuthoringEditorProps) {
  const [localSource, setLocalSource] = useState(props.latex)
  const source = props.draftSource ?? localSource
  const parsed = useMemo(() => parseDraft(source), [source])
  const input = useRef<HTMLInputElement>(null)
  const selection = useRef<[number, number] | null>(null)
  const composing = useRef(false)
  const finish = useRef(false)
  const canonicalDescription = useMemo(() => parseDraft(props.latex).accessibleText, [props.latex])
  const automatic = !props.accessibleText || props.accessibleText.replace(/\s/g, '') === canonicalDescription.replace(/\s/g, '')
  const hasSlots = source.includes(FORMULA_SLOT)
  const commitRef = useRef<() => void>(() => {})
  useEffect(() => { if (props.draftSource === undefined) setLocalSource(props.latex) }, [props.id, props.latex, props.draftSource])
  useEffect(() => {
    if (props.autoFocus) { input.current?.focus(); input.current?.select() }
  }, [props.id, props.autoFocus])
  useLayoutEffect(() => {
    if (!selection.current) return
    input.current?.focus()
    input.current?.setSelectionRange(...selection.current)
    selection.current = null
  }, [source])
  const publish = (value: string) => {
    if (props.draftSource === undefined) setLocalSource(value)
    const next = parseDraft(value)
    props.onDraftChange?.({ source: value, accessibleText: automatic ? next.accessibleText : props.accessibleText!, error: next.error, committable: !next.error && !value.includes(FORMULA_SLOT) && !composing.current })
  }
  const commit = () => {
    if (composing.current) { finish.current = true; return }
    const value = input.current?.value ?? source
    const next = parseDraft(value)
    if (next.error || value.includes(FORMULA_SLOT)) return
    props.onCommit(value, automatic ? next.accessibleText : props.accessibleText!)
  }
  commitRef.current = commit
  useLayoutEffect(() => { props.onFinishReady?.(() => commitRef.current()) })
  return <div className="formula-authoring-editor" data-testid="latex-formula-authoring-editor">
    <div className="formula-template-group" aria-label="公式结构模板">
      <div className="formula-template-grid">{templates.map(([label, value]) => <button key={label} type="button" className="formula-template-button"
        onPointerDown={event => event.preventDefault()} onClick={() => {
          const inserted = insertFormulaTemplate(source, input.current?.selectionStart ?? source.length, input.current?.selectionEnd ?? source.length, value)
          selection.current = [inserted.selectionStart, inserted.selectionEnd]
          publish(inserted.value)
        }}>{label}</button>)}</div>
    </div>
    <div className="form-field"><label htmlFor={`formula-latex-${props.id}`}>LaTeX</label><input ref={input} id={`formula-latex-${props.id}`} className="form-input formula-linear-input" aria-label="公式 LaTeX"
      value={source} spellCheck={false} onFocus={props.onBeginEdit} onChange={event => publish(event.currentTarget.value)}
      onCompositionStart={() => { composing.current = true; props.onCompositionChange?.(true) }}
      onCompositionEnd={event => { composing.current = false; publish(event.currentTarget.value); props.onCompositionChange?.(false); if (finish.current) { finish.current = false; queueMicrotask(() => commitRef.current()) } }}
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing) return
        if (event.key === 'Tab' && hasSlots) {
          const after = input.current?.selectionEnd ?? 0
          const next = source.indexOf(FORMULA_SLOT, after)
          const at = next < 0 ? source.indexOf(FORMULA_SLOT) : next
          if (at >= 0) { event.preventDefault(); input.current?.setSelectionRange(at, at + FORMULA_SLOT.length) }
        }
        if (event.key === 'Enter') { event.preventDefault(); commit() }
        if (event.key === 'Escape') { event.preventDefault(); props.onCancel?.() }
      }} /></div>
    <div className="formula-authoring-preview__surface" data-testid="formula-preview" role="img" aria-label={`公式预览：${parsed.accessibleText}`} dangerouslySetInnerHTML={{ __html: parsed.html }} />
    {parsed.error ? <p role="alert" className="formula-authoring-message formula-authoring-message--error">{parsed.error}</p>
      : hasSlots ? <p role="status" className="formula-authoring-message">请补全公式占位符</p> : null}
    <div className="button-row formula-authoring-actions"><button type="button" onClick={props.onCancel}>取消</button><button type="button" className="primary-button" disabled={Boolean(parsed.error) || hasSlots} onClick={commit}>应用公式</button></div>
  </div>
}
