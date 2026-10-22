import { createTestProjectFromLegacy } from '../helpers/glxWorkFixture'
import { describe, expect, it } from 'vitest'
import { ComponentRuntimeWorld } from '../../src/player/components/ComponentRuntimeWorld'
import { popoverRuntimeImplementation } from '../../src/components/popover'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

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
})
