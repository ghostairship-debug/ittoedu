import { expect, it, vi } from 'vitest'
import { webRuntimeTargetProfile } from '../../src/components/web/moduleGraph'
import { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

it('uses references only for known static projected Web, retaining every executable/unknown carrier', () => {
  const staticData = { html: '<h1>Title</h1><form><label for="a">Answer</label><input id="a" type="radio"><button type="reset">Reset</button></form>', css: 'input:checked + label{color:red}' }
  expect(webRuntimeTargetProfile('guoling.web', staticData)).toBe('references')
  for (const html of ['<script type="application/json">{}</script>', '<p onclick="answer()">A</p>',
    '<a href="java&#10;script:answer()">A</a>', '<iframe></iframe>', '<object></object>', '<embed>',
    '<template><p>A</p></template>', '<svg><foreignObject><p>A</p></foreignObject></svg>', '<custom-widget></custom-widget>',
    '<div a="1" a="2"></div>']) expect(webRuntimeTargetProfile('guoling.web', { html })).toBe('full')
  for (const data of [{ ...staticData, modules: {} }, { ...staticData, moduleGraph: { modules: {}, entries: {} } }, null, {}, { html: 3 }])
    expect(webRuntimeTargetProfile('guoling.web', data)).toBe('full')
  expect(webRuntimeTargetProfile('guoling.html-program', staticData)).toBe('full')
  // Source resolution supplies no builtin key, whether shared or instance-private.
  expect(webRuntimeTargetProfile(undefined, staticData)).toBe('full')
  expect(webRuntimeTargetProfile('other', staticData)).toBe('full')
})

it('constructs references without target/read/value and preserves full project/surface/unvisited data', async () => {
  const project: CourseProjectV10 = { schemaVersion: 10, id: 'refs-project', revision: 0, title: 'Formal',
    definitions: { web: { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } } },
    instances: { unvisited: { id: 'unvisited', definitionId: 'web', data: { html: '<p>Unvisited</p>', sentinel: 'formal' } } },
    surfaces: [{ id: 'unvisited-page', title: 'Unvisited page', kind: 'slide', childIds: ['unvisited'] }],
    global: { underlay: [], overlay: [] }, assets: {} }
  const world = new ComponentPlatformRuntime('target-profiles', { mode: 'edit' })
  try {
    await world.sync(project, { assets: {}, components: {} })
    const target = vi.spyOn(world as unknown as { target(reference: unknown): unknown }, 'target')
    const references = world.targetSnapshots('references')
    expect(target).not.toHaveBeenCalled()
    expect(references).toEqual([
      { reference: { kind: 'project' }, instanceId: 'refs-project' },
      { reference: { kind: 'surface', surfaceId: 'unvisited-page' }, instanceId: 'unvisited-page' },
      { reference: { kind: 'instance', instanceId: 'unvisited' }, instanceId: 'unvisited' },
    ])
    const full = world.targetSnapshots('full')
    expect(target).toHaveBeenCalledTimes(3)
    expect(full.map(item => item.value)).toEqual([project, project.surfaces[0], project.instances.unvisited.data])
    full[2]!.value = null
    expect(world.targetSnapshots()[2]!.value).toEqual(project.instances.unvisited.data)
  } finally { await world.dispose() }
})
