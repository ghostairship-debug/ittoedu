import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react'
import { registerAuthoringObservationDraft } from '../authoring/generation/authoringObservation'
import { componentClientMatrix } from '../../player/components/runtime/componentClientMatrix'
import { invertMatrix, transformVector } from '../../core/components/geometry'

export interface CanvasPlainTextBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface PlainTextSelectionIntent { anchor?: number; focus?: number; anchorPoint?: { x: number; y: number }; point?: { x: number; y: number }; word?: boolean }
export interface CanvasPlainTextEditorHandle { selectAll(): void; complete(): void }

/** Browser selection in the existing plain input; this never invokes authored events. */
function selectPlainText(element: HTMLElement, intent: PlainTextSelectionIntent, fallback: number, collapseAtPoint = false) {
  const doc = element.ownerDocument, text = element.textContent ?? '', clamp = (n: number) => Math.max(0, Math.min(text.length, n))
  const at = (offset: number): [Node, number] => {
    const walker = doc.createTreeWalker(element, 4); let node: Node | null, remaining = clamp(offset)
    while ((node = walker.nextNode())) { const length = node.textContent?.length ?? 0; if (remaining <= length) return [node, remaining]; remaining -= length }
    return [element, element.childNodes.length]
  }
  let anchor = clamp(intent.anchor ?? fallback), focus = clamp(intent.focus ?? anchor)
  const offsetAtPoint = (point: { x: number; y: number }) => {
    const document = doc as Document & { caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null; caretRangeFromPoint?(x: number, y: number): Range | null }
    const position = document.caretPositionFromPoint?.(point.x, point.y), range = position ? undefined : document.caretRangeFromPoint?.(point.x, point.y)
    const node = position?.offsetNode ?? range?.startContainer, offset = position?.offset ?? range?.startOffset
    if (node && offset !== undefined && element.contains(node)) { const prefix = doc.createRange(); prefix.selectNodeContents(element); prefix.setEnd(node, offset); return prefix.toString().length }
    return undefined
  }
  if (intent.anchorPoint) anchor = offsetAtPoint(intent.anchorPoint) ?? anchor
  if (intent.point) focus = offsetAtPoint(intent.point) ?? focus
  if (collapseAtPoint && !intent.anchorPoint) anchor = focus
  if (intent.word) {
    const segments = new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)
    for (const segment of segments) if (segment.isWordLike && anchor >= segment.index && anchor <= segment.index + segment.segment.length) { anchor = segment.index; focus = anchor + segment.segment.length; break }
  }
  const selection = doc.getSelection(), [a, ai] = at(anchor), [b, bi] = at(focus)
  selection?.setBaseAndExtent(a, ai, b, bi)
}

interface CanvasPlainTextEditorProps {
  bounds: CanvasPlainTextBounds
  label: string
  value: string
  multiline?: boolean
  maxLength?: number
  readOnly?: boolean
  rotation?: number
  /** UTF-16 offset in the input; opening without a pointer keeps a collapsed caret at the end. */
  initialCaret?: number
  initialPoint?: { x: number; y: number }
  selectionIntent?: PlainTextSelectionIntent
  presentation?: 'card' | 'inline'
  textStyle?: Record<string, string | undefined>
  escapeBehavior?: 'commit' | 'cancel'
  selectionIdentity?: string
  editorRef?: Ref<CanvasPlainTextEditorHandle>
  onDraftChange?(value: string, composing: boolean): void
  onCommit(value: string): void
  onAdvance?(value: string, direction: 1 | -1): void
  onCancel(): void
}

/**
 * A logical-canvas editor shared by Native, Component and Runtime text targets.
 * It lives inside the fixed 1280 x 720 StageViewport, so browser zoom, fit and
 * pan never need to be reimplemented here.
 */
