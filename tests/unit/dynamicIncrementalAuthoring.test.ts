import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { createSortComponentPackage } from '@/renderer/recipes/sort-component/package'
import { parseComponentPackageFiles } from '@/renderer/components/importComponentPackage'
import { componentPackageTool, componentPackageAddress } from '@/renderer/authoring/tools/componentPackageTool'
import { componentConfigureTool } from '@/renderer/authoring/tools/componentConfigureTool'
import { executeAuthoringTool, type AuthoringToolDefinition } from '@/renderer/authoring/tools/executeAuthoringTool'
import { courseAuthoringScopeFromLocation, makeLayerItemAuthoringAddress } from '@/renderer/authoring/courseAuthoringScope'
import { applyEditorTransactionStep, type EditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import type { ComponentLayerItem } from '@/shared/courseProjectTypes'
import type { AuthoringToolDestinationV1 } from '@/shared/authoringToolContract'
import { dynamicBehaviorEvidenceSchema } from '@/shared/dynamicBehaviorObservation'

const mocks = vi.hoisted(() => ({ admission: vi.fn(), behavior: vi.fn(async (..._args: unknown[]) => []) }))
vi.mock('@/renderer/authoring/tools/dynamicCandidateAdmission', () => ({ admitDynamicCandidate: mocks.admission, verifyDynamicCandidateBehavior: mocks.behavior }))
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII='
const fileBytes = (files: Readonly<Record<string, Uint8Array>>) => Object.fromEntries(Object.entries(files).map(([path, bytes]) => [path, Array.from(bytes)]))
beforeEach(() => {
  mocks.admission.mockReset(); mocks.behavior.mockClear()
  mocks.admission.mockImplementation(async (_project, _resources, targets) => targets.flatMap((target: { locationId: string; instanceIds: string[] }) => target.instanceIds.map(instanceId => ({ instanceId, locationId: target.locationId, width: 1, height: 1, dataUrl: `data:image/png;base64,${png}` }))))
})

function fixture() {
  const project = createBlankCourseProject(), original = createSortComponentPackage(), encoder = new TextEncoder()
  const manifest = { ...original.manifest, editor: { properties: [{ type: 'number', key: 'speed', label: '速度', min: 0.1, max: 10 }] }, defaultProps: { ...original.manifest.defaultProps, speed: 1 } }
  const pkg = parseComponentPackageFiles({ ...original.files, 'manifest.json': encoder.encode(JSON.stringify(manifest)), 'notes.txt': encoder.encode('保留完整未改变文件'), 'unused.txt': encoder.encode('可显式删除') })
  project.componentPackages[pkg.manifest.id] = pkg.metadata
  const surface = project.surfaces[0]!; if (surface.type !== 'slide') throw new Error('Expected Slide')
  const item = (id: string, order: number): ComponentLayerItem => ({ kind: 'component', layerItemId: id, label: id, order,
    frame: { mode: 'absolute', x: 50, y: 60, width: 400, height: 300 }, visible: true, locked: false, rotation: 0, opacity: 1,
    hitPolicy: 'auto', playbackInitialVisibility: 'inherit', component: { packageId: pkg.manifest.id, version: pkg.manifest.version }, props: { speed: 1, content: { title: '保留' } } })
  surface.scenes[0]!.layerItems.push(item('one', 31), item('two', 32))
  let state = { document: project, resources: { assetFiles: {} as Record<string, Uint8Array>, componentPackages: { [pkg.manifest.id]: pkg } } }
  const commits: EditorTransactionStep[] = []
  const destination = (mode: 'shared' | 'instance', id = 'one'): AuthoringToolDestinationV1 => {
    const scope = courseAuthoringScopeFromLocation({ project: state.document, locationId: state.document.startLocationId, owner: mode === 'shared' ? 'global' : 'scene' })
    const itemId = mode === 'shared' ? pkg.manifest.id : id
    return { kind: 'update', target: { projectId: project.id, documentRevision: state.document.revision, revisionPolicy: { kind: 'exact' }, sessionGeneration: 1,
      surfaceType: 'slide', surfaceId: surface.id, locationId: scope.locationId, stateId: null, owner: scope.owner, ownerKey: scope.ownerKey, itemId,
      authoringAddress: mode === 'shared' ? componentPackageAddress(project.id, itemId) : makeLayerItemAuthoringAddress({ projectId: project.id, surfaceId: surface.id, sceneId: surface.scenes[0]!.id, owner: 'scene', kind: 'component', layerItemId: itemId }) } }
  }
  const patch = (mode: 'shared' | 'instance') => ({ operation: 'patch', mode, basePackageId: pkg.manifest.id, baseVersion: pkg.manifest.version, baseContentIdentity: pkg.contentSha256,
    changedFiles: { [pkg.manifest.entry]: { encoding: 'utf8', text: `${pkg.runtimeSource}\n// slower behavior source revision` } }, deleteFiles: [] as string[] })
  return { project, pkg, commits, read: () => state, destination, patch, async run<T>(tool: AuthoringToolDefinition<T>, input: unknown, target = destination('shared')) {
    return executeAuthoringTool({ version: 1, requestId: crypto.randomUUID(), tool: tool.name, destination: target, input }, tool, {
      readDocument: () => state.document, readResources: () => state.resources, validateDestination: () => null,
      commit(step) { const result = applyEditorTransactionStep(state, step, 'forward'); state = result as typeof state; commits.push(step); return true },
    })
  } }
}

describe('Incremental source files enter the existing package transaction', () => {
  it('merges unchanged files, explicitly deletes, revises all shared instances and undoes resources once', async () => {
    const f = fixture(), patch = f.patch('shared'); patch.deleteFiles = ['unused.txt']
    const receipt = await f.run(componentPackageTool, patch)
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed'); expect(f.commits).toHaveLength(1)
    const after = f.read().resources.componentPackages[f.pkg.manifest.id]!
    expect(Array.from(after.files['notes.txt']!)).toEqual(Array.from(f.pkg.files['notes.txt']!)); expect(after.files['unused.txt']).toBeUndefined()
    expect(after.runtimeSource).toContain('slower behavior'); expect(after.manifest.version).not.toBe(f.pkg.manifest.version)
    const surface = f.read().document.surfaces[0]!; if (surface.type !== 'slide') throw new Error('Expected Slide')
    expect(surface.scenes[0]!.layerItems.map(item => item.kind === 'component' && item.component.version)).toEqual([after.manifest.version, after.manifest.version])
    expect(mocks.admission).toHaveBeenCalledOnce()
    const undone = applyEditorTransactionStep(f.read(), f.commits[0]!, 'inverse')
    expect(undone.document).toEqual(f.project); expect(fileBytes(undone.resources.componentPackages[f.pkg.manifest.id]!.files)).toEqual(fileBytes(f.pkg.files))
    expect(applyEditorTransactionStep(undone, f.commits[0]!, 'forward')).toEqual(f.read())
  })
  it('forks only the selected instance and persists the changed source with one reversible resource step', async () => {
    const f = fixture(), receipt = await f.run(componentPackageTool, f.patch('instance'), f.destination('instance'))
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed'); expect(f.commits).toHaveLength(1)
    const surface = f.read().document.surfaces[0]!; if (surface.type !== 'slide') throw new Error('Expected Slide')
    const one = surface.scenes[0]!.layerItems[0]!, two = surface.scenes[0]!.layerItems[1]!
    if (one.kind !== 'component' || two.kind !== 'component') throw new Error('Expected components')
    expect(one.component.packageId).not.toBe(f.pkg.manifest.id); expect(two.component.packageId).toBe(f.pkg.manifest.id)
    const copy = f.read().resources.componentPackages[one.component.packageId]!
    expect(copy.runtimeSource).toContain(one.component.packageId); expect(copy.runtimeSource).toContain('slower behavior')
    expect(Array.from(copy.files['notes.txt']!)).toEqual(Array.from(f.pkg.files['notes.txt']!)); expect(fileBytes(f.read().resources.componentPackages[f.pkg.manifest.id]!.files)).toEqual(fileBytes(f.pkg.files))
    expect(one.props).toEqual({ speed: 1, content: { title: '保留' } }); expect(one.frame).toEqual(two.frame)
    expect(mocks.admission.mock.calls[0]![2]).toMatchObject([{ locationId: f.project.startLocationId, instanceIds: ['one'] }])
    expect(applyEditorTransactionStep(f.read(), f.commits[0]!, 'inverse').document).toEqual(f.project)
  })
  it.each(['baseline', 'delete-entry', 'same-file', 'wrong-scope', 'change-id'] as const)('rejects %s before live commit or dynamic admission', async failure => {
    const f = fixture(), patch = f.patch('shared')
    if (failure === 'baseline') patch.baseContentIdentity = '0'.repeat(64)
    if (failure === 'delete-entry') { patch.changedFiles = {}; patch.deleteFiles = [f.pkg.manifest.entry] }
    if (failure === 'same-file') patch.deleteFiles = [f.pkg.manifest.entry]
    if (failure === 'change-id') patch.changedFiles = { 'manifest.json': { encoding: 'utf8', text: JSON.stringify({ ...f.pkg.manifest, id: 'wrong.identity' }) } }
    const receipt = await f.run(componentPackageTool, patch, failure === 'wrong-scope' ? f.destination('instance') : f.destination('shared'))
    expect(receipt.status).toBe('failed'); expect(f.commits).toHaveLength(0); expect(f.read().document).toEqual(f.project); expect(mocks.admission).not.toHaveBeenCalled()
  })
})

describe('Validation follows the actual edit impact', () => {
  it('moves an instance without running code or changing package bytes', async () => {
    const f = fixture(), receipt = await f.run(componentConfigureTool, { properties: { frame: { x: 150 }, rotation: 23 } }, f.destination('instance'))
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed'); expect(mocks.admission).not.toHaveBeenCalled(); expect(mocks.behavior).not.toHaveBeenCalled()
    expect(f.read().resources.componentPackages[f.pkg.manifest.id]).toEqual(f.pkg)
  })
  it('validates legal public props and checks only affected behavior without full admission or package rewriting', async () => {
    const f = fixture(), receipt = await f.run(componentConfigureTool, { props: { speed: 0.5 } }, f.destination('instance'))
    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed'); expect(mocks.admission).not.toHaveBeenCalled(); expect(mocks.behavior).toHaveBeenCalledOnce()
    expect(mocks.behavior.mock.calls[0]![2]).toEqual([{ locationId: f.project.startLocationId, stateId: null, instanceIds: ['one'] }])
    expect(f.commits[0]!.resourceChanges.componentPackageChanges).toBeUndefined()
  })
  it('rejects a malformed public prop before host execution and does not reuse its prior behavior', async () => {
    const f = fixture(), receipt = await f.run(componentConfigureTool, { props: { speed: -1 } }, f.destination('instance'))
    expect(receipt.status).toBe('failed'); expect(f.commits).toHaveLength(0); expect(mocks.behavior).not.toHaveBeenCalled(); expect(mocks.admission).not.toHaveBeenCalled()
  })
  it('does not accept invented behavior success or an arbitrary action program', () => {
    expect(dynamicBehaviorEvidenceSchema.safeParse([{ status: 'passed', plan: [{ eval: 'spin()' }] }]).success).toBe(false)
  })
})
