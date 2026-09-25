import { assertImagePlacementFit } from '../../../core/tools/imageApplication'
import { generationCandidateSchema, generationMediaApplyInputSchema, GenerationCandidatePreparationError, generationFailureDiagnostics, type GenerationCandidate, type GenerationRequest } from '../../../shared/generationContract'
import type { CourseProjectDocument } from '../../../shared/courseProjectTypes'
import type { AuthoringToolDestinationV1 } from '../../../shared/authoringToolContract'
import { projectEffectiveLayers } from '../../course/effectiveLayerProjection'
import { findFlowBlockRecursive } from '../../../core/tools/flowDocumentModel'
import { resolveAuthoringToolScope } from '../tools/authoringToolScope'
import { captureSelectionReplacementScopes } from '../tools/semanticReplacementTool'
import { prepareGeneratedImage } from '../../project/prepareGeneratedImage'
import { generatedImageFormat } from '../../../shared/generatedImageFormat'
import { resolveBackgroundTarget } from '../tools/backgroundTool'

type Step = GenerationCandidate['steps'][number]
function sameDestination(left: AuthoringToolDestinationV1, right: AuthoringToolDestinationV1) {
  // Both values were parsed by the same strict identity schema.
  return JSON.stringify(left) === JSON.stringify(right)
}
function base64(bytes: Uint8Array) {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 16_384) binary += String.fromCharCode(...bytes.subarray(start, start + 16_384))
  return btoa(binary)
}

/** Expand one semantic family into the existing commands before any live write.
 * Targets, resource scopes and all created identities stay in the same request.
 * Narrow content commands preserve state even after earlier candidate edits. */
