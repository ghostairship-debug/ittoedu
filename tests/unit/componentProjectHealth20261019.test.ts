import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parse } from '@babel/parser'
import { collectComponentProjectHealth } from '../../src/core/components/componentProjectHealth'
import { liveSourceOwners } from '../../src/core/components/compilation/liveSourceReferences'
import { createImageData } from '../../src/components/image/data'
import { createAudioData, createVideoData } from '../../src/components/media/data'
import { summarizeCourseProjectHealth } from '../../src/shared/componentProjectHealth'
import type { ComponentImplementation, CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import type { DocumentResources } from '../../src/shared/workbench/document'

vi.mock('../../src/core/components/compilation/liveSourceReferences', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/core/components/compilation/liveSourceReferences')>()
  return { ...actual, liveSourceOwners: vi.fn(actual.liveSourceOwners) }
})
vi.mock('@babel/parser', async importOriginal => {
  const actual = await importOriginal<typeof import('@babel/parser')>()
  return { ...actual, parse: vi.fn(actual.parse) }
})

const source = (text: string): ComponentImplementation => ({ kind: 'source', language: 'javascript', source: text })
const fixture = (): { project: CourseProjectV10; resources: DocumentResources } => ({
  project: createTestProjectFromLegacy({ schemaVersion: 10, id: 'health', revision: 0, title: '当前引用', definitions: {}, instances: {},
    surfaces: [{ id: 'slide', kind: 'slide', title: '当前页', childIds: [] }], global: { underlay: [], overlay: [] }, assets: {} }),
  resources: { assets: {}, components: {} },
})

beforeEach(() => { vi.mocked(liveSourceOwners).mockClear(); vi.mocked(parse).mockClear() })

