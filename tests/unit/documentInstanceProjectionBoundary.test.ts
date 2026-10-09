import { describe, expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { paintCompositionDocument } from '../../src/player/composition/documentContent'
import { buildFlowPrintPlan } from '../../src/renderer/export/course/flowPrintPlan'
import { buildComponentReadingProjection } from '../../src/renderer/export/componentPlatform/document/reading'
import { componentInstanceSchema } from '../../src/shared/contracts/component-platform/schema'
import type { PublishedFlowSurface } from '../../src/shared/publishedCourseTypes'

function fixture() {
  const project = createBlankCourseProjectV10('实例正文')
  project.definitions.custom = { id: 'custom', title: '动态示例', role: 'content',
    implementation: { kind: 'source', language: 'javascript', source: 'export function mount() {}' } }
  project.definitions[TEXT_DEFINITION.id] = structuredClone(TEXT_DEFINITION)
  project.instances.custom = { id: 'custom', definitionId: 'custom', data: {} }
  project.instances.after = componentInstanceSchema.parse({ id: 'after', definitionId: TEXT_DEFINITION.id, data: createTextComponentData('后续正文') })
  project.global = { underlay: [], overlay: [] }
  project.surfaces = [{ id: 'flow', kind: 'flow', title: '正文', childIds: ['custom', 'after'] }]
  const document = projectFlowDocument(project, 'flow')
  return { project, document }
}

describe('formal instance references at document projection boundaries', () => {
  it('keeps later text and reports the exact instance when a page document receives an editor reference', () => {
    const { document } = fixture(), root = window.document.createElement('div'), report = vi.fn()
    paintCompositionDocument(root, document.content, () => undefined, { reportError: report })
    expect(report).toHaveBeenCalledOnce()
    expect(root.querySelector('[data-document-block-id="custom"]')).toHaveAttribute('data-document-error', expect.stringContaining('custom'))
    expect(root.querySelector('[data-document-block-id="after"]')).toHaveTextContent('后续正文')
  })

  it('refuses a V10 instance reference in the old print entry instead of dropping content', () => {
    const { document } = fixture()
    const surface: PublishedFlowSurface = { id: 'flow', type: 'flow', title: '正文', surfaceLayerItems: [],
      layout: { readingWidth: 800, wideContentWidth: 1000 }, blocks: document.content.blocks }
    expect(() => buildFlowPrintPlan(surface)).toThrow(/custom.*组件阅读投影或实际捕获/)
  })

  it('keeps that instance in the V10 reading projection for actual capture', () => {
    const { project } = fixture(), projection = buildComponentReadingProjection(project, 'flow')
    expect(projection.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'static', instance: expect.objectContaining({ id: 'custom' }), captureRequired: true }),
      expect.objectContaining({ kind: 'text', instance: expect.objectContaining({ id: 'after' }) }),
    ]))
  })
})
