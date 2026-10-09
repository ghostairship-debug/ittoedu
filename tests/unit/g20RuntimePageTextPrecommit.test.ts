import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { registerRuntimeLightEditDocument, runtimeLightEditCommands } from '../../src/renderer/composition/runtime/runtimeLightEditCommands'
import type { CapturedCourseTarget, CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'

const project = createBlankCourseProjectV10('页面文字')
project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
project.instances.web = { id: 'web', definitionId: WEB_DEFINITION.id, data: { html: '<p>原文</p><script>const states=["其他状态"];</script>' } }
project.surfaces[0].childIds = ['web']
const target: CapturedCourseTarget = { documentId: 'document-1', epoch: 'epoch', project, editingProject: project,
  resources: { assets: {}, components: {} }, activeStateId: null, surfaceId: project.surfaces[0].id, instanceId: 'web', instanceIds: ['web'] }
const submit = vi.fn()
const bridge = { captureTarget: () => structuredClone(target),
  capture: (edits: Parameters<typeof captureComponentOperation>[1], value: CapturedCourseTarget) =>
    ({ ...captureComponentOperation(value.project, edits), documentId: value.documentId, epoch: value.epoch }),
  editCaptured: submit } as unknown as CourseV10DocumentBridge
let stop = () => {}
beforeEach(() => {
  submit.mockReset()
  stop = registerRuntimeLightEditDocument('document-1', { authorSpots: () => [], subscribeAuthorSpots: () => () => {} } as unknown as ComponentPlatformRuntime, bridge)
})
afterEach(() => stop())
const capture = () => runtimeLightEditCommands.capturePageCopy('document-1', 'web', '原文')

it('waits for the canonical Main ACK before reporting a page-copy change', async () => {
  let settle!: () => void
  submit.mockImplementationOnce(() => new Promise<void>(resolve => { settle = resolve }))
  const result = runtimeLightEditCommands.setPageCopy(capture(), '新文')
  expect(submit).toHaveBeenCalledOnce()
  expect(submit.mock.calls[0][0]).toMatchObject({ documentId: 'document-1', epoch: 'epoch',
    edits: [{ type: 'data.set', instanceId: 'web', path: ['textOverrides'], value: [{ original: '原文', text: '新文' }] }] })
  let pending = true
  void result.then(() => { pending = false })
  await Promise.resolve()
  expect(pending).toBe(true)
  settle()
  await expect(result).resolves.toEqual({ ok: true, changed: true })
  expect(project.instances.web.data).toEqual({ html: '<p>原文</p><script>const states=["其他状态"];</script>' })
})

it('reports rejected completion without rewriting source or acknowledging a change', async () => {
  submit.mockRejectedValueOnce(new Error('正式提交失败'))
  await expect(runtimeLightEditCommands.setPageCopy(capture(), '新文')).resolves.toEqual({ ok: false, reason: '正式提交失败' })
  expect(project.instances.web.data).toEqual({ html: '<p>原文</p><script>const states=["其他状态"];</script>' })
})

it.each(['blocked', 'unknown', 'failed', 'conflict'] as const)('retains page copy for a %s Bridge rejection instead of acknowledging it', async status => {
  submit.mockRejectedValueOnce(new Error(status + ': 原操作仍待处理'))
  await expect(runtimeLightEditCommands.setPageCopy(capture(), '人工新稿')).resolves.toEqual({ ok: false, reason: status + ': 原操作仍待处理' })
  expect(project.instances.web.data).toEqual({ html: '<p>原文</p><script>const states=["其他状态"];</script>' })
})
