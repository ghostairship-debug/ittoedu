// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { prepareWebAuthoringRecordEdits } from '../../src/components/web/authoringRecords'
import { WEB_DEFINITION, webDataSchema } from '../../src/components/web/data'
import type { ComponentAuthorSpotInput } from '../../src/shared/contracts/component-platform/runtime'

const spot: ComponentAuthorSpotInput & { instanceId: string } = { instanceId: 'web', kind: 'text', authorKey: 'local-a',
  scope: { 'item.id': 'conversation-1' }, binding: { kind: 'dom', path: [{ tag: 'p', index: 0 }], baseline: 'Original' },
  initialValue: 'Original', localBounds: { width: 100, height: 20, transform: [1, 0, 0, 1, 0, 0] } }
function fixture() {
  const project = createBlankCourseProjectV10('内部编辑')
  project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
  project.instances.web = { id: 'web', definitionId: WEB_DEFINITION.id, data: { html: '<div id="root"></div>' } }
  project.surfaces[0].childIds = ['web']
  return project
}
it('saves a first internal text edit with its local binding and reopens the same author value', () => {
  const project = fixture(), edits = prepareWebAuthoringRecordEdits(project, spot, { text: 'Edited' })
  const driver = new CourseV10Driver(), model = driver.apply({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, captureComponentOperation(project, edits))
  const reopened = driver.load(driver.serialize(model))
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
  const data = webDataSchema.parse(reopened.project.instances.web.data)
  expect(data.authoringRecords?.['local-a']).toEqual({ kind: 'text', scope: spot.scope, binding: spot.binding, overrides: { text: 'Edited' } })
})
it('merges a delayed text edit with newer geometry and another internal object but rejects changed text', () => {
  let project = fixture()
  project = applyComponentOperation(project, captureComponentOperation(project, prepareWebAuthoringRecordEdits(project, spot, { text: 'Edited' })))
  const capture = { ...spot, initialValue: 'Edited' }
  const text = captureComponentOperation(project, prepareWebAuthoringRecordEdits(project, capture, { text: 'AI revision' }))
  project = applyComponentOperation(project, captureComponentOperation(project, prepareWebAuthoringRecordEdits(project, capture, { geometry: { translateX: 35, width: 210 } })))
  project = applyComponentOperation(project, captureComponentOperation(project, prepareWebAuthoringRecordEdits(project, { ...spot, authorKey: 'local-b' }, { text: 'Other edit' })))
  project = applyComponentOperation(project, text)
  const records = webDataSchema.parse(project.instances.web.data).authoringRecords!
  expect(records['local-a'].overrides).toEqual({ text: 'AI revision', geometry: { translateX: 35, width: 210 } })
  expect(records['local-b'].overrides.text).toBe('Other edit')
  expect(() => prepareWebAuthoringRecordEdits(project, capture, { text: 'Stale' })).toThrow('内容已变化')
})