describe('current component project health', () => {
  it('checks actual imported module identities, including transitive missing and builtin targets, while ignoring dormant bindings', () => {
    const { project, resources } = fixture()
    project.definitions.entry = { id: 'entry', role: 'content', implementation: {
      kind: 'source', language: 'javascript', source: 'import "./helper"; import "./builtin"',
      moduleBindings: { './helper': 'helper', './builtin': 'builtin', './unused': 'missing-unused' }, dependencies: ['stale-declaration'],
    } }
    project.definitions.helper = { id: 'helper', role: 'content', implementation: source('import "missing-import"') }
    project.definitions.builtin = { id: 'builtin', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
    project.instances.a = { id: 'a', definitionId: 'entry', data: {} }
    testContainerInstance(project, 0).childIds = ['a']
    const missing = collectComponentProjectHealth(project, resources).filter(value => value.code === 'source-dependency-missing')
    expect(missing).toHaveLength(2)
    expect(missing).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: expect.stringContaining('missing-import'), path: ['definitions', 'helper', 'implementation'] }),
      expect.objectContaining({ message: expect.stringContaining('builtin'), path: ['definitions', 'entry', 'implementation'] }),
    ]))
    expect(missing.every(value => !value.message.includes('missing-unused') && !value.message.includes('stale-declaration'))).toBe(true)
  })

  it('reads current workspace bytes once for shared instances and refreshes when source or binding changes', () => {
    const { project, resources } = fixture()
    const implementation: ComponentImplementation = { kind: 'source', language: 'javascript',
      workspace: { ownerId: 'files', entry: 'entry.js' }, moduleBindings: { './live': 'missing-first', './unused': 'missing-unused' } }
    project.definitions.entry = { id: 'entry', role: 'content', implementation }
    for (const id of ['a', 'b', 'c']) project.instances[id] = { id, definitionId: 'entry', data: {} }
    testContainerInstance(project, 0).childIds = ['a', 'b', 'c']
    resources.components.files = { 'entry.js': new TextEncoder().encode('import "./live"') }
    const findings = collectComponentProjectHealth(project, resources).filter(value => value.code === 'source-dependency-missing')
    expect(findings).toHaveLength(3)
    expect(findings.every(value => value.message.includes('missing-first'))).toBe(true)
    expect(liveSourceOwners).toHaveBeenCalledOnce()

    implementation.moduleBindings!['./live'] = 'missing-second'
    const rebound = collectComponentProjectHealth(project, resources).filter(value => value.code === 'source-dependency-missing')
    expect(rebound.every(value => value.message.includes('missing-second'))).toBe(true)
    resources.components.files['entry.js'] = new TextEncoder().encode('export default {}')
    expect(collectComponentProjectHealth(project, resources).filter(value => value.code === 'source-dependency-missing')).toEqual([])
    expect(liveSourceOwners).toHaveBeenCalledTimes(3)
  })

  it('uses professional image/media data for builtin, shared Source and instance override, without guessing arbitrary Source fields', () => {
    const { project, resources } = fixture()
    project.definitions.image = { id: 'image', role: 'content', implementation: { kind: 'builtin', key: 'guoling.image' } }
    project.definitions.customImage = { id: 'customImage', role: 'content', professionalBuiltinKey: 'guoling.image', implementation: source('export default {}') }
    project.definitions.audio = { id: 'audio', role: 'content', professionalBuiltinKey: 'guoling.audio', implementation: source('export default {}') }
    project.definitions.video = { id: 'video', role: 'content', implementation: { kind: 'builtin', key: 'guoling.video' } }
    project.definitions.free = { id: 'free', role: 'content', implementation: source('export default {}') }
    project.instances.image = { id: 'image', definitionId: 'image', data: createImageData('missing-builtin') }
    project.instances.customImage = { id: 'customImage', definitionId: 'customImage', data: createImageData('missing-shared') }
    project.instances.override = { id: 'override', definitionId: 'image', data: createImageData('missing-override'), implementationOverride: source('export default {}') }
    project.instances.audio = { id: 'audio', definitionId: 'audio', data: createAudioData('missing-audio') }
    project.instances.video = { id: 'video', definitionId: 'video', data: {
      ...createVideoData('missing-video'), poster: { mode: 'image', time: 0, assetId: 'missing-poster' },
    } }
    project.instances.free = { id: 'free', definitionId: 'free', data: { assetId: 'arbitrary-json', originalAssetId: 'arbitrary-json' } }
    testContainerInstance(project, 0).childIds = Object.keys(project.instances).filter(id => !project.instances[id].container)
    const findings = collectComponentProjectHealth(project, resources).filter(value => value.code.endsWith('-asset-reference-missing'))
    expect(findings.map(value => value.path)).toEqual([
      ['instances', 'image', 'data', 'assetId'], ['instances', 'customImage', 'data', 'assetId'],
      ['instances', 'override', 'data', 'assetId'], ['instances', 'audio', 'data', 'assetId'],
      ['instances', 'video', 'data', 'assetId'], ['instances', 'video', 'data', 'poster', 'assetId'],
    ])
    expect(summarizeCourseProjectHealth(findings)).toEqual({ error: 6, warning: 0, info: 0, total: 6, canExport: false })
  })

  it('parses a shared helper once across roots while resolving identical entry text with each owner binding', () => {
    const { project, resources } = fixture()
    const entryText = 'import "helper"; import "./binding"', helperText = 'export const value = true'
    project.definitions.helper = { id: 'helper', role: 'content', implementation: source(helperText) }
    for (const id of ['a', 'b']) {
      project.definitions[id] = { id, role: 'content', implementation: { kind: 'source', language: 'javascript',
        source: entryText, moduleBindings: { './binding': `missing-${id}` } } }
      project.instances[id] = { id, definitionId: id, data: {} }
    }
    testContainerInstance(project, 0).childIds = ['a', 'b']
    const findings = collectComponentProjectHealth(project, resources).filter(value => value.code === 'source-dependency-missing')
    expect(findings).toEqual([
      expect.objectContaining({ message: expect.stringContaining('missing-a'), target: expect.objectContaining({ instanceId: 'a' }) }),
      expect.objectContaining({ message: expect.stringContaining('missing-b'), target: expect.objectContaining({ instanceId: 'b' }) }),
    ])
    expect(vi.mocked(parse).mock.calls.filter(([text]) => text === helperText)).toHaveLength(1)
    expect(vi.mocked(parse).mock.calls.filter(([text]) => text === entryText)).toHaveLength(1)
    expect(liveSourceOwners).toHaveBeenCalledTimes(2)
  })

  it('reuses failed syntax analysis without losing each unfinished owner binding', () => {
    const { project, resources } = fixture()
    const unfinished = 'export const ='
    for (const id of ['a', 'b']) {
      project.definitions[id] = { id, role: 'content', implementation: { kind: 'source', language: 'javascript',
        source: unfinished, moduleBindings: { './binding': `missing-${id}` } } }
      project.instances[id] = { id, definitionId: id, data: {} }
    }
    testContainerInstance(project, 0).childIds = ['a', 'b']
    const findings = collectComponentProjectHealth(project, resources).filter(value => value.code === 'source-dependency-missing')
    expect(findings.map(value => value.message)).toEqual([
      expect.stringContaining('missing-a'), expect.stringContaining('missing-b'),
    ])
    // The existing JS/TS and JSX attempts both fail once; the next root reuses that result.
    expect(vi.mocked(parse).mock.calls.filter(([text]) => text === unfinished)).toHaveLength(2)
  })
})
