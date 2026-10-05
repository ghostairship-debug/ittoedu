import { useEffect, useRef } from 'react'
import { isEditorTextInputEvent } from '../course/editorActionRouting'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import { createImageAssetImport, readImageDimensions } from '../project/assetManager'
import { captureCourseInsertionTarget, insertCourseElement, insertCourseMedia,
  type CourseInsertionOptions, type ImportedAssetBatchItem } from '../media/commitCourseMediaAuthoring'

export type CanvasClipboardPayload = { kind: 'text'; text: string } | { kind: 'images'; files: File[] }

/** ClipboardEvent supplies the current OS contents during the user's paste gesture. */
export function readCanvasClipboardPayload(data: DataTransfer | null): CanvasClipboardPayload | null {
  if (!data) return null
  const files = Array.from(data.items ?? []).filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .flatMap(item => { const file = item.getAsFile(); return file ? [file] : [] })
  if (!files.length) files.push(...Array.from(data.files ?? []).filter(file => file.type.startsWith('image/')))
  if (files.length) return { kind: 'images', files }
  const text = data.getData('text/plain')
  return text.length ? { kind: 'text', text } : null
}

export interface CourseCanvasPastePorts {
  kernel: EditorStoreKernel
  isReadOnly(): boolean
  /** Runtime/source editors and an active IME draft retain their own paste. */
  ownsPaste(event: ClipboardEvent): boolean
  capturePlacement?(target: CapturedCourseTarget): CourseInsertionOptions
  /** The shared clipboard owner resolves its system marker; ordinary OS contents are external. */
  pasteInternalClipboard?(event: ClipboardEvent): boolean
  copyInternalClipboard?(event: ClipboardEvent, cut: boolean): boolean
  reportError(message: string): void
  commitStatus(message: string): void
}

async function prepareImages(files: File[]): Promise<{ items: ImportedAssetBatchItem[]; issues: string[] }> {
  const items: ImportedAssetBatchItem[] = [], issues: string[] = []
  for (const file of files) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const name = file.name || '粘贴图片.png'
      const item = createImageAssetImport({ name, mimeType: file.type, bytes }, { dimensions: await readImageDimensions(bytes, file.type) })
      items.push({ ...item, meta: { ...item.meta, source: { kind: 'user-material', title: name } } })
    } catch (error) { issues.push(`${file.name || '粘贴图片'}：${error instanceof Error ? error.message : String(error)}`) }
  }
  return { items, issues }
}

/** One captured target, one canonical insertion batch. No whole-page replacement. */
export async function pasteCanvasPayload(ports: CourseCanvasPastePorts, target: CapturedCourseTarget,
  placement: CourseInsertionOptions, payload: CanvasClipboardPayload): Promise<void> {
  // Selection ACK may update only the current source document/epoch/surface. Decoding an image must
  // not move a user who has navigated or changed selection in the meantime.
  const kernel: EditorStoreKernel = { ...ports.kernel, selectInstances: (ids, surfaceId, documentId) => {
    const current = ports.kernel.readView()
    if (current.activeDocumentId === target.documentId && current.snapshot?.epoch === target.epoch && current.surfaceId === target.surfaceId) {
      ports.kernel.selectInstances(ids, surfaceId, documentId)
    }
  } }
  if (payload.kind === 'text') {
    await insertCourseElement(kernel, target, 'text', { ...placement, text: payload.text })
    ports.commitStatus('已粘贴文字')
    return
  }
  const { items, issues } = await prepareImages(payload.files)
  if (items.length) {
    await insertCourseMedia(kernel, target, items, placement)
    ports.commitStatus(`已粘贴 ${items.length} 张图片`)
  }
  if (issues.length) ports.reportError(issues.join('\n'))
}

export function useCourseCanvasPaste(ports: CourseCanvasPastePorts): void {
  const latest = useRef(ports); latest.current = ports
  useEffect(() => {
    let composing = false
    const start = () => { composing = true }, end = () => { composing = false }
    const owns = (event: ClipboardEvent) => {
      const current = latest.current
      return event.defaultPrevented || composing || current.isReadOnly() || current.ownsPaste(event) || isEditorTextInputEvent(event)
    }
    const copy = (event: ClipboardEvent) => {
      if (owns(event) || window.getSelection()?.toString()) return
      if (latest.current.copyInternalClipboard?.(event, event.type === 'cut')) event.preventDefault()
    }
    const paste = (event: ClipboardEvent) => {
      const current = latest.current
      if (owns(event)) return
      if (current.pasteInternalClipboard?.(event)) { event.preventDefault(); return }
      const payload = readCanvasClipboardPayload(event.clipboardData)
      if (!payload) {
        if (event.clipboardData?.getData('text/html')) current.reportError('剪贴板只有 HTML 格式，当前画布无法直接插入。请复制其中的文字或图片，或使用 HTML 导入入口。')
        return
      }
      event.preventDefault()
      try {
        const target = captureCourseInsertionTarget(current.kernel)
        const placement = current.capturePlacement?.(target) ?? {}
        void pasteCanvasPayload(current, target, placement, payload).catch(error => current.reportError(error instanceof Error ? error.message : String(error)))
      } catch (error) { current.reportError(error instanceof Error ? error.message : String(error)) }
    }
    window.addEventListener('compositionstart', start)
    window.addEventListener('compositionend', end)
    window.addEventListener('paste', paste)
    window.addEventListener('copy', copy)
    window.addEventListener('cut', copy)
    return () => {
      window.removeEventListener('compositionstart', start)
      window.removeEventListener('compositionend', end)
      window.removeEventListener('paste', paste)
      window.removeEventListener('copy', copy)
      window.removeEventListener('cut', copy)
    }
  }, [])
}