export function CanvasPlainTextEditor({
  bounds,
  label,
  value,
  multiline = false,
  maxLength,
  readOnly = false,
  rotation = 0,
  initialCaret,
  initialPoint,
  selectionIntent,
  presentation = 'card',
  textStyle,
  escapeBehavior = 'commit',
  selectionIdentity,
  editorRef,
  onCommit,
  onAdvance,
  onCancel,
  onDraftChange,
}: CanvasPlainTextEditorProps) {
  const [localDraft, setDraft] = useState(value)
  const draft = onDraftChange ? value : localDraft
  const composingRef = useRef(false)
  const pendingFinishRef = useRef<boolean | null>(null)
  const controlRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const inlineRef = useRef<HTMLDivElement>(null), initialAnchor = useRef(initialCaret), handoff = useRef(true)
  const finishedRef = useRef(false)

  const finish = (cancel: boolean) => {
    if (composingRef.current) { pendingFinishRef.current = cancel; return }
    if (finishedRef.current) return
    finishedRef.current = true
    if (cancel) onCancel()
    else onCommit(draft)
  }
  const observationRef = useRef({ label, value: draft, initialValue: value, bounds })
  observationRef.current = { label, value: draft, initialValue: value, bounds }
  const finishRef = useRef(finish)
  finishRef.current = finish

  useImperativeHandle(editorRef, () => ({
    selectAll() {
      const inline = inlineRef.current, control = controlRef.current
      if (inline) { inline.focus({ preventScroll: true }); selectPlainText(inline, { anchor: 0, focus: inline.textContent?.length ?? 0 }, 0) }
      else if (control) { control.focus({ preventScroll: true }); control.setSelectionRange(0, control.value.length) }
    },
    complete() { finishRef.current(false) },
  }), [])

  // Font fields and palettes belong to this input. Their focus is not a document handoff.
  const toolbarTarget = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('.selection-quick-bar,.text-edit-toolbar,.palette-button__panel,.shared-document-form,.command-menu'))
  const afterBlur = (event: React.FocusEvent<HTMLElement>, inline = false) => {
    if (toolbarTarget(event.relatedTarget)) return
    const blurred = event.currentTarget
    queueMicrotask(() => {
      const active = blurred.ownerDocument.activeElement
      if (toolbarTarget(active) || active === inlineRef.current || active === controlRef.current) return
      if (!blurred.isConnected) { (inlineRef.current ?? controlRef.current)?.focus({ preventScroll: true }); return }
      if (inline) {
        if (finishedRef.current) return
        if (composingRef.current) pendingFinishRef.current = false
        else { finishedRef.current = true; onCommit(readInline()) }
      } else finishRef.current(false)
    })
  }

  // Inline input inserts literal newlines, keeping source whitespace as plain text.
  const readInline = () => inlineRef.current?.textContent ?? ''
  useLayoutEffect(() => {
    const element = inlineRef.current
    if (!element) return
    if (readInline() !== draft) element.textContent = draft
  }, [draft])
  useLayoutEffect(() => {
    const element = inlineRef.current, wrapper = element?.parentElement
    if (!element || !wrapper) return
    // Author bounds describe the source text's glyph range, not its CSS line
    // box. Reusing line-height would otherwise add its leading a second time.
    // Align the observed glyphs in presentation only; no drag geometry or
    // author source is created for a split run or an unmeasurable parent box.
    const matrix = componentClientMatrix(wrapper)
    if (!matrix) return
    const range = element.ownerDocument.createRange(); range.selectNodeContents(element)
    const glyph = range.getBoundingClientRect(), bounds = wrapper.getBoundingClientRect()
    if (!(glyph.width > 0 && glyph.height > 0)) return
    const delta = transformVector(invertMatrix(matrix), { x: bounds.left - glyph.left, y: bounds.top - glyph.top })
    element.style.position = 'relative'; element.style.left = `${delta.x}px`; element.style.top = `${delta.y}px`
  }, [])
  useLayoutEffect(() => {
    const element = inlineRef.current
    if (!element) return
    element.focus({ preventScroll: true })
    const offset = initialCaret ?? draft.length
    // The first down owns the anchor. A drag may already have delivered its
    // latest point before this input mounts; apply that later as the focus.
    selectPlainText(element, initialCaret !== undefined ? { anchor: initialCaret, focus: initialCaret }
      : initialPoint ? { point: initialPoint } : {}, offset, initialCaret === undefined && Boolean(initialPoint))
    const selection = element.ownerDocument.getSelection()
    if (selection?.anchorNode && element.contains(selection.anchorNode)) { const range = element.ownerDocument.createRange(); range.selectNodeContents(element); range.setEnd(selection.anchorNode, selection.anchorOffset); initialAnchor.current = range.toString().length }
  }, [])
  useLayoutEffect(() => {
    const element = inlineRef.current
    if (element && selectionIntent) selectPlainText(element, selectionIntent, initialAnchor.current ?? initialCaret ?? 0)
  }, [selectionIntent])
  useEffect(() => {
    const element = inlineRef.current
    if (!element) return
    const doc = element.ownerDocument
    const move = (event: PointerEvent) => { if (handoff.current && event.buttons === 1) selectPlainText(element, { point: { x: event.clientX, y: event.clientY } }, initialAnchor.current ?? 0) }
    const up = () => { handoff.current = false }
    doc.addEventListener('pointermove', move, true); doc.addEventListener('pointerup', up, true)
    return () => { doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerup', up, true) }
  }, [])

  useEffect(() => {
    const control = controlRef.current
    if (!control || onDraftChange) return
    return registerAuthoringObservationDraft(control, {
      read: () => ({ ...observationRef.current, composing: composingRef.current }),
      commit: () => finishRef.current(false),
    })
  }, [onDraftChange])

  useEffect(() => {
    const control = controlRef.current
    if (!control) return
    const timer = window.setTimeout(() => {
      if (!control.isConnected || finishedRef.current) return
      control.focus({ preventScroll: true })
      const offset = Math.max(0, Math.min(control.value.length, initialCaret ?? control.value.length))
      control.setSelectionRange(offset, offset)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  const common = {
    className: 'canvas-plain-text-editor__control',
    'aria-label': label,
    value: draft,
    maxLength,
    readOnly,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      finishedRef.current = false
      if (onDraftChange) onDraftChange(event.currentTarget.value, composingRef.current)
      else setDraft(event.currentTarget.value)
    },
    onCompositionStart: () => {
      composingRef.current = true
      onDraftChange?.(draft, true)
    },
    onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      composingRef.current = false
      const text = event.currentTarget.value
      if (onDraftChange) onDraftChange(text, false)
      else setDraft(text)
      const pending = pendingFinishRef.current
      pendingFinishRef.current = null
      if (pending !== null && !finishedRef.current) {
        finishedRef.current = true
        if (pending) onCancel()
        else onCommit(text)
      }
    },
    onBlur: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => afterBlur(event),
    onKeyDown: (
      event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (event.nativeEvent.isComposing || composingRef.current) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        finish(false)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        finish(escapeBehavior === 'cancel')
      } else if ((event.key === 'Tab' || event.key === 'Enter') && onAdvance) {
        event.preventDefault()
        if (finishedRef.current) return
        finishedRef.current = true
        onAdvance(draft, event.shiftKey ? -1 : 1)
      } else if (
        event.key === 'Enter' &&
        (!multiline || event.ctrlKey || event.metaKey)
      ) {
        event.preventDefault()
        finish(false)
      }
    },
  }

  if (presentation === 'inline') {
    const inlineStyle = Object.fromEntries(Object.entries(textStyle ?? {}).filter(([, value]) => value !== undefined).map(([key, value]) => [key.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase()), value])) as CSSProperties
    const change = () => { finishedRef.current = false; const text = readInline(); if (onDraftChange) onDraftChange(text, composingRef.current); else setDraft(text) }
    return <div className="canvas-plain-text-editor canvas-plain-text-editor--inline" data-testid="canvas-plain-text-editor" data-author-field-identity={selectionIdentity}
      style={{ left: bounds.x, top: bounds.y, width: Math.max(1, bounds.width), minHeight: Math.max(1, bounds.height), transform: `rotate(${rotation}deg)` }}>
      <div ref={inlineRef} className="canvas-plain-text-editor__inline" contentEditable={!readOnly} suppressContentEditableWarning role="textbox" aria-label={label} aria-multiline={multiline}
        style={inlineStyle} onInput={change} onPointerDown={event => { handoff.current = false; event.stopPropagation() }} onDoubleClick={event => event.stopPropagation()}
        onPaste={event => { event.preventDefault(); elementInsert(event.clipboardData.getData('text/plain')); change() }}
        onCompositionStart={() => { composingRef.current = true; onDraftChange?.(readInline(), true) }}
        onCompositionEnd={() => { composingRef.current = false; change(); const pending = pendingFinishRef.current; pendingFinishRef.current = null; if (pending !== null && !finishedRef.current) { finishedRef.current = true; if (pending) onCancel(); else onCommit(readInline()) } }}
        onBlur={event => afterBlur(event, true)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || composingRef.current) return
          const command = event.ctrlKey || event.metaKey
          if (command && ['b', 'i', 'u'].includes(event.key.toLowerCase())) { event.preventDefault(); return }
          if (event.key === 'Escape' || event.key === 'Enter' && (command || !multiline)) {
            event.preventDefault(); event.stopPropagation()
            finishedRef.current = true
            if (event.key === 'Escape' && escapeBehavior === 'cancel') onCancel(); else onCommit(readInline())
          } else if (event.key === 'Enter') { event.preventDefault(); elementInsert('\n'); change() }
        }} />
    </div>
    function elementInsert(text: string) {
      const element = inlineRef.current, selection = element?.ownerDocument.getSelection()
      if (!element || !selection?.rangeCount) return
      const range = selection.getRangeAt(0)
      if (!element.contains(range.commonAncestorContainer)) return
      range.deleteContents(); const node = element.ownerDocument.createTextNode(text); range.insertNode(node)
      range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range)
    }
  }
  return (
    <div
      className="canvas-plain-text-editor"
      data-testid="canvas-plain-text-editor"
      data-author-field-identity={selectionIdentity}
      style={{
        left: bounds.x,
        top: bounds.y,
        width: Math.max(96, bounds.width),
        minHeight: Math.max(multiline ? 64 : 34, bounds.height),
        transform: `rotate(${rotation}deg)`,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span className="canvas-plain-text-editor__label">{label}</span>
      {multiline ? (
        <textarea
          {...common}
          ref={controlRef as React.Ref<HTMLTextAreaElement>}
          rows={Math.max(2, Math.round(bounds.height / 24))}
        />
      ) : (
        <input
          {...common}
          ref={controlRef as React.Ref<HTMLInputElement>}
          type="text"
        />
      )}
      <span className="canvas-plain-text-editor__hint">
        {onAdvance ? 'Tab / Enter 下一格' : multiline ? 'Ctrl+Enter 完成' : 'Enter 完成'} · Esc {escapeBehavior === 'cancel' ? '取消' : '完成'}
      </span>
    </div>
  )
}
