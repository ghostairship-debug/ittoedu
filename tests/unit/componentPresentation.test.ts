import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { render } from '@testing-library/react'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { resolveComponentOuterPresentation } from '../../src/shared/componentPresentation'
import { resolveFlowPaperBackground } from '../../src/shared/flowBodyPresentation'
import { InstanceView } from '../../src/renderer/documents/CourseV10DocumentView'
import { createComponentModelProjection } from '../../src/player/componentPlatform/modelProjection'
import type { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { mountV10Model } from '../../src/player/componentPlatform/ModelPlayer'
import { createTextComponentData } from '../../src/components/text/data'

function fixture(): CourseProjectV10 {
  return { schemaVersion: 10, id: 'presentation', revision: 0, title: 'Flow presentation',
    definitions: Object.fromEntries(['image', 'document-block', 'web'].map(key => [`guoling.${key}`, { id: `guoling.${key}`, role: 'content', implementation: { kind: 'builtin', key: `guoling.${key}` } }])),
    instances: {
      image: { id: 'image', definitionId: 'guoling.image', data: {}, frame: { width: 600, height: 300, transform: [1, 0, 0, 1, 0, 0] }, flowLayout: { width: 'wide', wrap: 'left' } },
      section: { id: 'section', definitionId: 'guoling.document-block', data: { type: 'section', collapsedByDefault: true }, childIds: ['image'] },
      group: { id: 'group', definitionId: 'guoling.web', data: {}, frame: { width: 600, height: 300, transform: [1, 0, 0, 1, 0, 0] }, childIds: ['child'] },
      child: { id: 'child', definitionId: 'guoling.image', data: {}, frame: { width: 200, height: 100, transform: [1, 0, 0, 1, 500, 250] } },
    }, surfaces: [{ id: 'flow', kind: 'flow', title: 'Flow', childIds: ['section', 'group'], flow: { layout: { readingWidth: 860, wideContentWidth: 1100, paperBackgroundColor: '#ffeedd' } } }],
    global: { underlay: [], overlay: [] }, assets: {} }
}

describe('shared component outer presentation', () => {
  it('scales real framed media in the wrapped lane while preserving its crop coordinate space', () => {
    const project = fixture(), image = project.instances.image
    const layout = resolveComponentOuterPresentation(project, image, { placement: 'flow', purpose: 'author', inlineSize: 300 })
    expect(layout.layoutInput).toEqual({ mode: 'flow-viewport', inlineSize: 600, blockSize: 300 })
    expect(layout.outerStyle).toMatchObject({ width: '48%', maxWidth: '48%', float: 'left' })
    expect(layout.stageStyle.height).toBe('150px')
    expect(layout.contentStyle).toMatchObject({ width: '600px', height: '300px', transform: 'scale(0.5) translate(0px,0px)' })
    const wide = resolveComponentOuterPresentation(project, { ...image, flowLayout: { width: 'wide' } }, { placement: 'flow', purpose: 'playback', inlineSize: 900 })
    expect(wide.stageStyle.height).toBe('450px')
    expect(wide.outerStyle.margin).toContain('calc((100% - min(1100px')
    expect(image.frame?.width).toBe(600)
  })

  it('shares assembly extent without stretching the root and makes section policy explicit', () => {
    const project = fixture()
    const group = resolveComponentOuterPresentation(project, project.instances.group, { placement: 'flow', purpose: 'author', inlineSize: 350 })
    expect(group.extent).toEqual({ x: 0, y: 0, width: 700, height: 350 })
    expect(group.contentStyle.width).toBe('600px')
    expect(group.stageStyle.height).toBe('175px')
    expect(group.childrenPlacement).toBe('free')
    const author = resolveComponentOuterPresentation(project, project.instances.section, { placement: 'flow', purpose: 'author', inlineSize: 700 })
    const player = resolveComponentOuterPresentation(project, project.instances.section, { placement: 'flow', purpose: 'playback', inlineSize: 700 })
    expect(author.section?.open).toBe(true)
    expect(player.section?.open).toBe(false)
    expect(author.childrenPlacement).toBe('flow')
    expect(author.extent).toBeNull()
  })

  it('paints explicit course or page backgrounds on the real paper and retains paper color fallback', () => {
    const project = fixture(), surface = project.surfaces[0]
    expect(resolveFlowPaperBackground(project, surface).color).toBe('#ffeedd')
    project.background = { color: '#123456', assetId: 'background', fit: 'contain' }
    expect(resolveFlowPaperBackground(project, surface)).toEqual({ color: '#123456', assetId: 'background', fit: 'contain' })
    surface.background = { mode: 'own', color: '#abcdef', fit: 'cover' }
    expect(resolveFlowPaperBackground(project, surface).color).toBe('#abcdef')
  })

  it('connects React and Player to the same frame decisions while retaining bound DOM and runtime section state', () => {
    const project = fixture()
    const react = render(createElement(InstanceView, { instance: project.instances.group, project, surfaceId: 'flow', selectedInstanceId: null, onSelect() {}, placement: 'flow' }))
    const root = document.createElement('div'); document.body.append(root)
    Object.defineProperties(root, { clientWidth: { value: 1200 }, clientHeight: { value: 800 } })
    const runtime = { bind: vi.fn(), bindTarget: vi.fn(), assetUrl: vi.fn() } as unknown as ComponentPlatformRuntime
    const projection = createComponentModelProjection({ root, runtime, signal: new AbortController().signal })
    const model = { kind: 'course-v10' as const, project, resources: { assets: {}, components: {} } }
    projection.sync(model)
    const component = root.querySelector<HTMLElement>('[data-component-object="group"]')!
    const reactContent = react.container.querySelector<HTMLElement>('[data-component-render="group"]')!
    const playerContent = component.querySelector<HTMLElement>('[data-component-runtime-root="group"]')!
    expect(playerContent.style.width).toBe(reactContent.style.width)
    expect(playerContent.style.transform).toBe(reactContent.style.transform)
    const section = root.querySelector<HTMLDetailsElement>('[data-component-object="section"] details')!
    expect(section.open).toBe(false)
    section.open = true
    projection.sync(model)
    expect(section.open).toBe(true)
    expect(root.querySelector('[data-component-runtime-root="group"]')).toBe(playerContent)
    expect(runtime.bind).toHaveBeenCalledTimes(4)
    projection.dispose(); react.unmount(); root.remove()
  })

  it('lets professional text participate in Flow floats and restores fixed-frame vertical alignment through the existing layout port', async () => {
    const project = fixture(), data = createTextComponentData('Keep the authored text')
    data.appearance.verticalAlign = 'middle'
    project.definitions.text = { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } }
    project.instances.text = { id: 'text', definitionId: 'text', data: JSON.parse(JSON.stringify(data)), frame: { width: 600, height: 300, transform: [1, 0, 0, 1, 0, 0] } }
    project.surfaces[0].childIds = ['text']
    project.surfaces.push({ id: 'slide', kind: 'slide', title: 'Slide', designSize: { width: 1280, height: 720 }, childIds: [] })
    const root = document.createElement('div'); document.body.append(root)
    const model = { kind: 'course-v10' as const, project, resources: { assets: {}, components: {} } }
    const player = mountV10Model({ root, model, runScopeId: 'text-flow' })
    try {
      await player.ready
      expect(root.querySelector<HTMLElement>('[data-text-component]')?.style).toMatchObject({ display: 'block', height: 'auto' })
      project.surfaces[0].childIds = []; project.surfaces[1].childIds = ['text']
      player.revealSurface('slide'); await player.update(model)
      const text = root.querySelector<HTMLElement>('[data-text-component]')!
      expect(text.style.display).toBe('flex')
      expect(text.style.justifyContent).toBe('center')
      expect(text.textContent).toBe('Keep the authored text')
      expect(project.instances.text.data).toEqual(data)
    } finally { await player.dispose(); root.remove() }
  })
})
