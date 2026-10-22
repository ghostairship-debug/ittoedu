import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { createTestProjectFromLegacy, testContainerInstance } from '../helpers/glxWorkFixture'
import { afterEach, expect, it } from 'vitest'
import { createDomAuthoring } from '../../src/components/web/authoringDom'
import { refreshWebResourceReferences, resolveWebResourceBindings, webResourceReferenceMarker } from '../../src/components/web/resources'
import { extractComponentLibraryEntry } from '../../src/core/components/library/extract'
import { prepareComponentLibraryInsertion } from '../../src/core/components/library/insert'
import { componentAssetIds, rebindWebAssets } from '../../src/core/components/library/references'
import { exportComponentLibraryArchive, importComponentLibraryArchive } from '../../src/core/components/library/archive'
import { prepareCourseObjectPaste } from '../../src/core/course/courseObjectEdits'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentProjectFiles, componentProjectScopeFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { resolveComponentPresentation, type ComponentInstance, type CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { ComponentAuthorRecord } from '../../src/shared/contracts/component-platform/runtime'
import type { DocumentResources } from '../../src/shared/workbench/document'

afterEach(() => document.body.replaceChildren())
const token = 'cw-resource:replacement'
const sourceCode = 'export default { mount() { return { dispose() {} } } }'
const blank = (id: string): CourseProjectV10 => (createTestProjectFromLegacy({ schemaVersion: 10, id, revision: 0, title: id,
  definitions: {}, instances: {}, assets: {}, surfaces: [{ id: 'page', kind: 'slide', title: 'Page', childIds: [] }],
  global: { underlay: [], overlay: [] } }))
const record: ComponentAuthorRecord = { kind: 'image', binding: { kind: 'dom', path: [{ tag: 'img', index: 0, attributes: { id: 'photo' } }],
  baseline: 'cw-resource:original' }, overrides: { src: token } }

function fixture(sourceOwner: 'definition' | 'override' = 'override') {
  const project = blank('original'), resources: DocumentResources = { assets: {}, components: {} }
  const implementation = { kind: 'source' as const, language: 'javascript' as const, source: sourceCode }
  project.definitions.web = { id: 'web', role: 'content', ...(sourceOwner === 'definition'
    ? { professionalBuiltinKey: 'guoling.web', implementation } : { implementation: { kind: 'builtin', key: 'guoling.web' } }) }
  project.instances.web = { id: 'web', definitionId: 'web', data: {
    html: '<img id="photo" src="cw-resource:original"><img id="neighbor" src="neighbor.png">',
    resourceBindings: { 'cw-resource:original': 'original-photo' } },
    ...(sourceOwner === 'override' ? { implementationOverride: implementation } : {}),
    authoring: { records: { photo: structuredClone(record) }, resourceBindings: { [token]: 'base-photo' } } }
  project.instances.neighbor = { id: 'neighbor', definitionId: 'web', data: { html: '<p>Untouched neighbor</p>' },
    ...(sourceOwner === 'override' ? { implementationOverride: implementation } : {}) }
  testContainerInstance(project, 0).childIds = ['web', 'neighbor']
  testContainerInstance(project, 0).container.presentation = { states: [
    { id: 'alternate', title: 'Alternate', overrides: { web: { authoring: {
      records: { photo: structuredClone(record) }, resourceBindings: { [token]: 'state-photo' } } } } },
    { id: 'sibling', title: 'Sibling', overrides: {} },
  ] }
  for (const [id, color] of [['original-photo', 'red'], ['base-photo', 'green'], ['state-photo', 'blue'], ['unused', 'black']]) {
    const bytes = new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path fill="${color}" d="M0 0h1v1H0z"/></svg>`)
    project.assets[id] = { id, path: `assets/${id}.svg`, mimeType: 'image/svg+xml' }
    resources.assets[id] = bytes
  }
  return { project, resources }
}

/** Real resource projection and DOM record consumer; no browser image-decoding claim. */
function mountedImage(instance: ComponentInstance, urls: Record<string, string>): string | null {
  const projected = resolveWebResourceBindings(instance, id => urls[id])
  const data = projected.data as { html: string; resourceBindings?: Record<string, string> }
  const root = document.createElement('div'); document.body.append(root); root.innerHTML = data.html
  const consumer = createDomAuthoring(root, { records: () => instance.authoring?.records ?? {},
    resolveResource: reference => urls[data.resourceBindings?.[reference] ?? reference] })
  try {
    expect(root.querySelector('#neighbor')?.getAttribute('src')).toBe('neighbor.png')
    return root.querySelector('#photo')?.getAttribute('src') ?? null
  } finally { consumer.dispose(); root.remove() }
}

it.each(['definition', 'override'] as const)('closes %s Source image records through library archive, another project, cold reopen and Published states', async sourceOwner => {
  const { project, resources } = fixture(sourceOwner)
  const extracted = extractComponentLibraryEntry(project, resources, { id: 'photo-page', title: 'Photo page', surfaceIds: ['page'], kind: 'page' })
  expect(extracted.diagnostics).toEqual([])
  expect(Object.keys(extracted.entry.assets).sort()).toEqual(['base-photo', 'original-photo', 'state-photo'])
  const entry = importComponentLibraryArchive(exportComponentLibraryArchive(extracted.entry)).entry
  const destination = blank('destination'), driver = new CourseV10Driver()
  const insertion = prepareComponentLibraryInsertion(destination, entry, { container: { kind: 'surface', surfaceId: 'page' }, index: 0 })
  const reopened = driver.load(driver.serialize(driver.apply({ kind: 'course-v10', project: destination,
    resources: { assets: {}, components: {} } }, insertion.command)))
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
  const copiedId = insertion.identities.instances.get('web')!, copied = reopened.project.instances[copiedId]
  const newBase = insertion.identities.assets.get('base-photo')!, newState = insertion.identities.assets.get('state-photo')!
  expect(newBase).not.toBe('base-photo'); expect(newState).not.toBe('state-photo')
  expect(reopened.project.assets['base-photo']).toBeUndefined(); expect(reopened.project.assets['state-photo']).toBeUndefined()
  expect(new TextDecoder().decode(reopened.resources.assets[newBase])).toBe(new TextDecoder().decode(resources.assets['base-photo']))
  expect(new TextDecoder().decode(reopened.resources.assets[newState])).toBe(new TextDecoder().decode(resources.assets['state-photo']))
  expect(copied.authoring).toEqual({ records: { photo: record }, resourceBindings: { [token]: newBase } })
  expect(copied.implementationOverride ?? reopened.project.definitions[copied.definitionId].implementation).toMatchObject({ kind: 'source', source: sourceCode })
  const surfaceId = insertion.identities.surfaces.get('page')!, page = componentSurfaces(reopened.project).find(surface => surface.id === surfaceId)!
  const alternate = page.presentation!.states.find(state => state.title === 'Alternate')!, sibling = page.presentation!.states.find(state => state.title === 'Sibling')!
  const stateInstance = resolveComponentPresentation(reopened.project, surfaceId, alternate.id).instances[copiedId]
  expect(stateInstance.authoring?.resourceBindings?.[token]).toBe(newState)
  expect(resolveComponentPresentation(reopened.project, surfaceId, sibling.id).instances[copiedId].authoring?.resourceBindings?.[token]).toBe(newBase)
  expect(reopened.project.instances[insertion.identities.instances.get('neighbor')!].authoring).toBeUndefined()
  const scoped = componentProjectScopeFiles(reopened.project, componentProjectFiles(reopened.project, reopened.resources), { kind: 'instance', instanceId: copiedId })
  expect(scoped.some(file => file.binding?.kind === 'asset' && file.binding.assetId === newState)).toBe(true)
  const published = await buildPublishedCourseV3({ project: reopened.project, assetBytes: reopened.resources.assets })
  expect(Object.keys(published.payload.assets).sort()).toEqual([...insertion.identities.assets.values()].sort())
  const urls = Object.fromEntries(Object.entries(published.payload.assets).map(([id, asset]) => [id, asset.url!]))
  expect(urls[newState]).toMatch(/^data:image\/svg\+xml/)
  expect(mountedImage(copied, urls)).toBe(urls[newBase])
  expect(mountedImage(stateInstance, urls)).toBe(urls[newState])
  expect(published.payload.instances[copiedId].authoring).toEqual(copied.authoring)
  expect(componentSurfaces(published.payload).find(surface => surface.id === surfaceId)!.presentation!.states.find(state => state.id === alternate.id)!
    .overrides[copiedId].authoring).toEqual(stateInstance.authoring)
  expect(project.instances.web.authoring?.resourceBindings?.[token]).toBe('base-photo')
})

it('copies authoring-only state resources into a different document while retaining sibling state and data', () => {
  const { project, resources } = fixture(), destination = blank('destination'), driver = new CourseV10Driver()
  const plan = prepareCourseObjectPaste({ documentId: 'source', project, resources, roots: ['web'] }, {
    capturedTarget: { documentId: 'destination', project: destination, resources: { assets: {}, components: {} }, surfaceId: 'page' },
    container: { kind: 'surface', surfaceId: 'page' }, index: 0 })
  const reopened = driver.load(driver.serialize(driver.apply({ kind: 'course-v10', project: destination, resources: { assets: {}, components: {} } },
    captureComponentOperation(destination, plan.edits))))
  if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
  const id = plan.idMap.get('web')!, stateAsset = plan.assetIds.get('state-photo')!
  expect(new TextDecoder().decode(reopened.resources.assets[stateAsset])).toBe(new TextDecoder().decode(resources.assets['state-photo']))
  expect(reopened.project.instances[id].authoring?.resourceBindings?.[token]).toBe(plan.assetIds.get('base-photo'))
  expect(resolveComponentPresentation(reopened.project, 'page', 'alternate').instances[id].authoring?.resourceBindings?.[token]).toBe(stateAsset)
  expect(reopened.project.instances[id].authoring?.records?.photo.overrides.src).toBe(token)
  expect(reopened.project.instances.neighbor).toBeUndefined()
})

it('uses declared author bindings for any Source without treating arbitrary business data or record text as assets', () => {
  const definition = { id: 'custom', role: 'content' as const, implementation: { kind: 'source' as const, language: 'javascript' as const, source: sourceCode } }
  const instance: ComponentInstance = { id: 'custom', definitionId: definition.id,
    data: { assetId: 'ordinary-business-value', resourceBindings: { arbitrary: 'ordinary-business-value' }, text: token },
    authoring: { resourceBindings: { [token]: 'actual-photo' }, records: { photo: { ...record, overrides: { src: token, text: 'ordinary-business-value' } } } } }
  expect(componentAssetIds(instance, definition)).toEqual(['actual-photo'])
  const rebound = rebindWebAssets(instance, definition, { instances: new Map(), definitions: new Map(), components: new Map(), surfaces: new Map(),
    assets: new Map([['actual-photo', 'copied-photo'], ['ordinary-business-value', 'must-not-appear']]) })
  expect(rebound.data).toEqual(instance.data)
  expect(rebound.authoring?.resourceBindings?.[token]).toBe('copied-photo')
  expect(rebound.authoring?.records).toEqual(instance.authoring?.records)
})

it('projects the instance author binding over the same Web token without changing either formal table', () => {
  const instance: ComponentInstance = { id: 'web', definitionId: 'web', data: { html: `<img src="${token}">`, resourceBindings: { [token]: 'original' } },
    authoring: { resourceBindings: { [token]: 'replacement' } } }
  const result = resolveWebResourceBindings(instance, id => `https://example.test/${id}.png`)
  expect((result.data as { html: string }).html).toContain('https://example.test/replacement.png')
  expect((instance.data as { resourceBindings: Record<string, string> }).resourceBindings[token]).toBe('original')
  expect(instance.authoring?.resourceBindings?.[token]).toBe('replacement')
})

it('preserves published module metadata while projecting Web resources, including explicit undefined preparation fields', () => {
  for (const metadata of [
    { publishedModuleBundle: undefined, publishedDocumentBundles: undefined },
    { publishedModuleBundle: 'root prepared code', publishedDocumentBundles: { '0': 'nested prepared code' } },
  ]) {
    const instance: ComponentInstance = { id: 'web', definitionId: 'web', data: {
      html: `<img src="${token}">`, resourceBindings: { [token]: 'photo' }, moduleGraph: { modules: {}, entries: {} }, ...metadata,
    } as unknown as ComponentInstance['data'] }
    const result = resolveWebResourceBindings(instance, id => `https://example.test/${id}.png`).data as unknown as import('../../src/components/web/moduleGraph').WebRuntimeData
    expect(result.html).toContain('https://example.test/photo.png')
    expect(result.moduleGraph).toEqual({ modules: {}, entries: {} })
    expect(result.publishedModuleBundle).toBe(metadata.publishedModuleBundle)
    expect(result.publishedDocumentBundles).toEqual(metadata.publishedDocumentBundles)
  }
})

it('refreshes a binding-only image change while preserving the program own attribute edits', () => {
  const urls = { red: 'https://example.test/red.png', blue: 'https://example.test/blue.png' }
  const root = document.createElement('div'); document.body.append(root)
  const original = webResourceReferenceMarker({ src: token }, { [token]: 'red' }, id => urls[id as keyof typeof urls])!
  for (const src of [urls.red, 'program-image.png']) {
    const image = document.createElement('img'); image.setAttribute('src', src)
    image.setAttribute('data-component-resource-bindings', original); root.append(image)
  }
  refreshWebResourceReferences(root, urls, { [token]: 'blue' })
  expect([...root.querySelectorAll('img')].map(image => image.getAttribute('src'))).toEqual([urls.blue, 'program-image.png'])
  expect(JSON.parse(root.firstElementChild!.getAttribute('data-component-resource-bindings')!).assets[token]).toBe('blue')
})
