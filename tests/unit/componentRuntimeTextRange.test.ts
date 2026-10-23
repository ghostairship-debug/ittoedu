import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComponentRuntimeWorld } from '../../src/player/components/ComponentRuntimeWorld'
import { popoverRuntimeImplementation } from '../../src/components/popover'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

afterEach(() => vi.restoreAllMocks())

const splitRangeProject = () => createTestProjectFromLegacy({ schemaVersion: 10, revision: 0, id: 'split-range', title: 'Split range',
  definitions: { body: { id: 'body', role: 'content', implementation: { kind: 'builtin', key: 'test.body' } },
    popover: { id: 'popover', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.popover' } } },
  instances: {
    first: { id: 'first', definitionId: 'body', data: { content: { inlines: [{ type: 'text', text: 'First half', rangeIds: ['range'] }] } } },
    second: { id: 'second', definitionId: 'body', data: { content: { inlines: [{ type: 'text', text: 'Second half', rangeIds: ['range'] }] } } },
    popover: { id: 'popover', definitionId: 'popover', data: { label: 'Details', content: 'One shared note' },
      attachments: ['first', 'second'].map(instanceId => ({ instanceId: 'popover', target: { kind: 'text-range', instanceId, dataPath: ['content'], rangeId: 'range' } })) },
  }, surfaces: [{ id: 'surface', kind: 'flow', title: 'Flow', childIds: ['first', 'second', 'popover'] }], global: { underlay: [], overlay: [] }, assets: {} })

const paintRange = (root: HTMLElement, text: string) => {
  root.innerHTML = `<p data-document-path="[&quot;content&quot;]"><span data-document-range="range">${text}</span></p>`
  return root.querySelector<HTMLElement>('[data-document-range]')!
}

async function mountSplitRange(project = splitRangeProject(), paintFirst = true) {
  const firstRoot = document.createElement('div'), secondRoot = document.createElement('div'), diagnostics: string[] = []
  document.body.append(firstRoot, secondRoot)
  if (paintFirst) paintRange(firstRoot, 'First half')
  paintRange(secondRoot, 'Second half')
  const world = new ComponentRuntimeWorld('split-range', { mode: 'edit', report: message => diagnostics.push(message),
    builtins: new Map([['test.body', { mount: () => ({ update() {}, dispose() {} }) }], ['guoling.popover', popoverRuntimeImplementation]]) })
  world.bindTarget('first', firstRoot); world.bindTarget('second', secondRoot)
  await world.sync(project, { assets: {}, components: {} })
  return { world, firstRoot, secondRoot, diagnostics,
    dispose: async () => { await world.dispose(); firstRoot.remove(); secondRoot.remove() } }
}

describe('runtime range attachment DOM readiness', () => {
  it('waits for the connected current author range and binds after its same-root paint', async () => {
    const project: CourseProjectV10 = createTestProjectFromLegacy({ schemaVersion: 10, revision: 0, id: 'range-ready', title: 'Range readiness',
      definitions: { body: { id: 'body', role: 'content', implementation: { kind: 'builtin', key: 'test.body' } },
        popover: { id: 'popover', role: 'behavior', implementation: { kind: 'builtin', key: 'guoling.popover' } } },
      instances: { body: { id: 'body', definitionId: 'body', childIds: ['popover'], data: { content: { inlines: [
        { type: 'text', text: 'Current range', rangeIds: ['range'] }] } } },
        popover: { id: 'popover', definitionId: 'popover', data: { label: 'Details', content: 'Actual range details' },
          attachments: [{ instanceId: 'popover', target: { kind: 'text-range', instanceId: 'body', dataPath: ['content'], rangeId: 'range' } }] } },
      surfaces: [{ id: 'surface', kind: 'flow', title: 'Flow', childIds: ['body'] }], global: { underlay: [], overlay: [] }, assets: {} })
    const diagnostics: string[] = [], authorRoot = document.createElement('div'), hiddenProjection = document.createElement('div')
    document.body.append(authorRoot, hiddenProjection)
    const world = new ComponentRuntimeWorld('range-ready', { mode: 'edit', report: message => diagnostics.push(message),
      builtins: new Map([['test.body', { mount: async () => ({ update() {}, dispose() {} }) }], ['guoling.popover', popoverRuntimeImplementation]]) })
    world.bind('body', hiddenProjection)
    world.bindTarget('body', authorRoot)
    await world.sync(project, { assets: {}, components: {} })
    expect(diagnostics).toEqual([])
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    authorRoot.innerHTML = '<p data-document-path="[&quot;content&quot;]"><span data-document-range="range">Current range</span></p>'
    // The editor has painted within its existing registered paragraph root.
    world.bindTarget('body', authorRoot)
    world.notifyTextRanges('body')
    await world.sync(project, { assets: {}, components: {} })
    const range = authorRoot.querySelector<HTMLElement>('[data-document-range]')!
    expect(range.getAttribute('role')).toBe('button')
    range.click()
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.hidden).toBe(false)
    expect(dialog.textContent).toContain('Actual range details')
    expect(hiddenProjection.querySelector('[role="button"]')).toBeNull()
    // A state/list change moves the same authored range into another real slot.
    project.instances.body!.data = { citation: { inlines: [{ type: 'text', text: 'Moved range', rangeIds: ['range'] }] } }
    authorRoot.innerHTML = '<p data-document-path="[&quot;citation&quot;]"><span data-document-range="range">Moved range</span></p>'
    await world.sync(project, { assets: {}, components: {} })
    world.notifyTextRanges('body')
    await world.sync(project, { assets: {}, components: {} })
    const moved = authorRoot.querySelector<HTMLElement>('[data-document-range]')!
    expect(moved.getAttribute('role')).toBe('button')
    moved.click(); moved.click()
    expect(dialog.hidden).toBe(false)
    expect(diagnostics).toEqual([])
    await world.dispose()
    authorRoot.remove(); hiddenProjection.remove()
  })

  it('opens one shared note from both halves and positions and returns focus at the triggering half', async () => {
    const project = splitRangeProject()
    // Multiple attachment references can resolve to one span; it still gets one handler.
    project.instances.popover!.attachments!.push(structuredClone(project.instances.popover!.attachments![0]!))
    const original = structuredClone(project), fixture = await mountSplitRange(project)
    try {
      const first = fixture.firstRoot.querySelector<HTMLElement>('[data-document-range]')!, second = fixture.secondRoot.querySelector<HTMLElement>('[data-document-range]')!
      vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1200)
      vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(900)
      vi.spyOn(first, 'getBoundingClientRect').mockReturnValue({ left: 40, bottom: 60 } as DOMRect)
      vi.spyOn(second, 'getBoundingClientRect').mockReturnValue({ left: 400, bottom: 460 } as DOMRect)
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
      first.click()
      expect(dialog.hidden).toBe(false)
      expect(dialog.style.left).toBe('40px')
      second.click()
      expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1)
      expect(dialog.hidden).toBe(false)
      expect(dialog.textContent).toContain('One shared note')
      expect(dialog.style.left).toBe('400px')
      expect(dialog.style.top).toBe('468px')
      dialog.querySelector('button')!.click()
      expect(dialog.hidden).toBe(true)
      expect(document.activeElement).toBe(second)
      expect(fixture.world.stateSnapshot()).toEqual({ 'interaction:popover': false })
      expect(project).toEqual(original)
      expect(fixture.diagnostics).toEqual([])
    } finally { await fixture.dispose() }
  })

  it('projects from a later range when the first has no DOM and keeps it usable while the first is hidden', async () => {
    const fixture = await mountSplitRange(undefined, false)
    try {
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!, second = fixture.secondRoot.querySelector<HTMLElement>('[data-document-range]')!
      expect(dialog).not.toBeNull()
      expect(second.getAttribute('role')).toBe('button')
      second.click()
      expect(dialog.hidden).toBe(false)
      dialog.querySelector('button')!.click()
      const first = paintRange(fixture.firstRoot, 'First half')
      fixture.firstRoot.hidden = true
      fixture.world.notifyTextRanges('first')
      expect(first.getAttribute('role')).toBe('button')
      second.click()
      expect(dialog.hidden).toBe(false)
      dialog.querySelector('button')!.click()
      expect(document.activeElement).toBe(second)
      expect(fixture.diagnostics).toEqual([])
    } finally { await fixture.dispose() }
  })

  it('rebinds the later body after its DOM is replaced and after the other target is deleted', async () => {
    let project = splitRangeProject()
    const fixture = await mountSplitRange(project)
    try {
      const first = fixture.firstRoot.querySelector<HTMLElement>('[data-document-range]')!, oldSecond = fixture.secondRoot.querySelector<HTMLElement>('[data-document-range]')!
      const second = paintRange(fixture.secondRoot, 'Repainted second half')
      fixture.world.notifyTextRanges('second')
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
      expect(oldSecond.getAttribute('role')).toBeNull()
      second.click()
      expect(dialog.hidden).toBe(false)
      dialog.querySelector('button')!.click()
      project = structuredClone(project)
      delete project.instances.first
      const flow = Object.values(project.instances).find(instance => instance.childIds?.includes('first'))!
      flow.childIds = flow.childIds!.filter(id => id !== 'first')
      project.instances.popover!.attachments = project.instances.popover!.attachments!.filter(attachment => attachment.target.kind !== 'text-range' || attachment.target.instanceId !== 'first')
      fixture.firstRoot.remove()
      await fixture.world.sync(project, { assets: {}, components: {} })
      expect(first.getAttribute('role')).toBeNull()
      const replacement = paintRange(fixture.secondRoot, 'Remaining second half')
      fixture.world.notifyTextRanges('second')
      expect(second.getAttribute('role')).toBeNull()
      replacement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      expect(dialog.hidden).toBe(false)
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      expect(dialog.hidden).toBe(true)
      expect(document.activeElement).toBe(replacement)
      expect(fixture.diagnostics).toEqual([])
    } finally { await fixture.dispose() }
  })

  it('keeps a normal popover button working without range attachments', async () => {
    const project = splitRangeProject(), root = document.createElement('div')
    delete project.instances.popover!.attachments
    document.body.append(root)
    const world = new ComponentRuntimeWorld('plain-popover', { mode: 'edit', builtins: new Map([['guoling.popover', popoverRuntimeImplementation]]) })
    world.bind('popover', root)
    try {
      await world.sync(project, { assets: {}, components: {} })
      const button = root.querySelector('button')!, dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
      button.click()
      expect(dialog.hidden).toBe(false)
      dialog.querySelector('button')!.click()
      expect(dialog.hidden).toBe(true)
      expect(document.activeElement).toBe(button)
    } finally { await world.dispose(); root.remove() }
  })
})
