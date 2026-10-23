import { expect, it } from 'vitest'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { resolveFlowChapterEntry } from '../../src/shared/flowChapterEntry'

function fixture(): CourseProjectV10 {
  return { schemaVersion: 11, id: 'chapters', revision: 0, title: 'Chapters', rootIds: ['flow'],
    entry: { rootInstanceId: 'flow' }, assets: {}, global: { underlay: [], overlay: [] },
    definitions: {
      flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      group: { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } },
      block: { id: 'block', role: 'content', implementation: { kind: 'builtin', key: 'guoling.document-block' } },
      text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
    }, instances: {
      flow: { id: 'flow', definitionId: 'flow', data: {}, container: { kind: 'flow' }, childIds: ['group'] },
      group: { id: 'group', definitionId: 'group', data: {}, style: { display: 'flex', padding: '150px 24px 0' }, childIds: ['intro', 'first', 'later'] },
      intro: { id: 'intro', definitionId: 'text', data: {} },
      first: { id: 'first', definitionId: 'block', data: { type: 'heading' }, style: { marginTop: '-120px', scrollMarginTop: '105px' } },
      later: { id: 'later', definitionId: 'block', data: { type: 'heading' } },
    } }
}

it('opens the first chapter at its existing reading group, preserving composition before the heading', () => {
  const project = fixture()
  expect(resolveFlowChapterEntry(project, 'flow', 'first')).toBe('group')
  expect(resolveFlowChapterEntry(project, 'flow', 'later')).toBe('later')
  expect(resolveFlowChapterEntry(project, 'flow', 'intro')).toBe('intro')
})

it('keeps explicit sections and opens their first heading at the nearest section', () => {
  const project = fixture()
  project.instances.group.childIds = ['section']
  project.instances.section = { id: 'section', definitionId: 'block', data: { type: 'section' }, childIds: ['intro', 'first', 'later'] }
  expect(resolveFlowChapterEntry(project, 'flow', 'section')).toBe('section')
  expect(resolveFlowChapterEntry(project, 'flow', 'first')).toBe('section')
  expect(resolveFlowChapterEntry(project, 'flow', 'later')).toBe('later')
})

it('does not cross containers, framed compositions, source objects or floating planes', () => {
  for (const boundary of ['container', 'frame', 'source', 'overlay'] as const) {
    const project = fixture(), group = project.instances.group
    if (boundary === 'container') group.container = { kind: 'flow' }
    if (boundary === 'frame') group.frame = { width: 800, height: 600, transform: [1, 0, 0, 1, 0, 0] }
    if (boundary === 'source') group.implementationOverride = { kind: 'source', language: 'javascript', source: 'export default {}' }
    if (boundary === 'overlay') group.flowPlacement = { space: 'paper', plane: 'overlay' }
    expect(resolveFlowChapterEntry(project, 'flow', 'first')).toBe('first')
  }
})

it('uses formal child order through reading groups and keeps nested sections as chapter boundaries', () => {
  const project = fixture()
  project.instances.group.childIds = ['nested', 'later']
  project.instances.nested = { id: 'nested', definitionId: 'group', data: {}, style: { display: 'grid' }, childIds: ['first'] }
  expect(resolveFlowChapterEntry(project, 'flow', 'first')).toBe('group')
  project.instances.nested = { id: 'nested', definitionId: 'block', data: { type: 'section' }, childIds: ['first'] }
  expect(resolveFlowChapterEntry(project, 'flow', 'first')).toBe('nested')
  expect(resolveFlowChapterEntry(project, 'flow', 'later')).toBe('later')
  expect(resolveFlowChapterEntry(project, 'missing', 'first')).toBe('first')
})
