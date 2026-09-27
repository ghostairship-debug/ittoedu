import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CourseV9Driver } from '@/core/drivers/CourseV9Driver'
import { openCourseProjectArchive } from '@/core/drivers/codecs/courseProjectArchive'
import { registerFlowDynamicDraft } from '@/renderer/composition/runtime/flowDynamicDraftPreparation'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { selectActiveSceneId, useEditorStore } from '@/renderer/store/editorStore'
import type { CourseProjectDocument, RuntimeLayerItem } from '@/shared/courseProjectTypes'
import type { DocumentHostAPI } from '@/shared/workbench/desktop'
import { bootTriageCourseHost, formalCourse, formalProject, projectCourse, type TriageCourseHost } from '../helpers/triage-t7-courseHost'

const ORIGINAL = '待修改的 Runtime 文字'
const EDITED = '保存时提交的 Runtime 文字'
let host: TriageCourseHost
let unregister: Array<() => void>

function course(title: string): CourseProjectDocument {
  const project = createBlankFlowCourseProject({ includeDefaultController: false, controls: 'none' })
  project.title = title
  const flow = project.surfaces[0]
  if (flow?.type !== 'flow') throw new Error('Expected Flow surface')
  const item: RuntimeLayerItem = {
    layerItemId: `runtime-${title}`, label: title, order: 1, visible: true, locked: false, rotation: 0, opacity: 1,
    hitPolicy: 'auto', playbackInitialVisibility: 'inherit', paperSpace: 'paper',
    frame: { mode: 'absolute', x: 20, y: 30, width: 500, height: 240 }, kind: 'runtime',
    runtime: { protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom',
      source: `CoursewareRuntime.define({runtimeApiVersion:3,create(ctx){ctx.dom.root.textContent='${ORIGINAL}';return {destroy(){}}}});`,
      content: { values: {} }, assets: {} },
  }
  flow.surfaceLayerItems = [{ item, visibility: { mode: 'all', locationIds: [] } }]
  return project
}

function runtimeText(project: CourseProjectDocument, title: string): string | undefined {
  const flow = project.surfaces[0]
  if (flow?.type !== 'flow') throw new Error('Expected Flow surface')
  const item = flow.surfaceLayerItems.find(entry => entry.item.layerItemId === `runtime-${title}`)?.item
  if (item?.kind !== 'runtime') throw new Error('Expected paper Runtime')
  return item.runtime.content.overrides?.find(entry => entry.original === ORIGINAL)?.text
}

function deferred() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

function registerPendingRuntimeDraft(documentId: string, title: string, gate?: Promise<void>) {
  const state = useEditorStore.getState()
  const target = state.captureRuntimeContentTextTarget({ projectId: formalProject(host).id, scope: 'scene',
    sceneId: selectActiveSceneId(state), nodeId: `runtime-${title}`, targetId: 'auto:text', kind: 'text', key: '',
    lightEdit: { original: ORIGINAL } })
  if (!target) throw new Error('Expected editable Runtime target')
  let pending: Promise<void> | null = null
  const prepare = vi.fn(() => {
    if (pending) return pending
    pending = (async () => {
      if (gate) await gate
      const handle = useEditorStore.getState().submitDynamicFallbackIntent({ documentId,
        projectId: target.courseTarget.projectId, locationId: formalProject(host, documentId).startLocationId, itemId: `runtime-${title}`,
        kind: 'runtime.text', target, value: EDITED })
      if (!handle) throw new Error('Runtime draft lost its document')
      const result = await handle.settled
      if (result.status !== 'applied' && result.status !== 'unchanged') throw new Error(`Runtime draft failed: ${result.status}`)
    })()
    return pending
  })
  unregister.push(registerFlowDynamicDraft({ documentId, owner: `focused-${title}`, prepare }))
  return prepare
}

beforeEach(async () => { host = await bootTriageCourseHost(); unregister = [] })
afterEach(async () => {
  unregister.forEach(stop => stop())
  await useEditorStore.getState().drainAllCourseDocuments().catch(() => undefined)
  vi.restoreAllMocks()
})

