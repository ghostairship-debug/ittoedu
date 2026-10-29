// @vitest-environment node
import { expect, it } from 'vitest'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { TEXT_DEFINITION, createTextData } from '../../src/components/text'
import { courseAuthorData } from '../../src/renderer/media/commitCourseMediaAuthoring'
import { ComponentProjectFileCoordinator, type ComponentProjectSnapshot } from '../../src/core/projectFiles/componentPlatform/coordinator'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { boundedToolResult, MODEL_DELIVERY_BYTES, modelJsonBytes } from '../../src/core/tools/modelDeliveryBudget'

it.each([80, 500])('pages complete project directory records through the public byte boundary (limit %s)', async limit => {
  const project = createBlankCourseProjectV10('目录字节分页')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  const container = testContainerInstance(project, 0)
  for (let index = 0; index < 64; index++) {
    const id = `text-${index}`
    project.instances[id] = { id, definitionId: TEXT_DEFINITION.id,
      data: courseAuthorData(createTextData(`目录 ${index}：${'完整中文摘要😀'.repeat(30)}`)),
      frame: { width: 320, height: 180, transform: [1, 0, 0, 1, index * 10, 40] } }
    container.childIds.push(id)
  }
  const session = await DocumentSession.create({ documentId: 'directory', epoch: 'epoch',
    binding: { kind: 'untitled', suggestedName: 'directory.glx' },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, new CourseV10Driver(),
  { async append() {}, async save() { throw new Error('Directory reads must not save') } })
  const snapshot = () => session.read() as ComponentProjectSnapshot
  const coordinator = new ComponentProjectFileCoordinator({ async document() { return snapshot() },
    async apply() { throw new Error('Directory reads must not apply') }, async source() { throw new Error('No external source needed') } })
  const initial = snapshot()
  const expected = componentProjectFiles(initial.model.project, initial.model.resources).map(file => ({
    path: file.path, type: file.kind,
    ...(file.frame ? { frame: file.frame } : {}), ...(file.programViewport ? { viewport: file.programViewport } : {}),
    ...(file.summary ? { summary: file.summary } : {}), ...(file.references ? { references: file.references } : {}), ...(file.note ? { note: file.note } : {}),
  }))
  expect(modelJsonBytes({ kind: 'read', data: { files: expected } })).toBeGreaterThan(MODEL_DELIVERY_BYTES)
  let offset = 0, sequence = 0
  const paths: string[] = []
  while (true) {
    const raw = await coordinator.execute('run', `list-${++sequence}`, 'read', 'project.list', { offset, limit })
    expect(raw).toMatchObject({ kind: 'read' })
    const delivered = boundedToolResult('project.list', raw)
    // The final public boundary must not replace items, truncate fields, or
    // hide the owner's continuation inside a structural-omission receipt.
    expect(delivered).toBe(raw)
    expect(modelJsonBytes(delivered)).toBeLessThanOrEqual(MODEL_DELIVERY_BYTES)
    if (delivered.kind !== 'read') throw new Error('Expected a directory page')
    const page = delivered.data as { files: typeof expected; offset: number; total: number;
      nextOffset?: number; revision: number; currentRevision: number; staleSnapshot?: boolean }
    expect(page).toMatchObject({ offset, total: expected.length, revision: 0, currentRevision: offset ? 1 : 0 })
    expect(page.files.length).toBeGreaterThan(0)
    expect(page.files.length).toBeLessThanOrEqual(limit)
    expect(page.files).toEqual(expected.slice(offset, offset + page.files.length))
    paths.push(...page.files.map(file => file.path))
    if (!offset) {
      expect(page.files.length).toBeLessThan(Math.min(limit, expected.length))
      expect(page.nextOffset).toBe(page.files.length)
      const withheld = expected[page.nextOffset!]!.path
      expect(() => coordinator.captureFile('run', snapshot(), withheld, true)).toThrow(/尚未观察/)
      // Reorder after delivery: continuation is the original directory, with
      // explicit current revision, and only delivered paths become observed.
      await session.execute({ documentId: initial.documentId, epoch: initial.epoch, baseRevision: initial.revision,
        operationId: 'human-reorder', actor: 'human', mutation: { type: 'command',
          command: captureComponentOperation(initial.model.project, [{ type: 'instance.move', instanceId: 'text-63',
            container: { kind: 'surface', surfaceId: container.id }, index: 0 }]) } })
    } else {
      expect(page.staleSnapshot).toBe(true)
      expect(coordinator.captureFile('run', snapshot(), page.files[0]!.path, true).snapshot.revision).toBe(0)
    }
    if (page.nextOffset === undefined) break
    expect(page.nextOffset).toBe(offset + page.files.length)
    expect(page.nextOffset).toBeGreaterThan(offset)
    expect(page.nextOffset).toBeLessThan(expected.length)
    offset = page.nextOffset
  }
  expect(paths).toEqual(expected.map(file => file.path))
  expect(new Set(paths).size).toBe(expected.length)
  expect(snapshot()).toMatchObject({ revision: 1, undoDepth: 1 })
})
