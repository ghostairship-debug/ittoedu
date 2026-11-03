import type { ExecutionFileContext, ExecutionFileReference } from '../../shared/workbench/fileContext'
import { focusPathKey, type FocusedWorkbenchFile } from './officeFocus'

export type FileReferenceChoice = ExecutionFileReference['scope'] | 'focus'
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

export function captureFileContext(files: readonly FocusedWorkbenchFile[], pinned: readonly ExecutionFileReference[], removed: ReadonlySet<string>, preferNativePin = false): ExecutionFileContext {
  // A pin retains its target while version metadata follows the open file. Closed pins
  // remain explicit references and must be revalidated by the normal file service.
  const pins = pinned.map(reference => {
    const file = files.find(value => focusPathKey(value.path) === focusPathKey(reference.path))
    return { ...structuredClone(reference), ...(file?.fileVersion ? { fileVersion: file.fileVersion } : {}),
      ...(file?.bindingVersion ? { bindingVersion: file.bindingVersion } : {}) }
  })
  const active = files.find(file => file.active && !file.documentId)
  const automatic = fileFocusReference(active)
  return { openFiles: structuredClone([...files]), references: pins.length ? pins
    : preferNativePin || !automatic || removed.has(fileReferenceIdentity(automatic)) ? [] : [automatic] }
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
  if (reference.scope === 'range') return `${focus?.sheet ?? '工作表'}!${focus?.range ?? ''}`
  if (reference.scope === 'sheet') return focus?.sheet ?? '工作表'
  if (reference.scope === 'paragraph') return focus?.paragraphId ?? `第 ${(focus?.paragraph ?? 0) + 1} 段`
  return '文件'
}
