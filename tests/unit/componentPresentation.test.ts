import { describe, expect, it } from 'vitest'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform'
import { resolveComponentOuterPresentation } from '../../src/shared/componentPresentation'
import { resolveFlowPaperBackground } from '../../src/shared/flowBodyPresentation'

function fixture(): CourseProjectV10 {
  return { schemaVersion: 10, id: 'presentation', revision: 0, title: 'Flow presentation',
    definitions: Object.fromEntries(['image', 'document-block', 'web'].map(key => [`guoling.${key}`, { id: `guoling.${key}`, name: key, role: 'visual', implementation: { kind: 'builtin', key: `guoling.${key}` } }])),
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
})
