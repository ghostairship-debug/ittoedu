import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { render } from '@testing-library/react'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import type { ComponentPlatformRuntime } from '../../src/player/components/ComponentPlatformRuntime'
import { createTextComponentData } from '../../src/components/text/data'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { componentFileContentSource } from '../../src/core/projectFiles/componentPlatform/coordinator'
import { planContentApply } from '../../src/main/workbench/contentApply/application/plan'
import { applyComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { flowStickyStyle } from '../../src/shared/flowNativeLayout'
import { resolveComponentOuterPresentation } from '../../src/shared/componentPresentation'
import { createComponentModelProjection } from '../../src/player/componentPlatform/modelProjection'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { InstanceView } from '../../src/renderer/documents/CourseV10DocumentView'
import { createFlowBlockPaint } from '../../src/renderer/ui/flow/flowBlockPaint'
import { flowPaperPadding, flowScrollPadding } from '../../src/shared/flowBodyPresentation'

function fixture(): CourseProjectV10 {
  return { schemaVersion: 11, id: 'sticky-flow', revision: 0, title: 'Sticky Flow', rootIds: ['flow'],
    entry: { rootInstanceId: 'flow' }, global: { underlay: [], overlay: [] }, assets: {},
    definitions: {
      flow: { id: 'flow', role: 'content', implementation: { kind: 'builtin', key: 'guoling.container.flow' } },
      text: { id: 'text', role: 'content', implementation: { kind: 'builtin', key: 'guoling.text' } },
    },
    instances: {
      flow: { id: 'flow', definitionId: 'flow', data: {}, childIds: ['title', 'nav', 'article'], container: { kind: 'flow',
        flow: { layout: { widthMode: 'reading', readingWidth: 900, wideContentWidth: 1200, toc: 'hidden' } } } },
      title: { id: 'title', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('Title above navigation'))) },
      nav: { id: 'nav', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('Chapter navigation'))),
        style: { position: 'sticky', top: 0, zIndex: 20 } },
      article: { id: 'article', definitionId: 'text', data: JSON.parse(JSON.stringify(createTextComponentData('Article body'))) },
    },
  }
}

