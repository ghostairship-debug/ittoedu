import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentAuthoringTargetUpdate, ComponentPackageData } from '@/shared/componentTypes'
import type { PublishedComponentLayerItem } from '@/shared/publishedCourseTypes'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { SlidePublishedAdapter } from '@/player/surfaces/slide/SlidePublishedAdapter'
import { publishedComponentAuthoringNode } from '@/player/surfaces/slide/publishedSlideAuthoringPatch'

function componentPackage(withHooks = true): ComponentPackageData {
  return {
    manifest: { schemaVersion: 4, runtimeApiVersion: 4, id: 'authoring.component', name: '文字组件', version: '1.0.0',
      entry: 'runtime.js', defaultSize: { width: 200, height: 60 }, minSize: { width: 100, height: 30 },
      preserveAspectRatio: false, supportedScopes: ['scene'], renderMode: 'dom', assets: {},
      defaultProps: { label: '初始文字' }, editor: { properties: [{ key: 'label', label: '文字', type: 'text' }] } },
    files: {},
    runtimeSource: `CoursewareComponent.define({ id: 'authoring.component', runtimeApiVersion: 4, create(ctx) {
      const element = document.createElement('span'); element.textContent = ctx.props.label; ctx.dom.root.append(element);
      let width = ctx.width;
      ctx.editor.registerTextRegion({ key: 'label', getBounds() { return { x: 10, y: 12, width: width / 2, height: 24 } } });
      return {
        ${withHooks ? 'resize(w) { width = w; ctx.editor.invalidate(); }, updateProps(props) { element.textContent = props.label; },' : ''}
        destroy() { element.remove(); }
      };
    } });`,
  }
}

async function mounted(withHooks = true) {
  const payload = buildPublishedCourseV2Payload({ project: createBlankCourseProject(), assetFiles: {}, components: {} })
  payload.globalLayerItems = []
  const surface = payload.surfaces.find(surface => surface.type === 'slide')!
  if (surface.type !== 'slide') throw new Error('expected Slide')
  const item: PublishedComponentLayerItem = { kind: 'component', layerItemId: 'editable', frame: { mode: 'absolute', x: 100, y: 80, width: 200, height: 60 },
    order: 1, visible: true, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    component: { packageId: 'authoring.component', version: '1.0.0' }, props: { label: '初始文字' } }
  surface.scenes[0]!.layerItems = [item]
  const updates: Readonly<ComponentAuthoringTargetUpdate>[] = []
  const adapter = new SlidePublishedAdapter(payload, surface.id, { authoring: { scope: 'scene', stateId: null,
    componentPackages: { 'authoring.component': componentPackage(withHooks) }, onComponentTargetsChanged: update => updates.push(update) } })
  const container = document.createElement('div'); document.body.append(container)
  await adapter.mount({ surfaceId: surface.id, container, signal: new AbortController().signal,
    services: { navigate: vi.fn(), getCourseState: vi.fn(), setCourseState: vi.fn(), resolveAsset: vi.fn() } })
  await adapter.activate()
  await Promise.resolve()
  let revision = 1
  const patch = (next: PublishedComponentLayerItem, generation = adapter.getAuthoringGeneration()) => adapter.applyAuthoringPatch(
    adapter.getAuthoringContext(), { kind: 'native-node', target: { kind: 'native-node', scope: 'scene', nodeId: item.layerItemId },
      node: publishedComponentAuthoringNode(next) }, { revision: revision++, generation })
  return { adapter, container, item, updates, patch }
}

afterEach(() => document.body.replaceChildren())

describe('Slide component authoring instance continuity', () => {
  it('keeps the instance and live target across first-click no-op, frame preview, resize and props updates', async () => {
    const { adapter, container, item, updates, patch } = await mounted()
    try {
      const text = container.querySelector('.published-component-mount')?.shadowRoot?.querySelector('span')!
      expect(text.textContent).toBe('初始文字')
      const targetId = updates.at(-1)!.targets[0]!.targetId
      const before = updates.length
      expect((await patch(item)).ok).toBe(true)
      const moved = { ...item, frame: { ...item.frame, x: 250, y: 180, width: 300 } }
      expect((await patch(moved)).ok).toBe(true)
      expect(container.querySelector('.published-component-mount')?.shadowRoot?.querySelector('span')).toBe(text)
      expect(updates.at(-1)!.targets[0]).toMatchObject({ targetId, bounds: { x: 260, y: 192, width: 150, height: 24 } })
      expect(updates.slice(before).every(update => update.targets.length === 1)).toBe(true)
      expect((await patch({ ...moved, props: { label: '已改文字' } })).ok).toBe(true)
      expect(container.querySelector('.published-component-mount')?.shadowRoot?.querySelector('span')).toBe(text)
      expect(text.textContent).toBe('已改文字')
      expect(updates.at(-1)!.targets[0]!.targetId).toBe(targetId)
      expect((await patch({ ...moved, visible: false })).ok).toBe(true)
      expect(updates.at(-1)!.targets).toEqual([])
      expect((await patch(moved)).ok).toBe(true)
      expect(updates.at(-1)!.targets[0]!.targetId).toBe(targetId)
    } finally { await adapter.destroy() }
  })

  it('retains no-op instances without update hooks but rebuilds actual unsupported changes and rejects stale or package-changing patches', async () => {
    const { adapter, container, item, updates, patch } = await mounted(false)
    try {
      const original = container.querySelector('.published-component-mount')?.shadowRoot?.querySelector('span')!
      expect((await patch(item)).ok).toBe(true)
      expect(container.querySelector('.published-component-mount')?.shadowRoot?.querySelector('span')).toBe(original)
      expect((await patch({ ...item, props: { label: '重建后文字' } })).ok).toBe(true)
      const replacement = container.querySelector('.published-component-mount')?.shadowRoot?.querySelector('span')!
      expect(replacement).not.toBe(original)
      expect(replacement.textContent).toBe('重建后文字')
      expect(updates.at(-1)!.targets).toHaveLength(1)
      expect(await patch(item, adapter.getAuthoringGeneration() - 1)).toMatchObject({ ok: false, code: 'stale-revision' })
      expect(await patch({ ...item, component: { ...item.component, version: '2.0.0' } })).toMatchObject({ ok: false, code: 'target-mismatch' })
      expect(container.querySelector('.published-component-mount')?.shadowRoot?.querySelector('span')).toBe(replacement)
    } finally { await adapter.destroy() }
  })
})
