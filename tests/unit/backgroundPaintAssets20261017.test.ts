import { describe, expect, it } from 'vitest'
import type { ComponentBackground, CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import { componentBackgroundAssetIds } from '../../src/shared/componentBackgroundPaint'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { extractComponentLibraryEntry, prepareComponentLibraryInsertion } from '../../src/core/components/library'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { componentProjectFiles, componentProjectScopeFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { collectComponentProjectHealth } from '../../src/core/components/componentProjectHealth'

const paint = (...ids: string[]): ComponentBackground => ({ mode: 'own', paint: { layers: [
  { style: { 'background-image': 'linear-gradient(135deg,#fff,#def)' }, resourceBindings: {} },
  ...ids.map((id, index) => ({ style: { 'background-image': `url("cw-resource:layer-${index}")`,
    'background-size': 'contain', 'background-repeat': 'no-repeat' }, resourceBindings: { [`cw-resource:layer-${index}`]: id } })),
] } })

function fixture(): { project: CourseProjectV10; resources: { assets: Record<string, Uint8Array>; components: {} } } {
  const ids = ['course', 'page', 'state', 'legacy', 'unused']
  return { project: { schemaVersion: 10, id: 'background-assets', revision: 0, title: '背景资源',
    definitions: {}, instances: {}, global: { underlay: [], overlay: [] }, background: paint('course'),
    assets: Object.fromEntries(ids.map(id => [id, { id, path: `assets/${id}.svg`, mimeType: 'image/svg+xml' }])),
    surfaces: [
      { id: 'first', kind: 'slide', title: '首面', childIds: [], background: paint('page'),
        presentation: { states: [{ id: 'reveal', title: '展示', overrides: {}, background: paint('state') }] } },
      { id: 'inherited', kind: 'slide', title: '继承', childIds: [] },
      { id: 'old', kind: 'slide', title: '单图', childIds: [], background: { mode: 'own', assetId: 'legacy' } },
    ] },
    resources: { assets: Object.fromEntries(ids.map(id => [id, new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')])), components: {} } }
}

describe('formal background paint resource closure', () => {
  it('publishes project, surface and display-state paint bytes alongside legacy image backgrounds', async () => {
    const { project, resources } = fixture()
    const result = await buildPublishedCourseV3({ project, assetBytes: resources.assets })
    expect(Object.keys(result.payload.assets).sort()).toEqual(['course', 'legacy', 'page', 'state'])
    for (const asset of Object.values(result.payload.assets)) expect(asset.url).toMatch(/^data:image\/svg\+xml;base64,/)
    expect(result.payload.surfaces[0].presentation?.states[0].background).toEqual(project.surfaces[0].presentation?.states[0].background)
    expect(result.diagnostics).toEqual([])
  })

  it('protects every paint owner from asset deletion while allowing unused resources to be removed', () => {
    const { project, resources } = fixture()
    for (const assetId of ['course', 'page', 'state', 'legacy']) expect(() => applyComponentOperation(project,
      captureComponentOperation(project, [{ type: 'asset.remove', assetId }]), resources)).toThrow('素材仍被工程内容使用')
    const next = applyComponentOperation(project, captureComponentOperation(project, [{ type: 'asset.remove', assetId: 'unused' }]), resources)
    expect(next.assets.unused).toBeUndefined()
    expect(project.assets.unused).toBeDefined()
  })

  it('copies inherited and state paint resources into fresh library identities and saves them with their bytes', () => {
    const { project: source, resources } = fixture()
    source.surfaces[1].presentation = { states: [{ id: 'alternate', title: '另一背景', overrides: {}, background: paint('state') }] }
    const entry = extractComponentLibraryEntry(source, resources, { id: 'entry', title: '背景页', surfaceIds: ['inherited'] }).entry
    expect(Object.keys(entry.assets).sort()).toEqual(['course', 'state'])
    const { project: destination } = fixture()
    const insertion = prepareComponentLibraryInsertion(destination, entry, { container: { kind: 'surface', surfaceId: 'first' }, index: 0 })
    const driver = new CourseV10Driver()
    const reopened = driver.load(driver.serialize(driver.apply({ kind: 'course-v10', project: destination, resources }, insertion.command)))
    if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
    const surface = reopened.project.surfaces.find(value => value.id === insertion.identities.surfaces.get('inherited'))!
    for (const [background, original] of [[surface.background, 'course'], [surface.presentation?.states[0].background, 'state']] as const) {
      const mapped = insertion.identities.assets.get(original)!
      expect(mapped).not.toBe(original)
      expect(componentBackgroundAssetIds(background)).toEqual([mapped])
      expect(reopened.resources.assets[mapped]).toBeDefined()
    }
    expect(reopened.project.background).toEqual(destination.background)
    expect(entry.surfaces?.[0].background).toEqual(source.background)
    const sourceStyle = structuredClone(source.background!.paint!.layers[0].style)
    entry.surfaces![0].background!.paint!.layers[0].style['background-image'] = 'linear-gradient(#000,#123)'
    expect(source.background!.paint!.layers[0].style).toEqual(sourceStyle)
  })

  it('keeps missing paint references unresolved under fresh library identities', () => {
    const { project: source, resources } = fixture()
    delete source.assets.page
    delete resources.assets.page
    const extracted = extractComponentLibraryEntry(source, resources, { id: 'entry', title: '缺图页', surfaceIds: ['first'] })
    const { project: destination } = fixture()
    const insertion = prepareComponentLibraryInsertion(destination, extracted.entry, { container: { kind: 'surface', surfaceId: 'first' }, index: 0 })
    const next = applyComponentOperation(destination, insertion.command, resources)
    const surface = next.surfaces.find(value => value.id === insertion.identities.surfaces.get('first'))!
    const mapped = insertion.identities.assets.get('page')!
    expect(mapped).not.toBe('page')
    expect(componentBackgroundAssetIds(surface.background)).toEqual([mapped])
    expect(next.assets[mapped]).toBeUndefined()
    expect(next.assets.page).toEqual(destination.assets.page)
    expect(insertion.diagnostics.some(value => value.code === 'missing-asset' && value.message.includes('page'))).toBe(true)
  })

  it('includes paint dependencies in a surface file scope and reports broken project, surface and state references', () => {
    const { project, resources } = fixture()
    const files = componentProjectScopeFiles(project, componentProjectFiles(project, resources), { kind: 'surface', surfaceId: 'first' })
    expect(files.flatMap(file => file.binding?.kind === 'asset' ? [file.binding.assetId] : []).sort()).toEqual(['course', 'page', 'state'])
    for (const id of ['course', 'page', 'state']) delete project.assets[id]
    const findings = collectComponentProjectHealth(project, resources).filter(value => value.code === 'background-asset-reference-missing')
    expect(findings.map(value => value.path)).toEqual([
      ['background', 'paint'], ['surfaces', 0, 'background', 'paint'], ['surfaces', 0, 'presentation', 'states', 0, 'background', 'paint'],
    ])
    expect(findings.map(value => value.target.kind)).toEqual(['project', 'surface', 'surface'])
  })
})
