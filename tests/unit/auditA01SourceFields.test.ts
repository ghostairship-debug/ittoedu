// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextComponentData } from '../../src/components/text/data'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { planCourseProductivityEdits, inspectCourseRemixSlots } from '../../src/core/course/courseProductivityEdits'
import { registerRuntimeLightEditDocument, runtimeLightEditCommands } from '../../src/renderer/composition/runtime/runtimeLightEditCommands'
import type { ComponentAuthorSpot, ComponentImplementation } from '../../src/shared/contracts/component-platform'
import type { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import type { CapturedCourseTarget, CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
const source: ComponentImplementation = { kind: 'source', language: 'javascript', source: 'export default { mount() {} }' }
let stop = () => {}
afterEach(() => stop())
it.each(['definition', 'override'])('edits professional text for a Source %s without scanning opaque data or replacing its visual implementation', mode => {
  const project = createBlankCourseProjectV10(), surface = project.surfaces[0]
  project.definitions.text = mode === 'definition' ? { ...TEXT_DEFINITION, id: 'text', professionalBuiltinKey: 'guoling.text', implementation: source } : { ...TEXT_DEFINITION, id: 'text' }
  project.definitions.opaque = { id: 'opaque', role: 'content', implementation: source }
  project.instances.text = { id: 'text', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('旧标题'))), ...(mode === 'override' ? { implementationOverride: source } : {}) }
  project.instances.opaque = { id: 'opaque', definitionId: 'opaque', data: { nested: { title: '旧标题', content: { inlines: [{ type: 'text', text: '旧标题' }] } } } }
  surface.childIds = ['text', 'opaque']
  const before = structuredClone(project)
  const plan = planCourseProductivityEdits(project, surface.id, { kind: 'text', scope: 'page', find: '旧', replacement: '新' })
  expect(plan.edits).toEqual([{ type: 'data.set', instanceId: 'text', path: ['content'], value: { inlines: [{ type: 'text', text: '新标题' }] } }])
  expect(inspectCourseRemixSlots(project, surface.id).slots.map(slot => slot.instanceId)).toEqual(['text'])
  expect(project).toEqual(before)
})
it('deduplicates a repeated field, preserves same text at another address and writes the chosen Source field only', async () => {
  const project = createBlankCourseProjectV10(), surface = project.surfaces[0]
  project.definitions.source = { id: 'source', role: 'content', implementation: source }
  project.instances.source = { id: 'source', definitionId: 'source', data: { title: '同文', caption: '同文' } }
  surface.childIds = ['source']
  const spots: ComponentAuthorSpot[] = ['title', 'title', 'caption'].map((key, index) => ({ id: `spot-${index}`, kind: 'text', instanceId: 'source', mountGeneration: 1,
    dataPath: [key], initialValue: '同文', localBounds: { width: 10, height: 10, transform: [1, 0, 0, 1, 0, 0] } }))
  const target: CapturedCourseTarget = { documentId: 'doc', epoch: 'epoch', project, editingProject: project, resources: { assets: {}, components: {} },
    surfaceId: surface.id, activeStateId: null, instanceId: 'source', instanceIds: ['source'] }
  const commit = vi.fn(async () => {})
  const bridge = { read: () => ({ views: [{ documentId: 'doc', model: { project } }] }), captureTarget: () => structuredClone(target),
    capture: (edits: unknown) => edits, editCaptured: commit } as unknown as CourseV10DocumentBridge
  stop = registerRuntimeLightEditDocument('doc', { authorSpots: () => spots, subscribeAuthorSpots: () => () => {} } as unknown as ComponentPlatformRuntime, bridge)
  const view = runtimeLightEditCommands.read('source', 'doc')!
  expect(view.entries.map(entry => entry.spot.dataPath)).toEqual([['title'], ['caption']])
  expect(await runtimeLightEditCommands.setPageText(runtimeLightEditCommands.capturePageText('doc', view.entries[1].spot), '说明')).toEqual({ ok: true, changed: true })
  expect(commit).toHaveBeenCalledExactlyOnceWith([{ type: 'data.set', instanceId: 'source', path: ['caption'], value: '说明' }])
  expect(project.instances.source.data).toEqual({ title: '同文', caption: '同文' })
})
it('keeps the explicit page-copy command for a Source presentation of Web data', () => {
  const project = createBlankCourseProjectV10(), surface = project.surfaces[0]
  project.definitions.web = { ...WEB_DEFINITION, id: 'web', professionalBuiltinKey: 'guoling.web', implementation: source }
  project.instances.web = { id: 'web', definitionId: 'web', data: { html: '<p>页面标题</p>' } }
  const target = { documentId: 'web-doc', epoch: 'epoch', project, editingProject: project, resources: { assets: {}, components: {} },
    surfaceId: surface.id, activeStateId: null, instanceId: 'web', instanceIds: ['web'] } as CapturedCourseTarget
  const bridge = { captureTarget: () => target } as unknown as CourseV10DocumentBridge
  stop = registerRuntimeLightEditDocument('web-doc', { subscribeAuthorSpots: () => () => {} } as unknown as ComponentPlatformRuntime, bridge)
  expect(runtimeLightEditCommands.capturePageCopy('web-doc', 'web', '页面标题')).toMatchObject({ original: '页面标题', previous: '页面标题' })
})
