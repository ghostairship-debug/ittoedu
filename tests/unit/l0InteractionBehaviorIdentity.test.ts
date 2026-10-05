import { expect, it } from 'vitest'
import { componentRuleEdits, interactionBehavior } from '../../src/renderer/interactions/componentInteractionAuthoring'
import type { ComponentDefinition, CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'

it('reuses the first behavior of the selected target through alias and source professional definitions without adding a behavior', () => {
  const target = { kind: 'surface' as const, surfaceId: 'selected-page' }
  for (const implementation of [{ kind: 'builtin' as const, key: 'guoling.interactions' },
    { kind: 'source' as const, language: 'javascript' as const, source: 'export default {}' }]) {
    const definition: ComponentDefinition = { id: 'library-rebound-definition', role: 'behavior', implementation,
      professionalBuiltinKey: 'guoling.interactions' }
    const project: CourseProjectV10 = { schemaVersion: 10, id: 'fixture', title: 'Fixture', revision: 0,
      definitions: { [definition.id]: definition, 'guoling.interactions': { id: 'guoling.interactions', role: 'behavior',
        implementation: { kind: 'builtin', key: 'unrelated.program' } } },
      instances: {
        other: { id: 'other', definitionId: definition.id, data: { rules: [] }, attachments: [{ instanceId: 'other', target: { kind: 'surface', surfaceId: 'other-page' } }] },
        unrelated: { id: 'unrelated', definitionId: 'guoling.interactions', data: { rules: [] }, attachments: [{ instanceId: 'unrelated', target }] },
        selected: { id: 'selected', definitionId: definition.id, data: { rules: [] }, attachments: [{ instanceId: 'selected', target }] },
        later: { id: 'later', definitionId: definition.id, data: { rules: [] }, attachments: [{ instanceId: 'later', target }] },
      },
      surfaces: [{ id: 'selected-page', kind: 'slide', title: 'Selected', childIds: ['selected', 'later', 'unrelated'] },
        { id: 'other-page', kind: 'slide', title: 'Other', childIds: ['other'] }],
      assets: {}, global: { underlay: [], overlay: [] } }
    const before = structuredClone(project)
    expect(interactionBehavior(project, target)).toBe(project.instances.selected)
    expect(componentRuleEdits(project, target, [])).toEqual([{ type: 'data.set', instanceId: 'selected', path: ['rules'], value: [] }])
    expect(project).toEqual(before)
  }
})
