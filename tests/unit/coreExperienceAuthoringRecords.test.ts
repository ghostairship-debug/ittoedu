// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { prepareWebAuthoringRecordEdits } from '../../src/components/web/authoringRecords'
import { WEB_DEFINITION, webDataSchema } from '../../src/components/web/data'
import type { ComponentAuthorSpotInput } from '../../src/shared/contracts/component-platform/runtime'
import { htmlPreviewRequestSchema, htmlPreviewTargetReportSchema } from '../../src/shared/workbench/htmlPreview'
import { htmlSourceEditCommandSchema } from '../../src/shared/html/sourceEditCommands'

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
  const nextText = captureComponentOperation(project, prepareWebAuthoringRecordEdits(project, { ...capture, initialValue: 'AI revision' }, { text: 'Later' }))
  const rebound = structuredClone(project)
  ;(rebound.instances.web.data as { authoringRecords: Record<string, { scope: Record<string, string> }> }).authoringRecords['local-a'].scope = { 'item.id': 'another-item' }
  expect(() => applyComponentOperation(rebound, nextText)).toThrow('目标内容或归属已变化')
})
it('carries the same local record through HTML reports and accepts a single source gesture batch', () => {
  const record = { kind: 'text', scope: spot.scope, binding: spot.binding, overrides: { text: 'Edited', geometry: { translateX: 35 } } }
  const report = htmlPreviewTargetReportSchema.parse({ handle: 'hit', kind: 'text', domPath: [], sectionOrder: null,
    rawText: 'Original', attributeName: null, rect: { x: 0, y: 0, width: 100, height: 20 }, scriptCreated: true,
    authoring: { authorKey: 'local-a', record } })
  expect(report.authoring?.record).toEqual(record)
  expect(htmlPreviewRequestSchema.parse({ type: 'html-preview.edit', operationId: 'op', documentId: 'doc', epoch: 'epoch',
    baseRevision: 1, bindingVersion: 1, leaseId: 'lease', loadId: 'load', target: 'hit', change: { kind: 'geometry', geometry: { width: 200 } } }).type).toBe('html-preview.edit')
  expect(htmlSourceEditCommandSchema.parse({ type: 'batch', commands: [
    { type: 'style', target: { kind: 'element', from: 0, to: 10 }, patch: { color: 'blue' } },
    { type: 'move', target: { kind: 'element', from: 0, to: 10 }, parent: { kind: 'element', from: 0, to: 20 }, index: 1 },
  ] }).type).toBe('batch')
})
