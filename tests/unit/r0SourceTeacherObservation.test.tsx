import { expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { mountV10Model } from '../../src/player/componentPlatform/ModelPlayer'
import { TeacherControllerAuthoringChrome } from '../../src/renderer/ui/TeacherControllerAuthoringChrome'
import type { CourseProjectV10, ComponentRuntimeContext } from '../../src/shared/contracts/component-platform'

it('keeps a rebound source Teacher in its custom frame outside observed content and default Editor chrome', async () => {
  const frame = { width: 420, height: 180, transform: [1, 0, 0, 1, 30, 40] as [number, number, number, number, number, number] }
  const project: CourseProjectV10 = { schemaVersion: 10, revision: 0, id: 'source-teacher', title: '自定义教师',
    definitions: { teacher: { id: 'teacher', role: 'mixed', professionalBuiltinKey: 'guoling.navigation', implementation: { kind: 'source', language: 'javascript', source: 'export default {mount(){}}' } },
      group: { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } } },
    instances: { teacher: { id: 'teacher', definitionId: 'teacher', data: {}, frame }, decoration: { id: 'decoration', definitionId: 'group', data: {}, frame } },
    surfaces: [{ id: 'slide', kind: 'slide', title: '演示', childIds: [], designSize: { width: 800, height: 600 } }, { id: 'flow', kind: 'flow', title: '讲义', childIds: [] }],
    global: { underlay: ['decoration'], overlay: ['teacher'] }, assets: {} }
  const before = structuredClone(project), chrome = render(<TeacherControllerAuthoringChrome item={project.instances.teacher} definition={project.definitions.teacher} />)
  expect(chrome.container.childElementCount).toBe(0); chrome.unmount()
  const root = document.createElement('div'); document.body.append(root)
  Object.defineProperties(root, { clientWidth: { value: 800 }, clientHeight: { value: 600 } })
  const mounts = vi.fn((context: ComponentRuntimeContext) => { const button = document.createElement('button'); button.textContent = '自定义教师'; context.root!.append(button); return { update() {}, dispose() { button.remove() } } })
  const player = mountV10Model({ root, model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } }, runScopeId: 'source-teacher', mode: 'edit',
    resolveSource: async () => ({ implementation: { mount: mounts } }) })
  try {
    await player.ready
    const teacher = player.runtime.targetElement('teacher')!, button = teacher.querySelector('button')!, transform = teacher.style.transform
    player.observation('slide')!.setZoom(2)
    expect(teacher.style.width).toBe('420px'); expect(teacher.style.height).toBe('180px')
    expect(teacher.style.transform).toBe(transform)
    expect(player.runtime.targetElement('decoration')!.style.transform).toContain('scale(2)')
    expect(teacher.closest('[data-playback-content]')).toBeNull()
    player.revealSurface('flow'); player.observation('flow')!.setZoom(1.5)
    expect(teacher.style.transform).not.toContain('scale(1.5)')
    expect(teacher.querySelector('button')).toBe(button); expect(mounts).toHaveBeenCalledTimes(1)
    expect(project).toEqual(before)
  } finally { await player.dispose(); root.remove() }
})
