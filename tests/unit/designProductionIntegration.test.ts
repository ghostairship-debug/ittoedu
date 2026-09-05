import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore, selectActiveCourseProjectDocument } from '../../src/renderer/store/editorStore'
import { recipeDefaults } from '../../src/renderer/recipes/recipeCatalog'
import { createTextReplacePreview, applyProductivityPreview } from '../../src/renderer/authoring/productivity'
import { collectCourseProjectHealth } from '../../src/shared/courseProjectHealth'
import { componentPackagesToArchiveFiles } from '../../src/renderer/components/componentPackageStore'

beforeEach(() => useEditorStore.getState().createNewProject())
const document = () => selectActiveCourseProjectDocument(useEditorStore.getState())!

describe('design production through the active editor transaction', () => {
  it('creates a Recipe with one undo and reopens the actual sorting component bytes', () => {
    const store = useEditorStore.getState()
    const context = store.prepareDesignProduction()!
    expect(store.applyCourseRecipe({ recipeId: 'classify-sort-v1', target: {
      projectId: context.document.id, revision: context.document.revision, locationId: context.sessionToken.locationId,
    }, slots: { ...recipeDefaults('classify-sort-v1'), mode: 'sort' } }, context.sessionToken)).toBe(true)
    const created = document()
    expect(Object.keys(useEditorStore.getState().componentPackages)).toHaveLength(1)
    useEditorStore.getState().undo()
    expect(document()).toEqual(context.document)
    expect(Object.keys(useEditorStore.getState().componentPackages)).toHaveLength(0)
    useEditorStore.getState().redo()
    expect(document()).toEqual(created)
    const bytes = useEditorStore.getState().exportV9SlideCandidateArchive()!
    useEditorStore.getState().createNewProject()
    expect(useEditorStore.getState().reopenV9SlideCandidateArchive(bytes)).toBe(true)
    expect(document()).toEqual(created)
    expect(Object.keys(componentPackagesToArchiveFiles(useEditorStore.getState().componentPackages))).toHaveLength(1)
  })

  it('commits batch edits in Flow as one history entry and rejects an old preview after an edit', () => {
    useEditorStore.getState().createNewFlowProject()
    const context = useEditorStore.getState().prepareDesignProduction()!
    const surface = context.document.surfaces.find(s => s.type === 'flow')!
    const block = surface.blocks.find(b => b.type === 'paragraph')!
    if (block.type !== 'paragraph') throw new Error('expected paragraph')
    // A fixture supplies existing user content; the action still uses the real Store.
    const fixture = structuredClone(context.document)
    const body = fixture.surfaces.find(s => s.type === 'flow')!
    const paragraph = body.blocks.find(b => b.id === block.id)!
    if (paragraph.type !== 'paragraph') throw new Error('expected paragraph')
    paragraph.text = '旧内容 旧内容'
    useEditorStore.getState().loadCourseProject(fixture, null)
    const live = useEditorStore.getState().prepareDesignProduction()!
    const preview = createTextReplacePreview(live, { scope: 'page', find: '旧内容', replacement: '新内容' })
    const result = applyProductivityPreview(live, preview, preview.items.map(item => item.id))
    if (!result.ok || !result.step) throw new Error('expected batch transaction')
    expect(useEditorStore.getState().commitDesignProduction(result.step, live.sessionToken)).toBe(true)
    expect(JSON.stringify(document())).toContain('新内容 新内容')
    expect(useEditorStore.getState().commitDesignProduction(result.step, live.sessionToken)).toBe(false)
    useEditorStore.getState().undo()
    expect(document()).toEqual(live.document)
  })

  it('locates a malformed ordinary single-choice family and overflowing fixed text', () => {
    const context = useEditorStore.getState().prepareDesignProduction()!
    expect(useEditorStore.getState().applyCourseRecipe({ recipeId: 'choice-feedback-v1', target: {
      projectId: context.document.id, revision: context.document.revision, locationId: context.sessionToken.locationId,
    }, slots: recipeDefaults('choice-feedback-v1') }, context.sessionToken)).toBe(true)
    const fixture = structuredClone(document())
    const surface = fixture.surfaces.find(s => s.type === 'slide')!
    const scene = surface.scenes.at(-1)!
    for (const rule of scene.interactions) for (const step of rule.actions) {
      if (step.action.type === 'course-state.set' && step.action.key.startsWith('single_choice_')) step.action.value = false
    }
    const text = scene.layerItems.find(item => item.kind === 'native' && item.content.nativeType === 'text')!
    if (text.kind !== 'native' || text.content.nativeType !== 'text') throw new Error('expected text')
    text.content.data.text = '一\n二\n三\n四\n五\n六'
    text.content.data.style.overflow = 'fixed'; text.frame.height = 30
    const findings = collectCourseProjectHealth(fixture, { assetFiles: {}, componentFiles: {} })
    expect(findings.find(f => f.code === 'text-capacity-overflow')?.target).toMatchObject({ kind: 'layer-item', layerItemId: text.layerItemId })
    const option = scene.layerItems.find(item => item.label === '选项 1')!
    expect(findings.find(f => f.code === 'interaction-single-choice-answer-inconsistent')?.target).toMatchObject({ kind: 'layer-item', owner: 'scene', sceneId: scene.id, layerItemId: option.layerItemId })
    // The same formal option may be moved to a shared global carrier. The
    // finding follows that object rather than assuming the rule's scene owner.
    scene.layerItems = scene.layerItems.filter(item => item.layerItemId !== option.layerItemId)
    fixture.globalLayerItems.push({ item: option, visibility: { mode: 'all', locationIds: [] }, plane: 'overlay' })
    const globalFindings = collectCourseProjectHealth(fixture, { assetFiles: {}, componentFiles: {} })
    expect(globalFindings.find(f => f.code === 'interaction-single-choice-answer-inconsistent')?.target).toMatchObject({ kind: 'layer-item', owner: 'global', layerItemId: option.layerItemId })
  })
})