describe('Flow browser-owned sticky placement', () => {
  it('preserves sticky in new project source objects and incremental style files, while retaining frame ownership', () => {
    const project = fixture(), resources = { assets: {}, components: {} }
    const structure = componentProjectFiles(project, resources).find(file => file.kind === 'structure'
      && file.target?.kind === 'container' && file.target.container.kind === 'surface' && file.target.container.surfaceId === 'flow')!
    let nextId = 0
    const inserted = applyComponentOperation(project, planContentApply({ project, createId: () => `inserted-${++nextId}`,
      request: { intent: 'insert', target: { kind: 'container', container: { kind: 'instance', instanceId: 'flow' } },
        source: componentFileContentSource(structure, JSON.stringify({ kind: 'objects', objects: [{ definitionId: 'text',
          data: project.instances.nav.data, style: { position: 'sticky', insetBlockStart: 0, zIndex: 8 } }] })) } }).command, resources)
    const created = inserted.instances['inserted-1']!
    expect(created.style).toEqual({ position: 'sticky', 'inset-block-start': 0, 'z-index': 8 })
    const styleFile = componentProjectFiles(inserted, resources).find(file => file.kind === 'style'
      && file.target?.kind === 'instance' && file.target.instanceId === created.id)!
    const changed = applyComponentOperation(inserted, planContentApply({ project: inserted, createId: () => { throw Error('No new identity') },
      request: { intent: 'style', target: { kind: 'instance', instanceId: created.id },
        source: componentFileContentSource(styleFile, JSON.stringify({ position: 'sticky', top: '2rem', right: 0, bottom: 'auto', left: 0, zIndex: 12 })) } }).command, resources)
    expect(changed.instances[created.id]!.style).toEqual({ position: 'sticky', top: '2rem', right: 0, bottom: 'auto', left: 0, 'z-index': 12 })
    const ignored = planContentApply({ project: changed, createId: () => 'unused', request: { intent: 'style',
      target: { kind: 'instance', instanceId: created.id }, source: { kind: 'style', style: { position: 'fixed' } } } })
    expect(ignored.diagnostics.some(item => item.code === 'frame-style-preserved')).toBe(true)
    expect(ignored.command).toMatchObject({ edits: [] })
    const clearFile = componentProjectFiles(changed, resources).find(file => file.kind === 'style'
      && file.target?.kind === 'instance' && file.target.instanceId === created.id)!
    const cleared = applyComponentOperation(changed, planContentApply({ project: changed, createId: () => 'unused',
      request: { intent: 'style', target: { kind: 'instance', instanceId: created.id }, source: componentFileContentSource(clearFile, '{}') } }).command, resources)
    expect(cleared.instances[created.id]!.style).toEqual({})
    expect(cleared.instances.title).toEqual(project.instances.title)
  })

  it('uses the same Flow outer CSS in React, ModelPlayer and compiled HTML, and clears it on retained nodes', async () => {
    const project = fixture(), root = document.createElement('div'); document.body.append(root)
    const runtime = { bind: vi.fn(), bindTarget: vi.fn(), assetUrl: vi.fn() } as unknown as ComponentPlatformRuntime
    const projection = createComponentModelProjection({ root, runtime, signal: new AbortController().signal })
    const react = render(createElement(InstanceView, { instance: project.instances.nav, project, surfaceId: 'flow',
      selectedInstanceId: null, onSelect() {}, placement: 'flow' }))
    try {
      projection.sync({ kind: 'course-v10', project, resources: { assets: {}, components: {} } })
      const node = root.querySelector<HTMLElement>('[data-component-object="nav"]')!
      const reactNode = react.container.querySelector<HTMLElement>('[data-component-instance="nav"]')!
      expect(node.style.position).toBe('sticky')
      expect(node.style.top).toBe('0px')
      expect(node.style.zIndex).toBe('20')
      expect(reactNode.style.position).toBe('sticky')
      expect(reactNode.style.top).toBe('0px')
      const { revision: _revision, ...published } = project
      const artifact = await compileCoursePlayback({ ...published, schemaVersion: 4 }, { document, renderBuiltin: async () => '<p>Navigation</p>' })
      const markup = document.createElement('div'); markup.innerHTML = artifact.html
      const compiled = markup.querySelector<HTMLElement>('[data-compiled-node="nav"]')!
      expect(compiled.style.position).toBe('sticky')
      expect(compiled.style.top).toBe('0px')
      expect(compiled.style.zIndex).toBe('20')
      expect(markup.querySelector<HTMLElement>('[data-compiled-flow-paper]')!.style.padding).toBe('28px 36px 64px')
      const changed = structuredClone(project); changed.instances.nav.style = {}
      projection.sync({ kind: 'course-v10', project: changed, resources: { assets: {}, components: {} } })
      expect(root.querySelector('[data-component-object="nav"]')).toBe(node)
      expect(node.style.position).toBe('relative')
      expect(node.style.top).toBe('')
      expect(node.style.zIndex).toBe('')
    } finally { projection.dispose(); react.unmount(); root.remove() }
  })

  it('projects and retires sticky on the actual native paragraph paint path without changing normal paper margins', () => {
    let project = fixture()
    const paper = document.createElement('article'), paragraph = document.createElement('p')
    paragraph.dataset.flowBlockId = 'nav'; paragraph.dataset.flowBodyBlock = 'paragraph'; paper.append(paragraph)
    document.body.append(paper)
    const paint = createFlowBlockPaint(paper, 'flow', () => project, () => {}, mutate => mutate())
    try {
      paint.paint([paragraph])
      expect(paragraph.style.position).toBe('sticky')
      expect(paragraph.style.top).toBe('0px')
      expect(paragraph.style.zIndex).toBe('20')
      project = structuredClone(project); project.instances.nav.style = {}
      paint.refresh()
      expect(paragraph.style.position).toBe('')
      expect(paragraph.style.top).toBe('')
      expect(paragraph.style.zIndex).toBe('')
      const layout = project.instances.flow.container!.flow!.layout
      expect(flowPaperPadding(layout)).toBe('28px 36px 64px')
      expect(flowScrollPadding(layout)).toBe('24px 16px 48px')
    } finally { paint.destroy(); paper.remove() }
  })

  it('keeps sticky CSS out of free/global projection and supports authored CSS inset aliases', () => {
    const project = fixture(), nav = project.instances.nav
    nav.style = { position: 'sticky', inset: '0 2px', top: 9, 'inset-inline-start': 3, bottom: 4, zIndex: 5 }
    expect(flowStickyStyle(nav)).toEqual({ position: 'sticky', inset: '0 2px', top: '9px', insetInlineStart: '3px', bottom: '4px', zIndex: '5' })
    const shown = resolveComponentOuterPresentation(project, nav, { placement: 'flow', purpose: 'author', inlineSize: 390 }).outerStyle
    expect(shown).toMatchObject({ position: 'sticky', inset: '0 2px', top: '9px', insetInlineStart: '3px', bottom: '4px', zIndex: '5' })
    const element = document.createElement('div'); Object.assign(element.style, shown)
    expect(element.style.top).toBe('9px')
    expect(resolveComponentOuterPresentation(project, nav, { placement: 'free', purpose: 'author', inlineSize: 390 }).outerStyle.position).toBe('relative')
    project.instances.flow.childIds = ['title', 'article']; project.global.overlay = ['nav']
    const plan = planContentApply({ project, createId: () => 'unused', request: { intent: 'style', target: { kind: 'instance', instanceId: 'nav' },
      source: { kind: 'style', style: { position: 'sticky', top: 12 } } } })
    expect(plan.diagnostics.filter(item => item.code === 'frame-style-preserved')).toHaveLength(2)
    expect(plan.command).toMatchObject({ edits: [] })
  })

  it('admits both pinned viewport stretch axes from source creation and style-file updates', () => {
    const project = fixture(), resources = { assets: {}, components: {} }
    const source = { kind: 'objects' as const, objects: [{ definitionId: 'text', data: project.instances.nav.data,
      viewportPinned: true, style: { width: '100%', height: '100%' }, frame: { width: 900, height: 600, transform: [1, 0, 0, 1, 0, 0] as [number, number, number, number, number, number] } }] }
    const inserted = applyComponentOperation(project, planContentApply({ project, createId: () => 'pinned',
      request: { intent: 'insert', target: { kind: 'container', container: { kind: 'global', plane: 'overlay' } }, source } }).command, resources)
    expect(inserted.instances.pinned!.style).toEqual({ width: '100%', height: '100%' })
    const changed = structuredClone(inserted); changed.instances.pinned!.style = {}
    const styleFile = componentProjectFiles(changed, resources).find(file => file.kind === 'style'
      && file.target?.kind === 'instance' && file.target.instanceId === 'pinned')!
    const stretched = applyComponentOperation(changed, planContentApply({ project: changed, createId: () => 'unused', request: {
      intent: 'style', target: { kind: 'instance', instanceId: 'pinned' },
      source: componentFileContentSource(styleFile, JSON.stringify({ width: '100%', height: '100%' })) } }).command, resources)
    expect(stretched.instances.pinned!.style).toEqual({ width: '100%', height: '100%' })
  })
})
