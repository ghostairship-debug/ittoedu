import type { AuthoringToolDestinationV1, AuthoringToolTargetWireV1 } from '../../../shared/authoringToolContract'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import { type GenerationSelectionAction } from '../../../shared/generationContract'
import { findFlowBlockRecursive } from '../../../core/tools/flowDocumentModel'
import { locateCourseLayer } from '../../course/effectiveLayerCommands'
import { projectEffectiveLayers } from '../../course/effectiveLayerProjection'

/** Optional placement/discovery hints. These never authorize or restrict edits. */
export function selectionActionIntents(instruction: string) {
  return {
    duplicate: /复制|\b(?:duplicate|copy)\b/i.test(instruction) && !/(?:不要|禁止|不需)复制|\b(?:do not|don't)\s+(?:copy|duplicate)\b/i.test(instruction),
    reorder: /层级|置顶|置底|叠放|(?:移到|放到|移至)[^。！？\n]{0,50}(?:上方|下方)|\b(?:reorder|bring\s+.+\s+front|send\s+.+\s+back)\b/i.test(instruction)
      && !/(?:不要|禁止)(?:调整层级|置顶|置底)/.test(instruction),
    imageAfter: /(?:插入|新增|添加|补充)[^。！？\n]{0,70}(?:图片|插图|配图)|\b(?:insert|add)\s+[^.!?\n]{0,60}\b(?:image|picture|illustration)\b/i.test(instruction)
      && /(?:选中|所选)[^。！？\n]{0,40}(?:之后|后面|后)|\bafter\s+(?:the\s+)?(?:selected|selection)\b/i.test(instruction)
      && !/(?:不要|禁止)[^。！？\n]{0,40}(?:插入|新增|添加)|\b(?:do not|don't)\s+(?:insert|add)\b/i.test(instruction),
  }
}

export function captureGenerationSelectionActions(document: CourseProjectDocument, targets: readonly AuthoringToolTargetWireV1[], instruction: string): GenerationSelectionAction[] {
  const intents = selectionActionIntents(instruction), actions: GenerationSelectionAction[] = []
  for (const target of targets) {
    const layer = locateCourseLayer(document, target.itemId)
    if (!layer) continue
    const row = projectEffectiveLayers({ project: document, locationId: target.locationId, stateId: target.stateId, owner: target.owner }).unifiedRows
      .find(entry => entry.id === target.itemId && entry.authoringAddress === target.authoringAddress && entry.ownerKey === target.ownerKey)
    if (!row || row.locked) continue
    if (intents.reorder) actions.push({ operation: 'reorder', target })
    if (intents.duplicate && !row.isTeacherController) actions.push({ operation: 'duplicate', target })
  }
  if (intents.imageAfter && targets.length === 1) {
    const target = targets[0]!, surface = document.surfaces.find(value => value.id === target.surfaceId)
    const body = surface?.type === 'flow' && target.owner === 'surface' ? findFlowBlockRecursive(surface.blocks, target.itemId) : null
    const layer = locateCourseLayer(document, target.itemId)
    const row = layer ? projectEffectiveLayers({ project: document, locationId: target.locationId, stateId: target.stateId, owner: target.owner }).unifiedRows
      .find(entry => entry.id === target.itemId && entry.authoringAddress === target.authoringAddress && entry.ownerKey === target.ownerKey) : null
    if (body && ['paragraph', 'heading', 'quote', 'list'].includes(body.block.type)
      || row && !row.locked && (target.owner === 'scene' || target.owner === 'world') && row.item.kind === 'native' && row.item.content.nativeType === 'text') {
      const { itemId: _itemId, authoringAddress: _address, ...scope } = target
      const destination: Extract<AuthoringToolDestinationV1, { kind: 'create' }> = { kind: 'create', scope: { ...scope,
        parent: body ? { kind: 'flow-body', parentBlockId: body.parentId } : { kind: 'owner' }, insertion: { kind: 'after', siblingId: target.itemId } } }
      actions.push({ operation: 'insert-image-after', target, destination })
    }
  }
  return actions
}

