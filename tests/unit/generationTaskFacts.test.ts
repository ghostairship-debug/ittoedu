import { describe, it, expect } from 'vitest'
import { captureGenerationSnapshot } from '@/renderer/authoring/generation/generationSnapshot'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { createTextNode } from '@/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { createSortComponentPackage } from '@/renderer/recipes/sort-component/package'
import { parseComponentPackageFiles } from '../../src/core/drivers/codecs/importComponentPackage'
import { mergeComponentProps, resolveComponentEditorProperties, getComponentPropValue } from '@/shared/componentProps'
import { generationTaskFactsPromptProjection } from '@/shared/generationTaskFactsProjection'
import { generationRequestSchema } from '@/shared/generationContract'

function fixture(instruction = '修改所选文字') {
  const document = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const surface = document.surfaces[0]!
  if (surface.type !== 'slide') throw new Error('Slide')
  surface.scenes[0]!.layerItems.push(sceneNodeToCourseLayerItem(createTextNode({ id: 'text', text: '正文' }), 0))
  const capture = (selectedIds = ['text'], componentPackages = {}, stateId: string | null = null) => {
    const projection = projectEffectiveLayers({ project: document, locationId: document.startLocationId, stateId })
    return captureGenerationSnapshot({ document, workspace: { version: 1, projectId: document.id, normalizedPath: '/facts.h5lesson' },
      sessionToken: { locationId: document.startLocationId, surfaceType: 'slide', revision: document.revision, generation: 1 },
      projection, selectedIds, scope: 'selection', instruction, purpose: 'local-edit', componentPackages })
  }
  return { document, surface, capture }
}
describe('frozen task facts', () => {
  it('U04-component-parity preserves shared descriptors, effective content and named-state locks', () => {
    const { document, surface, capture } = fixture()
    const pkg = parseComponentPackageFiles(createSortComponentPackage().files)
    document.componentPackages[pkg.manifest.id] = pkg.metadata
    const props = { content: { title: '实例标题' } }
    surface.scenes[0]!.layerItems.push({ kind: 'component', layerItemId: 'component', label: '排序', order: 1,
      frame: { mode: 'absolute', x: 0, y: 0, width: 400, height: 300 }, visible: true, locked: false, rotation: 0, opacity: 1,
      hitPolicy: 'auto', playbackInitialVisibility: 'inherit', component: { packageId: pkg.manifest.id, version: pkg.manifest.version }, props })
    surface.scenes[0]!.presentation = { initialStateId: 'named', states: [{ id: 'named', name: '命名', layerItemOverrides: { component: { locked: true } } }] }
    const fact = capture(['component'], { [pkg.manifest.id]: pkg }, 'named').taskFacts!.components[0]!
    expect(fact.target.stateId).toBe('named')
    expect(fact.writable).toBe(false)
    expect(fact.fields.map(field => field.descriptor)).toEqual(resolveComponentEditorProperties(pkg.manifest, props))
    const effective = mergeComponentProps(pkg.manifest, props)
    for (const field of fact.fields) expect(field.value).toEqual(getComponentPropValue(effective, (field.descriptor as { key: string }).key))
    expect(fact.contentMerge).toBe('recursive-index-merge')
  })
  it('U04-frozen-scope binds indexes and same-plane geometry to one version without live aliasing', () => {
    const { document, surface, capture } = fixture('将图文对齐')
    const request = capture(), facts = request.taskFacts!
    expect(facts.indexes[0]).toMatchObject({ completeness: 'complete', scope: 'applicable-location-items', items: [{ id: 'text' }] })
    expect(facts.relations[0]).toMatchObject({ text: '正文', target: { itemId: 'text', documentRevision: document.revision } })
    surface.scenes[0]!.layerItems[0]!.frame.x += 200
    expect(facts.relations[0]!.frame.x).not.toBe(surface.scenes[0]!.layerItems[0]!.frame.x)
    expect(generationRequestSchema.safeParse({ ...request, taskFacts: { ...facts, documentRevision: facts.documentRevision + 1 } }).success).toBe(false)
  })
  
  
})
