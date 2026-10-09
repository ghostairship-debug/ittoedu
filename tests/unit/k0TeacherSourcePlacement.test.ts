import { afterEach, expect, it, vi } from 'vitest'
import { createTeacherControllerData, createTeacherControllerFrame } from '../../src/components/teacher-controller/data'
import { mountPublishedCourseV3 } from '../../src/player/componentPlatform/publishedPlayer'
import * as sandbox from '../../src/renderer/components/SandboxComponentImplementation'
import type { JsonValue } from '../../src/shared/contracts/component-platform'
import type { PublishedCourseV3, PublishedImplementation } from '../../src/shared/contracts/component-platform/published'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

it('moves custom Teacher implementations through the same view port after definition rebinding', async () => {
  vi.spyOn(sandbox, 'prepareSandboxComponent').mockResolvedValue({ implementation: { mount({ root }) {
    root!.textContent = '自定义控制台'; return { update() {}, dispose() {} }
  } } })
  const source: PublishedImplementation = { kind: 'source', language: 'javascript', source: 'export default {}', compiled: { code: 'export default {}' } }
  const data = JSON.parse(JSON.stringify(createTeacherControllerData())) as JsonValue
  const input: PublishedCourseV3 = { schemaVersion: 3, id: 'teacher-placement', title: '专业角色', assets: {},
    definitions: {
      rebound: { id: 'rebound', role: 'content', professionalBuiltinKey: 'guoling.navigation', implementation: source },
      independent: { id: 'independent', role: 'content', implementation: { kind: 'builtin', key: 'guoling.navigation' } },
    },
    instances: {
      shared: { id: 'shared', definitionId: 'rebound', data: structuredClone(data), frame: createTeacherControllerFrame() },
      local: { id: 'local', definitionId: 'independent', data: structuredClone(data), frame: createTeacherControllerFrame(), implementationOverride: source },
    },
    global: { underlay: [], overlay: ['shared', 'local'] }, surfaces: [{ id: 'page', title: 'Page', kind: 'slide', childIds: [] }],
  }
  const before = structuredClone(input), root = document.createElement('section'); document.body.append(root)
  Object.defineProperties(root, { clientWidth: { value: 1280 }, clientHeight: { value: 720 } })
  root.getBoundingClientRect = () => new DOMRect(0, 0, 1280, 720)
  const player = await mountPublishedCourseV3(input, root)
  try {
    for (const id of ['shared', 'local']) {
      expect(player.runtime.targetElement(id)!.parentElement!.dataset.componentPlane).toBe('hud')
      expect(player.runtime.targetElement(id)!.style.transform).toBe('matrix(1,0,0,1,200,638)')
    }
    player.navigation.moveBy(15, 20)
    expect(player.navigation.placement()).toMatchObject({ x: 15, y: 20 })
    for (const id of ['shared', 'local']) {
      expect(player.runtime.targetElement(id)!.style.transform).toBe('matrix(1,0,0,1,215,656)')
      expect(player.runtime.contentElement(id)!.textContent).toBe('自定义控制台')
    }
    player.navigation.resetView()
    for (const id of ['shared', 'local']) expect(player.runtime.targetElement(id)!.style.transform).toBe('matrix(1,0,0,1,200,638)')
    expect(input).toEqual(before)
  } finally { await player.dispose() }
})