it('awaits a focused Runtime draft and its formal fallback receipt before saving the correct document archive', async () => {
  const id = await projectCourse(host, course('A'))
  const prepare = registerPendingRuntimeDraft(id, 'A')
  const real = host.api.saveWithDialog.bind(host.api)
  const archives: Array<{ id: string; bytes: Uint8Array }> = []
  host.api.saveWithDialog = vi.fn(async (...args: Parameters<DocumentHostAPI['saveWithDialog']>) => {
    const snapshot = host.registry.get(args[0]).read()
    if (snapshot.model.kind !== 'course-v9') throw new Error('Expected Course V9')
    archives.push({ id: args[0], bytes: new CourseV9Driver().serialize(snapshot.model) })
    return real(...args)
  })

  const saved = await useEditorStore.getState().saveCourseDocument()
  expect(prepare).toHaveBeenCalledOnce()
  expect(saved?.documentId).toBe(id)
  expect(archives).toHaveLength(1)
  expect(archives[0]!.id).toBe(id)
  expect(runtimeText(openCourseProjectArchive(archives[0]!.bytes).project, 'A')).toBe(EDITED)
  expect(runtimeText(formalProject(host, id), 'A')).toBe(EDITED)
  expect(formalCourse(host, id).dirty).toBe(false)
})

it('does not save an old draft into a new document or let an old navigation override a newer selection', async () => {
  const a = await projectCourse(host, course('A'))
  const b = await projectCourse(host, course('B'))
  const c = await projectCourse(host, course('C'))
  await useEditorStore.getState().activateCourseDocument(a)
  const gate = deferred()
  const prepare = registerPendingRuntimeDraft(a, 'A', gate.promise)
  const savedIds: string[] = []
  const real = host.api.saveWithDialog.bind(host.api)
  host.api.saveWithDialog = vi.fn(async (...args: Parameters<DocumentHostAPI['saveWithDialog']>) => {
    savedIds.push(args[0]); return real(...args)
  })

  const oldSave = useEditorStore.getState().saveCourseDocument()
  const oldNavigation = useEditorStore.getState().activateCourseDocument(b)
  const newNavigation = useEditorStore.getState().activateCourseDocument(c)
  expect(prepare).toHaveBeenCalled()
  expect(savedIds).toEqual([])
  gate.release()
  await expect(oldSave).rejects.toThrow(/文档已切换/)
  await oldNavigation
  await newNavigation
  expect(useEditorStore.getState().courseDocument.documentId).toBe(c)
  expect(savedIds).toEqual([])
  expect(runtimeText(formalProject(host, a), 'A')).toBe(EDITED)
  expect(runtimeText(formalProject(host, b), 'B')).toBeUndefined()
  expect(runtimeText(formalProject(host, c), 'C')).toBeUndefined()
})

it('keeps the current document open when Runtime draft preparation fails', async () => {
  const a = await projectCourse(host, course('A'))
  const b = await projectCourse(host, course('B'))
  await useEditorStore.getState().activateCourseDocument(a)
  const prepare = vi.fn(async () => { throw new Error('Runtime draft is still composing') })
  unregister.push(registerFlowDynamicDraft({ documentId: a, owner: 'focused-failure', prepare }))
  const save = vi.spyOn(host.api, 'saveWithDialog')
  const close = vi.spyOn(host.api, 'closeWithDialog')

  await expect(useEditorStore.getState().saveCourseDocument()).rejects.toThrow('Runtime draft is still composing')
  await expect(useEditorStore.getState().activateCourseDocument(b)).rejects.toThrow('Runtime draft is still composing')
  expect(await useEditorStore.getState().closeCourseDocument(a)).toBe(false)
  expect(prepare).toHaveBeenCalledTimes(3)
  expect(useEditorStore.getState().courseDocument.documentId).toBe(a)
  expect(formalCourse(host, a).documentId).toBe(a)
  expect(save).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})
