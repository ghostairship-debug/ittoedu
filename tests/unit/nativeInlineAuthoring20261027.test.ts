import { afterEach, expect, it, vi } from 'vitest'
import { componentInlineChildAt, nativeInlineAuthorTarget } from '../../src/renderer/authoring/nativeInlineAuthoring'
import { visibleComponentAuthorHit } from '../../src/renderer/components/componentAuthorHit'
import { frameCorners, frameToSpaceMatrix, transformPoint } from '../../src/core/components/geometry'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'

const paint = vi.hoisted(() => ({ elements: [] as Element[] }))
vi.mock('../../src/components/web/paintHit', () => ({ componentPaintStack: () => paint.elements }))
afterEach(() => { paint.elements = []; document.body.replaceChildren() })

function fixture() {
  const frame = (x = 0, y = 0) => ({ width: 820, height: 80, transform: [1, 0, 0, 1, x, y] as [number, number, number, number, number, number] })
  const project: CourseProjectV10 = {
    schemaVersion: 11, id: 'inline-edit', revision: 0, title: 'inline edit', rootIds: ['page'],
    global: { underlay: [], overlay: [] }, assets: {}, definitions: {
      container: { id: 'container', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.slide' } },
      text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
      group: { id: 'group', role: 'content', implementation: { kind: 'builtin', key: 'guoling.group' } },
    }, instances: {
      page: { id: 'page', definitionId: 'container', data: {}, childIds: ['source'], container: { kind: 'slide', designSize: { width: 1200, height: 700 } } },
      source: { id: 'source', definitionId: 'container', data: {}, frame: frame(100, 100), childIds: ['native'],
        container: { kind: 'slide', designSize: { width: 1000, height: 480 } },
        implementationOverride: { kind: 'source', language: 'javascript', source: 'export default {}' } },
      native: { id: 'native', definitionId: 'text', data: {}, frame: frame(12, 10) },
    },
  }
  const workspace = document.createElement('div')
  workspace.style.transform = 'matrix(2,0,0,2,0,0)'
  workspace.innerHTML = '<div data-component-instance="source"><div data-component-inline-overlay="source">' +
    '<div data-component-inline-slot="native"><div data-component-runtime-root="native"><div data-component-instance-id="native">' +
    '<div data-text-component="true" style="width:820px;height:80px"><span>可见的原生文字</span></div></div></div></div></div></div>'
  document.body.append(workspace)
  const root = workspace.querySelector<HTMLElement>('[data-component-instance-id]')!
  Object.defineProperties(root, { offsetWidth: { value: 862 }, offsetHeight: { value: 102 } })
  root.getBoundingClientRect = () => new DOMRect(360, 757, 1724, 204)
  const nativeBox = root.querySelector<HTMLElement>('[data-text-component]')!
  nativeBox.getBoundingClientRect = () => new DOMRect(360, 757, 1640, 160)
  const text = root.querySelector('span')!, slot = workspace.querySelector<HTMLElement>('[data-component-inline-slot]')!
  return { project, workspace, root, text, slot, nativeBox }
}

it('keeps object selection at its container while naming the painted native inline child', async () => {
  const f = fixture()
  paint.elements = [f.text]
  expect(await visibleComponentAuthorHit(f.workspace, { x: 400, y: 780 }, () => undefined)).toEqual({
    instanceId: 'source', authorKey: null, inlineChild: { instanceId: 'native', ownerId: 'source' },
  })
  expect(componentInlineChildAt(f.slot)).toBeUndefined()
  f.root.dataset.componentInstanceId = 'retired-child'
  expect(componentInlineChildAt(f.text)).toBeUndefined()
})

it('projects the existing native editor into the real inline allocation without changing author geometry', () => {
  const f = fixture(), before = structuredClone(f.project)
  const target = nativeInlineAuthorTarget(f.project, 'page', null, f.workspace, 'native', [2, 0, 0, 2, 100, 50])
  expect(target).not.toBeNull()
  expect(frameToSpaceMatrix(target!.frame, target!.parentToSurface)).toEqual([1, 0, 0, 1, 130, 353.5])
  // The real native renderer uses its 820x80 authored box inside the larger
  // 862x102 allocation; editing must preserve its wrapping width and baseline.
  const corners = frameCorners(target!.frame, target!.parentToSurface).map(point => transformPoint([2, 0, 0, 2, 100, 50], point))
  const xs = corners.map(point => point.x), ys = corners.map(point => point.y), native = f.nativeBox.getBoundingClientRect()
  expect({ left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) })
    .toEqual({ left: native.left, top: native.top, width: native.width, height: native.height })
  expect(target!.frame).toBe(f.project.instances.native.frame)
  expect(f.project).toEqual(before)
  expect(nativeInlineAuthorTarget(f.project, 'page', null, f.workspace, 'native', [2, 0, 0, 2, 100, 50], 'other-owner')).toBeNull()
  const duplicate = f.slot.cloneNode(true) as HTMLElement, duplicateRoot = duplicate.querySelector<HTMLElement>('[data-component-instance-id]')!
  Object.defineProperties(duplicateRoot, { offsetWidth: { value: 862 }, offsetHeight: { value: 102 } })
  duplicateRoot.getBoundingClientRect = () => new DOMRect(360, 757, 1724, 204)
  f.slot.parentElement!.append(duplicate)
  expect(nativeInlineAuthorTarget(f.project, 'page', null, f.workspace, 'native', [2, 0, 0, 2, 100, 50], 'source')).toBeNull()
  duplicate.remove()

  f.project.instances.source.locked = true
  expect(nativeInlineAuthorTarget(f.project, 'page', null, f.workspace, 'native', [2, 0, 0, 2, 100, 50])).toBeNull()
  delete f.project.instances.source.locked
  f.project.instances.source.childIds = []
  expect(nativeInlineAuthorTarget(f.project, 'page', null, f.workspace, 'native', [2, 0, 0, 2, 100, 50])).toBeNull()
})

it('retains unopened ordinary-group boundaries and rejects Source overrides of native definitions', () => {
  const f = fixture()
  f.project.instances.page.childIds = ['group']
  f.project.instances.group = { id: 'group', definitionId: 'group', data: {}, childIds: ['source'] }
  expect(nativeInlineAuthorTarget(f.project, 'page', null, f.workspace, 'native', [2, 0, 0, 2, 100, 50])).toBeNull()
  expect(nativeInlineAuthorTarget(f.project, 'page', 'group', f.workspace, 'native', [2, 0, 0, 2, 100, 50])).not.toBeNull()
  f.project.instances.native.implementationOverride = { kind: 'source', language: 'javascript', source: 'export default {}' }
  expect(nativeInlineAuthorTarget(f.project, 'page', 'group', f.workspace, 'native', [2, 0, 0, 2, 100, 50])).toBeNull()
})