export async function expandGenerationSemanticCandidate(candidate: GenerationCandidate, request: GenerationRequest, document: CourseProjectDocument,
  assetFiles: Readonly<Record<string, Uint8Array>>, isCurrent: () => boolean = () => true, reservedIds: ReadonlySet<string> = new Set()): Promise<GenerationCandidate> {
  const steps: Step[] = [], reserved = new Set([...reservedIds, ...candidate.steps.map(step => step.id)])
  const allocate = (index: number, role: string) => {
    let id = `media-${index + 1}-${role}`
    while (reserved.has(id)) id += '-next'
    reserved.add(id); return id
  }
  for (const [index, step] of candidate.steps.entries()) {
    if (step.tool !== 'media.apply') { steps.push(step); continue }
    try {
      if (!isCurrent()) throw new Error('stale：图片准备前任务已失效')
      if (step.carrier !== 'native' || !request.allowedCarriers.includes('native')) throw new Error('图片应用需要当前请求允许 Native 载体')
      if (step.destination.kind !== 'create' && step.destination.kind !== 'update') throw new Error('图片应用需要本次请求的明确目标')
      const destination = step.destination
      if (!request.destinations.some(allowed => sameDestination(allowed, destination))) throw new Error('图片目标不在本次请求范围内')
      const input = generationMediaApplyInputSchema.parse(step.input)
      const { target, surface } = resolveAuthoringToolScope(document, destination)
      const imageAfter = request.selectionActions?.find(action => action.operation === 'insert-image-after' && sameDestination(action.destination, destination))
      const anchor = imageAfter && imageAfter.operation === 'insert-image-after' && destination.kind === 'create' && destination.scope.parent.kind === 'owner'
        ? projectEffectiveLayers({ project: document, locationId: target.locationId, stateId: target.stateId, owner: target.owner }).unifiedRows.find(row => row.id === imageAfter.target.itemId)?.item : null
      const background = input.placement === 'background'
      const body = destination.kind === 'update' && surface.type === 'flow' && target.owner === 'surface'
        ? findFlowBlockRecursive(surface.blocks, destination.target.itemId)?.block : undefined
      const item = destination.kind === 'update' && !body && !background
        ? projectEffectiveLayers({ project: document, locationId: target.locationId, stateId: target.stateId, owner: target.owner }).unifiedRows.find(row => row.id === destination.target.itemId)?.item : undefined
      const flowBody = Boolean(body) || (destination.kind === 'create' && destination.scope.parent.kind === 'flow-body')
      assertImagePlacementFit(background ? 'background' : flowBody ? 'flow' : 'native', input.fit)
      const backgroundTarget = background ? resolveBackgroundTarget(document, destination) : null
      if (!background && destination.kind === 'update') {
        if (body && (body.type !== 'media' || body.mediaKind !== 'image')) throw new Error('正文图片应用只接受已有图片块；新增插图使用正文 create 目标')
        if (!body && (item?.kind !== 'native' || !['image', 'shape'].includes(item.content.nativeType))) throw new Error('图片应用只接受已有图片或形状；其他载体使用正式完整替换')
      }
      let assetId: unknown, imageDimensions: { width: number; height: number } | undefined
      if ('assetId' in input.source) {
        if (typeof input.source.assetId !== 'string') throw new Error('素材结果引用尚未从前序回执解析')
        const asset = document.assets[input.source.assetId], bytes = assetFiles[input.source.assetId]
        if (asset?.kind !== 'image') throw new Error('source.assetId 必须是当前工程中的图片素材')
        if (!bytes?.length) throw new Error('已有图片没有可解码的工程素材字节；请取得真实图片后交付本轮文件')
        // Reuse an existing identity only after the same formal decoder accepts
        // its bytes. Validation never rewrites a shared original asset.
        imageDimensions = await prepareGeneratedImage({ bytes, filename: asset.filename, mimeType: asset.mimeType ?? generatedImageFormat(bytes).mimeType,
          display: item?.frame ?? { width: 1024, height: 1024 }, preserveResolution: true })
        if (!isCurrent()) throw new Error('stale：图片准备期间任务已失效')
        assetId = input.source.assetId
      } else if ('base64' in input.source) {
        const resourceScope = request.destinations.find(entry => entry.kind === 'create' && entry.scope.owner === 'global'
          && entry.scope.surfaceId === target.surfaceId && entry.scope.locationId === target.locationId && entry.scope.stateId === null
          && entry.scope.parent.kind === 'owner' && entry.scope.insertion.kind === 'append')
        if (!resourceScope) throw new Error('当前请求没有图片导入所需的正式素材依赖范围')
        const prepared = await prepareGeneratedImage({ bytes: Uint8Array.from(atob(input.source.base64), character => character.charCodeAt(0)),
          mimeType: input.source.mimeType, filename: input.source.filename, display: item?.frame ?? { width: 1024, height: 1024 },
          fit: input.fit ?? (item?.kind === 'native' && item.content.nativeType === 'image' ? item.content.data.fit : 'contain'), preserveResolution: input.preserveResolution })
        if (!isCurrent()) throw new Error('stale：图片准备期间任务已失效')
        imageDimensions = prepared
        const importId = allocate(index, 'asset')
        steps.push({ id: importId, tool: 'asset.media.import', carrier: 'native', destination: resourceScope,
          input: { kind: 'image', filename: prepared.filename, mimeType: prepared.mimeType, base64: base64(prepared.bytes) } })
        assetId = { $result: { stepId: importId, kind: 'asset-id', index: 0 } }
      } else throw new Error('图片文件或素材别名尚未由当前请求摄取，请重新交付本轮资源引用')
      const push = (id: string, tool: string, destination: Step['destination'], input: unknown) => steps.push({ id, tool, carrier: 'native', destination, input: input as Step['input'] })
      if (background) {
        push(step.id, 'owner.background', destination, { backgroundAssetId: assetId, ...(backgroundTarget!.supportsMode ? { backgroundMode: 'own' } : {}) })
      } else if (destination.kind === 'create') {
        if (destination.scope.parent.kind === 'flow-body') push(step.id, 'flow.content', destination, { operation: 'insert', block: { type: 'media', mediaKind: 'image', assetId, layout: 'content-width' } })
        else {
          const width = anchor?.frame.width, y = anchor ? anchor.frame.y + anchor.frame.height + 24 : undefined
          const height = width && imageDimensions ? width * imageDimensions.height / imageDimensions.width : undefined
          const remaining = surface.type === 'slide' && y !== undefined ? surface.canvas.height - y : undefined
          if (remaining !== undefined && remaining < 24) throw new Error('选中说明下方没有足够插图空间；请先调整页面布局或明确改用当前页范围')
          const placement = anchor && width && height ? { x: anchor.frame.x, y, width, height: remaining === undefined ? height : Math.min(height, remaining) } : {}
          push(step.id, 'native.content', destination, { operation: 'insert', template: { nativeType: 'image', assetId, fit: input.fit ?? 'contain', ...placement } })
        }
      } else if (body) {
        push(step.id, 'flow.content', destination, { operation: 'edit', image: { assetId } })
      } else if (item?.kind === 'native' && item.content.nativeType === 'image') {
        push(step.id, 'native.content', destination, { operation: 'edit', image: { assetId, ...(input.fit ? { fit: input.fit } : {}) } })
      } else {
        const scopes = captureSelectionReplacementScopes(document, [destination.target])
        const create = scopes.find(scope => scope.kind === 'create' && scope.scope.owner === target.owner && scope.scope.stateId === target.stateId && scope.scope.parent.kind === 'owner'
          && request.destinations.some(allowed => sameDestination(scope, allowed)))
        if (!create) throw new Error('当前请求没有形状换图所需的正式同 owner 替换范围')
        const newId = allocate(index, 'image')
        push(newId, 'native.content', create, { operation: 'insert', template: { nativeType: 'image', assetId, fit: input.fit ?? 'contain' } })
        push(step.id, 'selection.replace', destination, { replacementItemId: { $result: { stepId: newId, kind: 'item-id', index: 0 } } })
      }
    } catch (error) {
      throw new GenerationCandidatePreparationError({ version: 1, stage: 'prepare', requestId: request.requestId, candidateId: candidate.candidateId,
        stepId: step.id, tool: step.tool, destination: step.destination, diagnostics: generationFailureDiagnostics(error, 'media-apply-failed'), assetIds: [], packageIds: [] })
    }
  }
  return generationCandidateSchema.parse({ ...candidate, steps })
}
