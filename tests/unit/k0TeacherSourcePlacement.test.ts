import { afterEach, expect, it, vi } from 'vitest'
import { mountPublishedCourseV3 } from '../../src/player/componentPlatform/publishedPlayer'
import * as sandbox from '../../src/renderer/components/SandboxComponentImplementation'
import type { PublishedCourseV3, PublishedImplementation } from '../../src/shared/contracts/component-platform/published'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

it('moves custom Teacher implementations through the same view port after definition rebinding', async () => {
  vi.spyOn(sandbox, 'prepareSandboxComponent').mockResolvedValue({ implementation: { mount({ root }) {
    root!.textContent = '自定义控制台'; return { update() {}, dispose() {} }
  } } })
  const source: PublishedImplementation = { kind: 'source', language: 'javascript', source: 'export default {}', compiled: { code: 'export default {}' } }
  const input: PublishedCourseV3 = { schemaVersion: 3, id: 'teacher-placement', title: '专业角色', assets: {},
    definitions: {
      rebound: { id: 'rebound', role: 'content', professionalBuiltinKey: 'guoling.navigation', implementation: source },
      independent: { id: 'independent', role: 'content', implementation: { kind: 'builtin', key: 'guoling.navigation' } },
    },
    instances: {
      shared: { id: 'shared', definitionId: 'rebound', data: {} },
      local: { id: 'local', definitionId: 'independent', data: {}, implementationOverride: source },
    },
    global: { underlay: [], overlay: ['shared', 'local'] }, surfaces: [{ id: 'page', title: 'Page', kind: 'slide', childIds: [] }],
  }
  const before = structuredClone(input), root = document.createElement('section'); document.body.append(root)
  const player = await mountPublishedCourseV3(input, root)
  try {
    player.navigation.moveBy(15, 20)
    for (const id of ['shared', 'local']) {
      expect(player.runtime.targetElement(id)!.style.translate).toBe('15px 20px')
      expect(player.runtime.contentElement(id)!.textContent).toBe('自定义控制台')
    }
    player.navigation.resetView()
    expect(player.runtime.targetElement('shared')!.style.translate).toBe('0px 0px')
    expect(input).toEqual(before)
  } finally { await player.dispose() }
})
