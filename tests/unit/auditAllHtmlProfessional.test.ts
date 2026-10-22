import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { createTestProjectFromLegacy, testContainerInstance } from '../helpers/glxWorkFixture'
import { describe, expect, it } from 'vitest'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { createImageData } from '../../src/components/image/data'
import { IMAGE_DEFINITION } from '../../src/components/image'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { buildFlowPropertiesOwner } from '../../src/renderer/ui/properties/FlowPropertiesContextBuilder'
import { selectProjectLibraryDefinitions } from '../../src/renderer/components/componentLibraryModel'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

const project = (): CourseProjectV10 => (createTestProjectFromLegacy({ schemaVersion: 10, id: 'professional', revision: 0, title: 'Professional', definitions: {}, instances: {}, surfaces: [{ id: 'flow', kind: 'flow', title: 'Flow', childIds: [] }], global: { underlay: [], overlay: [] }, assets: {} }))
const source = { kind: 'source' as const, language: 'javascript' as const, source: 'export default {mount(){return {update(){},dispose(){}}}}' }
describe('R45 professional semantics', () => {
  it('CA009 serializer applies the professional parser to a rebound source definition', () => {
    const p = project(); p.definitions.libraryImage = { ...IMAGE_DEFINITION, id: 'libraryImage', professionalBuiltinKey: IMAGE_DEFINITION.id, implementation: source }
    p.instances.image = { id: 'image', definitionId: 'libraryImage', data: {} }; testContainerInstance(p, 0).childIds = ['image']
    expect(() => new CourseV10Driver().serialize({ kind: 'course-v10', project: p, resources: { assets: {}, components: {} } })).toThrow()
  })
  it('CA009 validates actual professional data supplied by named presentation states', () => {
    const p = project(); p.definitions[IMAGE_DEFINITION.id] = IMAGE_DEFINITION; p.assets.image = { id: 'image', path: 'assets/image.svg' }
    p.instances.image = { id: 'image', definitionId: IMAGE_DEFINITION.id, data: createImageData('image') as any }; testContainerInstance(p, 0).childIds = ['image']
    testContainerInstance(p, 0).container.presentation = { states: [{ id: 'broken', title: 'Broken', overrides: { image: { data: {} } } }] }
    expect(() => new CourseV10Driver().serialize({ kind: 'course-v10', project: p, resources: { assets: { image: new TextEncoder().encode('<svg/>') }, components: {} } })).toThrow()
  })
  it('CA219 routes an opaque private text implementation to component properties', () => {
    const p = project(); p.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    p.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('正文') as any, implementationOverride: source }; testContainerInstance(p, 0).childIds = ['text']
    const owner = buildFlowPropertiesOwner({ read: { project: p, surface: componentSurfaces(p)[0], selectedInstance: p.instances.text, selectedIsGlobal: false, selectedInstanceIds: ['text'] } as any,
      kernel: {} as any, actions: {} as any, documentSelection: null, selectedContext: null, assets: {}, liveTarget: () => ({} as any), submit() {}, preview() {}, report() {} })
    expect(owner?.block?.type).toBe('course-instance'); expect(owner?.kind).toBe('flow-component')
  })
  it('CA256 exposes an authored shared source while preserving its professional identity', () => {
    const authored = { ...TEXT_DEFINITION, professionalBuiltinKey: TEXT_DEFINITION.id, implementation: source }
    expect(selectProjectLibraryDefinitions({ [authored.id]: authored })).toEqual([authored])
    expect(selectProjectLibraryDefinitions({ [TEXT_DEFINITION.id]: TEXT_DEFINITION })).toEqual([])
  })
})
