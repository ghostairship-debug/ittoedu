import { Bold, Eraser, Highlighter, Italic, Strikethrough, Underline } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import type { TextNode, TextRun, TextRunStyle } from '../../shared/projectTypes'
import {
  applyTextRunStyle,
  toggleTextRunBoolean,
  toggleTextRunEmphasis,
} from '../../shared/textRuns'

interface TextEditOverlayProps {
  node: TextNode
  workspace: HTMLElement
  canvas: HTMLElement
  onPreview(text: string, runs: TextRun[]): void
  onCommit(text: string, runs: TextRun[]): void
  onCancel(): void
  onCompositionChange?(composing: boolean): void
}

interface OverlayMetrics {
  left: number
  top: number
  width: number
  height: number
  fontSize: number
  lineHeight: number
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}

function styleAt(node: TextNode, index: number): TextRunStyle {
  const style: TextRunStyle = {}
  for (const run of node.runs) {
    if (index >= run.start && index < run.end) Object.assign(style, run.style)
  }
  return style
}

export function buildInitialRichTextHtml(node: TextNode): string {
  return Array.from(node.text).map((character, index) => {
    if (character === '\n') return '<br>'
    const style = styleAt(node, index)
    const effectiveUnderline = style.underline ?? node.style.underline
    const effectiveStrike = style.strike ?? node.style.strike
    const decorationOverride =
      effectiveUnderline !== node.style.underline ||
      effectiveStrike !== node.style.strike
    const decorations = [
      effectiveUnderline ? 'underline' : '',
      effectiveStrike ? 'line-through' : '',
    ].filter(Boolean).join(' ')
    const highlightColor = style.highlightColor === undefined
      ? node.style.highlightColor
      : style.highlightColor
    const effectiveEmphasis = style.emphasis ?? node.style.emphasis
    const effectiveBold = style.bold ?? node.style.bold
    const css = [
      style.color !== undefined ? `color:${style.color}` : '',
      `font-weight:${effectiveBold ? '700' : '400'}`,
      style.italic !== undefined ? `font-style:${style.italic ? 'italic' : 'normal'}` : '',
      decorationOverride ? 'display:inline-block' : '',
      decorationOverride ? `text-decoration-line:${decorations || 'none'}` : '',
      highlightColor ? `background-color:${highlightColor}` : '',
      highlightColor === null && node.style.highlightColor
        ? 'background-color:transparent'
        : '',
      style.emphasis !== undefined
        ? `text-emphasis-style:${effectiveEmphasis ? 'filled circle' : 'none'}`
        : '',
      style.emphasis !== undefined
        ? `-webkit-text-emphasis-style:${effectiveEmphasis ? 'filled circle' : 'none'}`
        : '',
      style.emphasis !== undefined ? 'text-emphasis-position:under right' : '',
      style.emphasis !== undefined ? '-webkit-text-emphasis-position:under right' : '',
    ].filter(Boolean).join(';')
    return css ? `<span style="${css}">${escapeHtml(character)}</span>` : escapeHtml(character)
  }).join('')
}

function rgbToHex(value: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase()
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i)
  if (!match) return null
  return `#${[match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, '0')).join('')}`
}

function authoredBackgroundColor(element: HTMLElement, root: HTMLElement): string | null {
  let current: HTMLElement | null = element
  while (current && current !== root) {
    if (current.style.backgroundColor) return getComputedStyle(current).backgroundColor
    current = current.parentElement
  }
  return null
}

function isTransparentColor(value: string): boolean {
  if (value === 'transparent') return true
  const match = value.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/i)
  return Boolean(match && Number(match[1]) === 0)
}

interface StyledCharacter {
  value: string
  style: TextRunStyle
}

