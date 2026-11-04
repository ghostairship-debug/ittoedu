import type { ExecutionFileContext, ExecutionFileReference } from '../../shared/workbench/fileContext'
import { focusPathKey, type FocusedWorkbenchFile } from './officeFocus'

export type FileReferenceChoice = ExecutionFileReference['scope'] | 'focus'
export type ExplicitFileReferenceScope = ExecutionFileReference['scope']
export const fileReferenceIdentity = (reference: ExecutionFileReference): string =>
  `${focusPathKey(reference.path)}:${reference.scope}:${JSON.stringify(reference.focus ?? {})}`

export function fileFocusReference(file: FocusedWorkbenchFile | undefined, choice: FileReferenceChoice = 'focus', pinned = false): ExecutionFileReference | undefined {
  if (!file) return undefined
  const focus = file.focus ?? {}
  const scope = choice === 'focus' ? focus.shapeIds?.length ? 'object' : focus.range ? 'range'
    : focus.paragraphId !== undefined || focus.paragraph !== undefined ? 'paragraph' : focus.page !== undefined ? 'page' : focus.sheet ? 'sheet' : 'file' : choice
  if (scope === 'object' && !focus.shapeIds?.length || scope === 'page' && focus.page === undefined
    || scope === 'range' && !focus.range || scope === 'sheet' && !focus.sheet
    || scope === 'paragraph' && focus.paragraphId === undefined && focus.paragraph === undefined) return undefined
  const location = scope === 'file' ? undefined : scope === 'page' ? { page: focus.page, ...(focus.part ? { part: focus.part } : {}) }
    : scope === 'sheet' ? { sheet: focus.sheet } : structuredClone(focus)
  return { path: file.path, scope, ...(location ? { focus: location } : {}), pinned,
    ...(file.fileVersion ? { fileVersion: file.fileVersion } : {}), ...(file.bindingVersion ? { bindingVersion: file.bindingVersion } : {}) }
}

export function captureFileContext(files: readonly FocusedWorkbenchFile[], pinned: readonly ExecutionFileReference[], removed: ReadonlySet<string>): ExecutionFileContext {
  // A pin retains its target while version metadata follows the open file. Closed pins
  // remain explicit references and must be revalidated by the normal file service.
  const pins = pinned.map(reference => {
    const file = files.find(value => focusPathKey(value.path) === focusPathKey(reference.path))
    return { ...structuredClone(reference), ...(file?.fileVersion ? { fileVersion: file.fileVersion } : {}),
      ...(file?.bindingVersion ? { bindingVersion: file.bindingVersion } : {}) }
  })
  const active = files.find(file => file.active && !file.documentId)
  const automatic = fileFocusReference(active)
  if (automatic) {
    const identity = fileReferenceIdentity(automatic)
    if (!removed.has(identity) && !pins.some(pin => fileReferenceIdentity(pin) === identity)) pins.push(automatic)
  }
  return { openFiles: structuredClone([...files]), references: pins }
}

/** Preparing input can advance file bytes. Refresh versions without changing the target
 * that was visible when Send was clicked, even if the user navigates during the await. */
export function refreshFileContextVersions(captured: ExecutionFileContext, current: readonly FocusedWorkbenchFile[]): ExecutionFileContext {
  const version = (path: string) => {
    const file = current.find(value => focusPathKey(value.path) === focusPathKey(path))
    return { ...(file?.fileVersion ? { fileVersion: file.fileVersion } : {}), ...(file?.bindingVersion ? { bindingVersion: file.bindingVersion } : {}) }
  }
  return { openFiles: captured.openFiles.map(file => ({ ...structuredClone(file), ...version(file.path) })),
    references: captured.references.map(reference => ({ ...structuredClone(reference), ...version(reference.path) })) }
}

export function fileReferenceLabel(reference: ExecutionFileReference): string {
  const focus = reference.focus
  if (reference.scope === 'object') return `第 ${focus?.page !== undefined ? focus.page + 1 : '?'} 页 · ${focus?.shapeIds?.length ?? 0} 个对象`
  if (reference.scope === 'page') return `第 ${focus?.page !== undefined ? focus.page + 1 : '?'} 页`
  if (reference.scope === 'range') return `单元格 ${focus?.range ?? ''}`
  if (reference.scope === 'sheet') return focus?.sheet ? `工作表 · ${focus.sheet}` : '工作表'
  if (reference.scope === 'paragraph') return focus?.paragraph !== undefined ? `第 ${focus.paragraph + 1} 段` : '段落'
  return /\.xlsx$/i.test(reference.path) ? '整个工作簿' : '整个文档'
}

export function fileReferenceLocation(reference: ExecutionFileReference): string {
  const focus = reference.focus
  if (reference.scope === 'object' && focus?.shapeIds?.length) return `${fileReferenceLabel(reference)}（对象 ID ${focus.shapeIds.join('、')}）`
  if (reference.scope === 'range' && focus?.sheet) return `${focus.sheet}!${focus.range}`
  if (reference.scope === 'paragraph' && focus?.paragraph === undefined && focus?.paragraphId) return `段落 ${focus.paragraphId}`
  return fileReferenceLabel(reference)
}

export function fileScopeOptions(path: string, current?: FocusedWorkbenchFile) {
  const format = current?.format ?? path.split('.').at(-1)?.toLowerCase()
  const options: { id: ExplicitFileReferenceScope; label: string }[] = [
    { id: 'file', label: format === 'xlsx' ? '整个工作簿' : '整个文档' },
  ]
  if (format === 'pptx') options.push({ id: 'page', label: '当前页' }, { id: 'object', label: '当前对象' })
  if (format === 'xlsx') options.push({ id: 'sheet', label: '当前工作表' }, { id: 'range', label: '所选单元格' })
  if (format === 'docx') {
    if (current?.focus?.page !== undefined) options.push({ id: 'page', label: '当前页' })
    options.push({ id: 'paragraph', label: '当前段落' })
  }
  return options.map(option => ({ ...option, available: option.id === 'file' || Boolean(fileFocusReference(current, option.id)) }))
}
