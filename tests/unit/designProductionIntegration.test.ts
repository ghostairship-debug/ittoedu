// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { planCourseRecipeEdits, recipeDefaults, SORT_COMPONENT_ID } from '../../src/core/course/courseRecipeEdits'
import { createTextReplacePreview, applyProductivityPreview, designProductionStep } from '../../src/renderer/authoring/productivity'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION, createTextComponentData, textComponentDataSchema } from '../../src/components/text'
import { createCourseDocumentHost } from '../helpers/courseDocumentHost'
const store = () => useEditorStore.getState()
afterEach(() => store().courseBridge.dispose())

it('commits a captured recipe through the active design action once, selects its new page, and preserves source bytes across save/Undo/Redo', async () => {
  const h = await createCourseDocumentHost(); await store().connectCourseDocuments(h.api)
  const context = store().prepareDesignProduction()!, original = structuredClone(context.document)
  const plan = planCourseRecipeEdits(context.document, { recipeId: 'classify-sort-v1', surfaceId: context.target.surfaceId, slots: { ...recipeDefaults('classify-sort-v1'), mode: 'sort' } })
  if (!plan.ok) throw new Error(plan.reason)
  const step = { ...designProductionStep(context, plan.edits), createdSurfaceId: plan.createdLocationId }
  expect(await store().commitDesignProduction(step)).toBe(true)
  const changed = store().courseView.snapshot!, documentId = context.target.documentId
  expect(changed.undoDepth).toBe(1); expect(store().courseView.surfaceId).toBe(plan.createdLocationId)
  if (changed.model.kind !== 'course-v10') throw new Error('Expected V10')
  const definition = changed.model.project.definitions[SORT_COMPONENT_ID]
  expect(definition.implementation.kind).toBe('source')
  expect(definition.implementation.kind === 'source' && definition.implementation.source).toContain('render')
  expect(h.driver.load(h.driver.serialize(changed.model))).toEqual(changed.model)
  await store().courseBridge.undo(documentId)
  expect(store().courseView.project!.instances).toEqual(original.instances)
  expect(store().courseView.project!.definitions).toEqual(original.definitions)
  await store().courseBridge.redo(documentId)
  expect(store().courseView.project!.instances).toEqual(changed.model.project.instances)
})

it('applies a Flow batch preview in one History operation and rejects its delayed replay without touching the latest contents', async () => {
  const h = await createCourseDocumentHost(); await store().connectCourseDocuments(h.api)
  const project = createBlankCourseProjectV10(), surface = project.surfaces[0]
  surface.kind = 'flow'; delete surface.designSize
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  for (const id of ['a', 'b']) project.instances[id] = { id, definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData({ inlines: [{ type: 'text', text: '旧内容 旧内容' }] }))) }
  surface.childIds = ['a', 'b']
  await store().createCourseDocumentFrom(project)
  const context = store().prepareDesignProduction()!, preview = createTextReplacePreview(context, { scope: 'page', find: '旧内容', replacement: '新内容' })
  const result = applyProductivityPreview(context, preview, preview.items.map(item => item.id))
  if (!result.ok || !result.step) throw new Error('Expected batch preview')
  expect(await store().commitDesignProduction(result.step)).toBe(true)
  expect(store().courseView.snapshot!.undoDepth).toBe(1)
  for (const id of surface.childIds) expect(textComponentDataSchema.parse(store().courseView.project!.instances[id].data).content.inlines).toEqual([{ type: 'text', text: '新内容 新内容' }])
  const after = store().courseView.snapshot!
  expect(await store().commitDesignProduction(result.step)).toBe(false)
  expect(store().courseView.snapshot).toEqual(after)
  await store().courseBridge.undo(context.target.documentId)
  expect(store().courseView.project!.instances).toEqual(project.instances)
})