function extractEditor(root: HTMLElement, node: TextNode): { text: string; runs: TextRun[] } {
  const characters: StyledCharacter[] = []
  const visit = (current: Node) => {
    if (current.nodeType === Node.TEXT_NODE) {
      const parent = current.parentElement ?? root
      const computed = getComputedStyle(parent)
      const color = rgbToHex(computed.color)
      const authoredBackground = authoredBackgroundColor(parent, root)
      const background = authoredBackground ? rgbToHex(authoredBackground) : null
      const decoration = computed.textDecorationLine
      const emphasisStyle = computed.getPropertyValue('text-emphasis-style') ||
        computed.getPropertyValue('-webkit-text-emphasis-style')
      const emphasis = emphasisStyle !== '' && emphasisStyle !== 'none'
      const style: TextRunStyle = {
        ...(color && color !== node.style.color.toLowerCase() ? { color } : {}),
        ...(Number.parseInt(computed.fontWeight, 10) >= 600 !== node.style.bold ? { bold: Number.parseInt(computed.fontWeight, 10) >= 600 } : {}),
        ...((computed.fontStyle === 'italic') !== node.style.italic ? { italic: computed.fontStyle === 'italic' } : {}),
        ...(decoration.includes('underline') !== node.style.underline ? { underline: decoration.includes('underline') } : {}),
        ...(decoration.includes('line-through') !== node.style.strike ? { strike: decoration.includes('line-through') } : {}),
        ...(emphasis !== node.style.emphasis ? { emphasis } : {}),
        ...(authoredBackground && isTransparentColor(authoredBackground) && node.style.highlightColor
          ? { highlightColor: null }
          : background && background !== node.style.highlightColor
            ? { highlightColor: background }
            : {}),
      }
      for (const value of Array.from(current.textContent ?? '')) characters.push({ value, style })
      return
    }
    if (current instanceof HTMLBRElement) {
      characters.push({ value: '\n', style: {} })
      return
    }
    const block = current instanceof HTMLElement && ['DIV', 'P'].includes(current.tagName)
    if (block && characters.length > 0 && characters.at(-1)?.value !== '\n') {
      characters.push({ value: '\n', style: {} })
    }
    current.childNodes.forEach(visit)
  }
  root.childNodes.forEach(visit)
  while (characters.at(-1)?.value === '\n') characters.pop()
  const text = characters.map((character) => character.value).join('')
  const runs: TextRun[] = []
  let start = 0
  while (start < characters.length) {
    const serialized = JSON.stringify(characters[start].style)
    let end = start + 1
    while (end < characters.length && JSON.stringify(characters[end].style) === serialized) end += 1
    if (Object.keys(characters[start].style).length > 0) {
      runs.push({ start, end, style: characters[start].style })
    }
    start = end
  }
  return { text, runs }
}

function logicalText(root: Node): string {
  const characters: string[] = []
  const visit = (current: Node): void => {
    if (current.nodeType === Node.TEXT_NODE) {
      characters.push(...Array.from(current.textContent ?? ''))
      return
    }
    if (current instanceof HTMLBRElement) {
      characters.push('\n')
      return
    }
    const block = current instanceof HTMLElement && ['DIV', 'P'].includes(current.tagName)
    if (block && characters.length > 0 && characters.at(-1) !== '\n') {
      characters.push('\n')
    }
    current.childNodes.forEach(visit)
  }
  root.childNodes.forEach(visit)
  while (characters.at(-1) === '\n') characters.pop()
  return characters.join('')
}

function logicalSelectionOffsets(
  root: HTMLElement,
): { start: number; end: number } | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (
    !(range.startContainer === root || root.contains(range.startContainer)) ||
    !(range.endContainer === root || root.contains(range.endContainer))
  ) {
    return null
  }
  const offsetTo = (container: Node, offset: number): number => {
    const prefix = document.createRange()
    prefix.selectNodeContents(root)
    prefix.setEnd(container, offset)
    const holder = document.createElement('div')
    holder.append(prefix.cloneContents())
    return Array.from(logicalText(holder)).length
  }
  const start = offsetTo(range.startContainer, range.startOffset)
  const end = offsetTo(range.endContainer, range.endOffset)
  return start <= end ? { start, end } : { start: end, end: start }
}

interface DomPoint {
  node: Node
  offset: number
}

function domPointAtLogicalOffset(root: HTMLElement, target: number): DomPoint {
  let remaining = Math.max(0, target)
  const visit = (current: Node): DomPoint | null => {
    if (current.nodeType === Node.TEXT_NODE) {
      const values = Array.from(current.textContent ?? '')
      if (remaining <= values.length) {
        return {
          node: current,
          offset: values.slice(0, remaining).join('').length,
        }
      }
      remaining -= values.length
      return null
    }
    if (current instanceof HTMLBRElement) {
      const parent = current.parentNode
      if (!parent) return null
      const index = Array.prototype.indexOf.call(parent.childNodes, current) as number
      if (remaining === 0) return { node: parent, offset: index }
      remaining -= 1
      if (remaining === 0) return { node: parent, offset: index + 1 }
      return null
    }
    for (const child of Array.from(current.childNodes)) {
      const point = visit(child)
      if (point) return point
    }
    return null
  }
  return visit(root) ?? { node: root, offset: root.childNodes.length }
}

