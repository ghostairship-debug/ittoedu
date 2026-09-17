import { generationTaskFactsSchema, type GenerationTaskFacts } from '../../../shared/generationTaskFacts'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { ComponentPackageData } from '../../../shared/componentTypes'
import { getComponentPropValue, mergeComponentProps, resolveComponentEditorProperties } from '../../../shared/componentProps'
import { composeCourseProjectLocation } from '../../../shared/courseLayerComposition'
import { projectEffectiveLayers } from '../../course/effectiveLayerProjection'
import { buildFlowEditorView, captureFlowEditorAuthoringTarget } from '../../course/flowEditorView'
import { captureCourseAuthoringTarget } from '../courseAuthoringSession'
import type { CourseAuthoringSessionToken } from '../courseAuthoringSession'

/** No live Store and no manifest reimplementation: all facts share this frozen input. */
export function captureGenerationTaskFacts(input: {
  document: CourseProjectDocument; sessionToken: CourseAuthoringSessionToken
  locationId: string; stateId: string | null; selectedIds: readonly string[]
  scope: 'selection' | 'page' | 'course'; instruction: string
  componentPackages?: Readonly<Record<string, ComponentPackageData>>
}): GenerationTaskFacts {
  const { document, sessionToken } = input
  const facts: GenerationTaskFacts = { version: 1, projectId: document.id,
    documentRevision: document.revision, sessionGeneration: sessionToken.generation,
    source: 'frozen-project', indexes: [], components: [], relations: [] }
  const wantsLayout = /对齐|分布|间距|布局|排列|三列|居中|align|distribut|layout|spacing/i.test(input.instruction)
  for (const location of document.locations) {
    const stateId = location.id === input.locationId ? input.stateId : undefined
    const view = projectEffectiveLayers({ project: document, locationId: location.id, stateId })
    const token = { ...sessionToken, locationId: location.id, surfaceType: view.surfaceType }
    facts.indexes.push({ locationId: location.id, surfaceId: location.surfaceId, stateId: null,
      scope: 'applicable-location-items', completeness: 'complete',
      items: composeCourseProjectLocation({ project: document, locationId: location.id, stateId: null }).entries
        .filter(entry => entry.applicable).map(entry => ({ id: entry.item.layerItemId, label: entry.item.label })) })
    const inFocus = input.scope === 'course' || location.id === input.locationId
    if (!inFocus) continue
    const focused = (id: string) => input.scope !== 'selection' || input.selectedIds.includes(id)
    for (const row of view.unifiedRows) {
      if (!row.visibleAtLocation) continue
      const target = captureCourseAuthoringTarget({ sessionToken: token, projectId: document.id,
        surfaceId: view.surfaceId, stateId: view.stateId, owner: row.owner, ownerKey: row.ownerKey,
        itemId: row.id, authoringAddress: row.authoringAddress })
      if (wantsLayout) facts.relations.push({ target, plane: row.reorderGroupKey,
        frame: { x: row.frame.x, y: row.frame.y, width: row.frame.width, height: row.frame.height }, rotation: row.rotation, order: row.stackOrder, locked: row.locked,
        label: row.name, ...(row.item.kind === 'native' && row.item.content.nativeType === 'text'
          ? { text: row.item.content.data.text.slice(0, 160) } : {}) })
      if (focused(row.id) && row.item.kind === 'component') {
        const manifest = input.componentPackages?.[row.item.component.packageId]?.manifest
        if (!manifest) continue
        const effective = mergeComponentProps(manifest, row.item.props)
        facts.components.push({ target, packageId: row.item.component.packageId, source: 'componentProps', scope: 'instance',
          writable: !row.locked, reason: row.locked ? '图层已锁定，先解锁才能修改' : 'component.configure 修改当前实例的有效参数',
          contentMerge: 'recursive-index-merge', fields: resolveComponentEditorProperties(manifest, row.item.props)
            .map(descriptor => ({ descriptor: JSON.parse(JSON.stringify(descriptor)),
              ...(getComponentPropValue(effective, descriptor.key) !== undefined ? { value: JSON.parse(JSON.stringify(getComponentPropValue(effective, descriptor.key))) } : {}) })) })
      }
    }
    if (view.surfaceType === 'flow') {
      const flow = buildFlowEditorView({ project: document, locationId: location.id })
      for (const row of flow.blocks) {
        if (!focused(row.blockId) || row.block.type !== 'component') continue
        const block = row.block, manifest = input.componentPackages?.[block.component.packageId]?.manifest
        if (!manifest) continue
        const effective = mergeComponentProps(manifest, block.props)
        facts.components.push({ target: captureFlowEditorAuthoringTarget({ view: flow, sessionToken: token, target: { kind: 'block', blockId: row.blockId } }),
          packageId: block.component.packageId, source: 'componentProps', scope: 'instance', writable: true,
          reason: 'component.configure 修改正文组件参数；排版由 flow.content 负责', contentMerge: 'recursive-index-merge',
          fields: resolveComponentEditorProperties(manifest, block.props).map(descriptor => ({ descriptor: JSON.parse(JSON.stringify(descriptor)),
            ...(getComponentPropValue(effective, descriptor.key) !== undefined ? { value: JSON.parse(JSON.stringify(getComponentPropValue(effective, descriptor.key))) } : {}) })) })
      }
    }
  }
  return generationTaskFactsSchema.parse(facts)
}
