import type { CourseProjectV10, ComponentEdit, ComponentSurface } from '../../shared/contracts/component-platform'
import type { FlowImportResult } from '../../shared/workbench/flowImportDesktop'
import { applyComponentOperation, captureComponentOperation } from '../../core/drivers/courseV10Operations'
import { flowDocumentEdits } from '../../core/components/document/flowDocumentProjection'

/** Adds an independent native page; existing pages, states, shared layers and hand layouts are retained. */
export function planFlowImport(project: CourseProjectV10, imported: FlowImportResult) {
  const design = project.surfaces.find(surface => surface.kind === 'slide')?.designSize ?? project.surfaces.find(surface => surface.designSize)?.designSize ?? { width: 1280, height: 720 }
  const surface: ComponentSurface = { id: crypto.randomUUID(), title: imported.name.replace(/\.(docx|md|markdown|txt)$/i, ''), kind: 'flow', childIds: [],
    designSize: design, flow: { layout: { widthMode: 'reading', readingWidth: design.width, wideContentWidth: design.width, paperBackgroundColor: '#ffffff' } } }
  const edits: ComponentEdit[] = [...imported.assets.map(entry => ({ type: 'asset.add' as const, asset: entry.asset, bytes: entry.bytes })), { type: 'surface.insert', surface, index: project.surfaces.length }]
  const prepared = applyComponentOperation(project, captureComponentOperation(project, edits))
  edits.push(...flowDocumentEdits(prepared, surface.id, imported.blocks))
  return { surfaceId: surface.id, edits }
}