function restoreLogicalSelection(
  root: HTMLElement,
  start: number,
  end: number,
): void {
  const range = document.createRange()
  const startPoint = domPointAtLogicalOffset(root, start)
  const endPoint = domPointAtLogicalOffset(root, end)
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

export function TextEditOverlay({
  node,
  workspace,
  canvas,
  onPreview,
  onCommit,
  onCancel,
  onCompositionChange,
}: TextEditOverlayProps) {
  const [metrics, setMetrics] = useState<OverlayMetrics | null>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const initialNodeRef = useRef(node)
  const nodeRef = useRef(node)
  const initializedRef = useRef(false)
  const composingRef = useRef(false)
  const pendingBlurRef = useRef(false)
  const finishedRef = useRef(false)
  const blurReadyRef = useRef(false)
  const focusTimerRef = useRef<number | null>(null)
  const finishTimerRef = useRef<number | null>(null)
  const toolbarSelectionRef = useRef<{ start: number; end: number } | null>(null)
  const lastIssuedRunsRef = useRef<TextRun[]>(initialNodeRef.current.runs)
  nodeRef.current = node

  const read = () => editorRef.current
    ? extractEditor(editorRef.current, nodeRef.current)
    : { text: nodeRef.current.text, runs: nodeRef.current.runs }
  const publish = (text: string, runs: TextRun[]) => {
    lastIssuedRunsRef.current = runs
    onPreview(text, runs)
  }
  const finish = (cancel: boolean) => {
    if (finishedRef.current) return
    finishedRef.current = true
    if (cancel) onCancel()
    else {
      const value = read()
      onCommit(value.text, lastIssuedRunsRef.current)
    }
  }
  const scheduleBlurFinish = () => {
    if (finishTimerRef.current !== null) {
      window.clearTimeout(finishTimerRef.current)
    }
    finishTimerRef.current = window.setTimeout(() => {
      finishTimerRef.current = null
      const active = document.activeElement
      if (
        active instanceof HTMLIFrameElement &&
        active.classList.contains('runtime-preview-frame')
      ) {
        const editor = editorRef.current
        if (editor?.isConnected) {
          editor.focus({ preventScroll: true })
          blurReadyRef.current = true
        }
        return
      }
      if (
        active instanceof HTMLElement &&
        active.closest('.canvas-stage, .canvas-stage-stack, .runtime-preview-frame')
      ) {
        const editor = editorRef.current
        if (editor?.isConnected) {
          editor.focus({ preventScroll: true })
          blurReadyRef.current = true
        }
        return
      }
      finish(false)
    }, 0)
  }

  useLayoutEffect(() => {
    const update = () => {
      const canvasRect = canvas.getBoundingClientRect()
      const workspaceRect = workspace.getBoundingClientRect()
      const scaleX = canvasRect.width / 1280
      const scaleY = canvasRect.height / 720
      const fontSize = node.style.fontSize * scaleY
      const next = {
        left: canvasRect.left - workspaceRect.left + node.x * scaleX,
        top: canvasRect.top - workspaceRect.top + node.y * scaleY,
        width: Math.max(16, node.width * scaleX),
        height: Math.max(16, node.height * scaleY),
        fontSize,
        lineHeight: fontSize * 1.22 + node.style.lineSpacing * scaleY,
      }
      setMetrics((current) => current &&
          current.left === next.left &&
          current.top === next.top &&
          current.width === next.width &&
          current.height === next.height &&
          current.fontSize === next.fontSize &&
          current.lineHeight === next.lineHeight
        ? current
        : next)
    }
    update()
    // CSS transforms do not resize an element's content box, so neither
    // ResizeObserver nor window.resize fires while the Stage zooms or pans.
    // Track only this short-lived editing transaction and skip React updates
    // once the visual geometry is stable.
    let animationFrame = 0
    const trackVisualGeometry = () => {
      update()
      animationFrame = window.requestAnimationFrame(trackVisualGeometry)
    }
    animationFrame = window.requestAnimationFrame(trackVisualGeometry)
    const observer = new ResizeObserver(update)
    observer.observe(canvas)
    observer.observe(workspace)
    window.addEventListener('resize', update)
    return () => {
      window.cancelAnimationFrame(animationFrame)
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [
    canvas,
    node.height,
    node.style.fontSize,
    node.style.lineSpacing,
    node.width,
    node.x,
    node.y,
    workspace,
  ])

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (!editor || !metrics || initializedRef.current) return
    initializedRef.current = true
    editor.innerHTML = buildInitialRichTextHtml(initialNodeRef.current)
    // Run focus in the next browser task. A canvas double click is reported
    // by Phaser from inside a native pointer event; focusing synchronously in
    // that event is undone by the event's remaining default focus action.
    focusTimerRef.current = window.setTimeout(() => {
      focusTimerRef.current = null
      if (finishedRef.current || !editor.isConnected) return
      editor.focus({ preventScroll: true })
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(editor)
      selection?.removeAllRanges()
      selection?.addRange(range)
      blurReadyRef.current = true
    }, 0)
  }, [metrics])

  useLayoutEffect(() => () => {
    if (focusTimerRef.current !== null) {
      window.clearTimeout(focusTimerRef.current)
    }
    if (finishTimerRef.current !== null) {
      window.clearTimeout(finishTimerRef.current)
    }
  }, [])

  if (!metrics) return null
  const captureToolbarSelection = () => {
    if (toolbarSelectionRef.current) return
    const editor = editorRef.current
    if (!editor) return
    toolbarSelectionRef.current = logicalSelectionOffsets(editor)
  }
  const takeToolbarSelection = (editor: HTMLElement) => {
    const offsets = toolbarSelectionRef.current ?? logicalSelectionOffsets(editor)
    toolbarSelectionRef.current = null
    return offsets
  }
  const rewriteSelection = (
    editor: HTMLElement,
    offsets: { start: number; end: number },
    text: string,
    runs: TextRun[],
  ) => {
    editor.innerHTML = buildInitialRichTextHtml({
      ...nodeRef.current,
      text,
      runs,
    })
    restoreLogicalSelection(editor, offsets.start, offsets.end)
    publish(text, runs)
  }
  const command = (name: string, value?: string) => {
    const editor = editorRef.current
    if (!editor) return
    const offsets = takeToolbarSelection(editor)
    editor.focus({ preventScroll: true })
    if (offsets) restoreLogicalSelection(editor, offsets.start, offsets.end)
    const booleanKey = name === 'bold'
      ? 'bold'
      : name === 'italic'
        ? 'italic'
        : name === 'underline'
          ? 'underline'
          : name === 'strikeThrough'
            ? 'strike'
            : null
    if (booleanKey) {
      if (!offsets || offsets.end <= offsets.start) return
      const current = extractEditor(editor, nodeRef.current)
      const runs = toggleTextRunBoolean(
        current.text,
        current.runs,
        offsets.start,
        offsets.end,
        booleanKey,
        nodeRef.current.style[booleanKey],
      )
      rewriteSelection(editor, offsets, current.text, runs)
      return
    }
    if (name === 'hiliteColor' || name === 'foreColor') {
      if (!offsets || offsets.end <= offsets.start || value === undefined) return
      const current = extractEditor(editor, nodeRef.current)
      const patch = name === 'foreColor'
        ? { color: value }
        : {
            highlightColor: value === 'transparent' || value === '' ? null : value,
          }
      const runs = applyTextRunStyle(
        current.text,
        current.runs,
        offsets.start,
        offsets.end,
        patch,
      )
      rewriteSelection(editor, offsets, current.text, runs)
      return
    }
    document.execCommand(name, false, value)
    const result = read()
    publish(result.text, result.runs)
  }
  const toggleSelectionEmphasis = () => {
    const editor = editorRef.current
    if (!editor) return
    const offsets = takeToolbarSelection(editor)
    if (!offsets || offsets.end <= offsets.start) return
    const value = extractEditor(editor, nodeRef.current)
    const runs = toggleTextRunEmphasis(
      value.text,
      value.runs,
      offsets.start,
      offsets.end,
      nodeRef.current.style.emphasis,
    )
    rewriteSelection(editor, offsets, value.text, runs)
  }

  return (
    <>
      <div
        className="text-edit-toolbar"
        style={{ left: metrics.left, top: Math.max(4, metrics.top - 40) }}
        onPointerDownCapture={captureToolbarSelection}
        onMouseDown={(event) => {
          captureToolbarSelection()
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        <button type="button" title="局部加粗" aria-label="局部加粗" onClick={() => command('bold')}><Bold size={14} /></button>
        <button type="button" title="局部斜体" aria-label="局部斜体" onClick={() => command('italic')}><Italic size={14} /></button>
        <button type="button" title="局部下划线" aria-label="局部下划线" onClick={() => command('underline')}><Underline size={14} /></button>
        <button type="button" title="局部删除线" aria-label="局部删除线" onClick={() => command('strikeThrough')}><Strikethrough size={14} /></button>
        <button type="button" title="局部着重号" aria-label="局部着重号" onClick={toggleSelectionEmphasis}><span aria-hidden="true">•</span></button>
        <button type="button" title="局部高亮" aria-label="局部高亮" onClick={() => command('hiliteColor', '#fff3a3')}><Highlighter size={14} /></button>
        <button type="button" title="取消局部高亮" aria-label="取消局部高亮" onClick={() => command('hiliteColor', 'transparent')}><Highlighter size={14} opacity={0.45} /></button>
        <button type="button" title="清除局部格式" aria-label="清除局部格式" onClick={() => command('removeFormat')}><Eraser size={14} /></button>
        <label title="局部文字颜色"><input type="color" aria-label="局部文字颜色" defaultValue={node.style.color} onChange={(event) => command('foreColor', event.target.value)} /></label>
      </div>
      <div
        ref={editorRef}
        className="text-edit-overlay"
        aria-label="编辑文本"
        data-testid="text-edit-overlay"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        style={{
          left: metrics.left,
          top: metrics.top,
          width: metrics.width,
          minHeight: metrics.height,
          maxHeight:
            node.style.overflow === 'auto-height' &&
            node.style.writingMode === 'horizontal'
              ? undefined
              : metrics.height,
          padding: node.style.padding * (metrics.width / node.width),
          fontFamily: node.style.fontFamily,
          fontSize: metrics.fontSize,
          fontWeight: 400,
          fontStyle: node.style.italic ? 'italic' : 'normal',
          textDecoration: `${node.style.underline ? 'underline ' : ''}${node.style.strike ? 'line-through' : ''}`.trim(),
          textEmphasisStyle: node.style.emphasis ? 'filled circle' : 'none',
          textEmphasisPosition: 'under right',
          WebkitTextEmphasisStyle: node.style.emphasis ? 'filled circle' : 'none',
          WebkitTextEmphasisPosition: 'under right',
          lineHeight: `${metrics.lineHeight}px`,
          letterSpacing: node.style.letterSpacing * (metrics.width / node.width),
          color: node.style.color,
          textAlign: node.style.align,
          writingMode: node.style.writingMode === 'horizontal'
            ? 'horizontal-tb'
            : node.style.writingMode,
          textOrientation: node.style.writingMode === 'horizontal'
            ? undefined
            : 'upright',
          transform: `rotate(${node.rotation}deg)`,
          transformOrigin: 'center center',
        }}
        onInput={() => {
          const value = read()
          publish(value.text, value.runs)
        }}
        onCompositionStart={() => {
          composingRef.current = true
          pendingBlurRef.current = false
          onCompositionChange?.(true)
        }}
        onCompositionEnd={() => {
          composingRef.current = false
          onCompositionChange?.(false)
          const value = read()
          publish(value.text, value.runs)
          if (pendingBlurRef.current) {
            pendingBlurRef.current = false
            scheduleBlurFinish()
          }
        }}
        onBlur={(event) => {
          if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest('.text-edit-toolbar')) return
          if (composingRef.current) {
            pendingBlurRef.current = true
            return
          }
          // Ignore focus churn from the pointer sequence that opened this
          // editor. The deferred focus above arms real blur commits.
          if (!blurReadyRef.current) return
          scheduleBlurFinish()
        }}
        onKeyDown={(event) => {
          if (composingRef.current || event.nativeEvent.isComposing) return
          if (event.key === 'Escape') {
            event.preventDefault()
            finish(true)
          } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            finish(false)
          }
        }}
      />
    </>
  )
}
