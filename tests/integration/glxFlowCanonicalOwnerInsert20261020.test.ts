// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import { ContentApplyService } from '../../src/main/workbench/contentApply/applyService'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { componentContainerBuiltinKey, createComponentContainerInstance, type ComponentDefinition, type ComponentFrame, type JsonValue } from '../../src/shared/contracts/component-platform'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { GROUP_DEFINITION } from '../../src/main/workbench/contentApply/application/professionalGraphics'
import type { ContentApplyTarget, ContentObjectDraft } from '../../src/core/contentApply/planning/types'
import type { DocumentOperation } from '../../src/shared/workbench/document'

const frame = (x: number, y: number, width = 180, height = 60): ComponentFrame => ({ width, height, transform: [1, 0, 0, 1, x, y] })
const textData = (text: string): JsonValue => JSON.parse(JSON.stringify(createTextComponentData(text))) as JsonValue
const SOURCE_DEFINITION: ComponentDefinition = { id: 'local-source', role: 'content', title: 'Source component', implementation: {
  kind: 'source', language: 'javascript', source: 'export default {mount(context){context.root.textContent="Source";return {update(){},dispose(){}}}};',
} }

async function authoring() {
  let id = 0
  const project = createBlankCourseProjectV10('Nested Flow', () => `base-${++id}`)
  const slide = project.instances[project.rootIds[0]!]!
  const flowKey = componentContainerBuiltinKey('flow')
  project.definitions[flowKey] = { id: flowKey, role: 'mixed', implementation: { kind: 'builtin', key: flowKey } }
  for (const definition of [TEXT_DEFINITION, WEB_DEFINITION, GROUP_DEFINITION, SOURCE_DEFINITION]) project.definitions[definition.id] = definition
  project.instances.flow = { ...createComponentContainerInstance({ id: 'flow', title: 'Nested reading', kind: 'flow',
    designSize: { width: 640, height: 480 }, flow: { layout: { widthMode: 'reading', readingWidth: 600, wideContentWidth: 640 } },
    childIds: ['anchor', 'neighbor', 'group'] }, flowKey), frame: frame(80, 90, 640, 480) }
  project.instances.anchor = { id: 'anchor', definitionId: TEXT_DEFINITION.id, data: textData('Existing paragraph') }
  project.instances.neighbor = { id: 'neighbor', definitionId: WEB_DEFINITION.id, data: { html: '<button>Existing interaction</button>' }, frame: frame(17, 29, 320, 120) }
  project.instances.group = { id: 'group', definitionId: GROUP_DEFINITION.id, data: {}, frame: frame(0, 0, 560, 180), childIds: ['group-child'] }
  project.instances['group-child'] = { id: 'group-child', definitionId: TEXT_DEFINITION.id, data: textData('Manual group text'), frame: frame(10, 10, 130, 35) }
  slide.childIds = ['flow']
  const session = await DocumentSession.create({ documentId: 'flow-owner', epoch: 'flow-owner-epoch',
    binding: { kind: 'untitled', suggestedName: 'flow.glx' }, model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } },
  new CourseV10Driver(), { async append() {}, async save() { throw new Error('This insertion probe does not save') } })
  const current = () => {
    const model = session.read().model
    if (model.kind !== 'course-v10') throw new Error('Expected work project')
    return model
  }
  const execute = (mutation: DocumentOperation['mutation']) => {
    const snapshot = session.read()
    return session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: `operation-${++id}`, actor: 'agent', mutation })
  }
  const service = new ContentApplyService({ session: { project: () => current().project, resources: () => current().resources,
    dispatch: command => execute({ type: 'command', command }) }, createId: () => `inserted-${++id}`,
    compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()),
    async measure() { throw new Error('Formal object drafts need no HTML measurement') },
  })
  const target = (kind: 'container' | 'anchor' | 'group'): ContentApplyTarget => {
    const file = componentProjectFiles(current().project, current().resources).find(file => kind !== 'container'
      ? file.target?.kind === 'instance' && file.target.instanceId === (kind === 'group' ? 'group-child' : 'anchor') && file.kind === 'data'
      : file.target?.kind === 'container' && file.target.container.kind === 'instance' && file.target.container.instanceId === 'flow')
    // Flow's .container.json is the real public instance-container producer.
    // An ordinary group's instance target inserts beside its child through the same owner planner.
    if (!file?.target) throw new Error(`Missing formal projected target: ${kind}`)
    return file.target
  }
  return { session, service, current, execute, target }
}

const drafts = (): ContentObjectDraft[] => [
  { definitionId: TEXT_DEFINITION.id, data: textData('New paragraph'), frame: frame(46, 58) },
  { definitionId: WEB_DEFINITION.id, data: { html: '<button>New Web</button>' }, frame: frame(67, 79, 230, 110) },
  { definitionId: SOURCE_DEFINITION.id, data: { label: 'New Source' }, frame: frame(89, 101, 250, 130) },
]

it.each(['container', 'anchor'] as const)('keeps canonical Flow order and local sizing when inserting through the public %s target', async kind => {
  const harness = await authoring(), before = structuredClone(harness.current().project)
  const result = await harness.service.apply({ intent: 'insert', target: harness.target(kind), source: { kind: 'objects', objects: drafts() } })
  expect(result).toMatchObject({ commit: 'committed', diagnostics: [] })
  const after = harness.current().project
  const [text, web, source] = result.insertedIds.map(id => after.instances[id]!)
  expect(text).not.toHaveProperty('frame')
  expect(web.frame).toEqual(frame(0, 0, 230, 110))
  expect(source.frame).toEqual(frame(0, 0, 250, 130))
  expect(after.instances.flow!.childIds).toEqual(kind === 'container'
    ? ['anchor', 'neighbor', 'group', ...result.insertedIds]
    : ['anchor', ...result.insertedIds, 'neighbor', 'group'])
  for (const id of Object.keys(before.instances)) {
    if (id === 'flow') expect(after.instances[id]).toEqual({ ...before.instances[id], childIds: after.instances[id]!.childIds })
    else expect(after.instances[id]).toEqual(before.instances[id])
  }
  expect(harness.session.read().undoDepth).toBe(1)
  expect(await harness.execute({ type: 'undo' })).toMatchObject({ status: 'applied' })
  expect(harness.current().project.instances).toEqual(before.instances)
})

it('keeps an ordinary group inside Flow in its own free frame coordinates', async () => {
  const harness = await authoring(), before = structuredClone(harness.current().project)
  const originalFrame = frame(230, 90, 120, 40)
  const result = await harness.service.apply({ intent: 'insert', target: harness.target('group'), source: { kind: 'objects', objects: [
    { definitionId: TEXT_DEFINITION.id, data: textData('Free group text'), frame: originalFrame },
  ] } })
  expect(result).toMatchObject({ commit: 'committed', usability: 'usable', diagnostics: [] })
  const after = harness.current().project
  expect(after.instances[result.insertedIds[0]!]!.frame).toEqual(originalFrame)
  expect(after.instances.group!.childIds).toEqual(['group-child', result.insertedIds[0]])
  expect(after.instances['group-child']).toEqual(before.instances['group-child'])
  expect(after.instances.flow).toEqual(before.instances.flow)
  expect(after.instances.neighbor).toEqual(before.instances.neighbor)
})
