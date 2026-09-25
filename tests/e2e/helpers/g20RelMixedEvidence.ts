type Tool = { call: { name: string; input: unknown }; result?: unknown }
type Run = {
  runId?: string
  continuedFrom?: string
  input?: { conversationId: string }
  status: string
  tools: readonly Tool[]
  /** Main persisted this only after it checked the old ready image and reissued a new run handle. */
  hostContinuationImages?: readonly {
    sourceRunId: string; sourceJobId: string; resourceId: string; documentId: string;
    sourceDocumentId?: string; destinationDocumentId?: string; resource: string
  }[]
}
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, any> : {}
const string = (value: unknown): value is string => typeof value === 'string' && value.length > 0

/** Each continuation must be a real same-conversation parent link, in chronological order. */
function lineageOf(input: Run | readonly Run[]): readonly Run[] {
  if (!Array.isArray(input) && (input as Run).continuedFrom)
    throw new Error('REL continuation requires separate durable runs, not flattened tools')
  const runs = Array.isArray(input) ? input : [input as Run]
  if (!runs.length) throw new Error('REL evidence has no run')
  if (runs.length > 1) for (let index = 1; index < runs.length; index++) {
    const previous = runs[index - 1]!, current = runs[index]!
    if (!previous.runId || !current.runId || current.continuedFrom !== previous.runId
      || !previous.input?.conversationId || current.input?.conversationId !== previous.input.conversationId)
      throw new Error('REL evidence continuation lineage is unverified')
  }
  return runs
}

/** Product receipts, including Main's handle re-signing facts, define mixed-task success. */
export function summarizeRelMixedRun(input: Run | readonly Run[], reopened?: Pick<CourseProjectArchiveData, 'project' | 'assetFiles'>) {
  const runs = lineageOf(input), last = runs[runs.length - 1]!
  const entries = runs.flatMap((run, runIndex) => run.tools.map((tool, toolIndex) => ({
    run, runIndex, toolIndex, tool, input: object(tool.call.input),
    data: object(object(tool.result).data), operation: object(object(tool.result).result),
  })))
  const images = entries.filter(entry => entry.tool.call.name === 'image.generate'
    && entry.data.status === 'ready' && entry.data.stopped !== true)
  const image = images[0]
  const provenance = object(image?.data.provenance)
  const imageResources = (entry: (typeof entries)[number]) => (Array.isArray(entry.data.resources)
    ? entry.data.resources : []).map(object)
  const imageReceipt = image ? {
    status: image.data.status, resourceCount: imageResources(image).length,
    executor: provenance.executor ?? null, endpoint: provenance.endpoint ?? null,
    requestedModel: provenance.requestedImageModel ?? null,
    actualImageModels: Array.isArray(provenance.actualImageModels) ? provenance.actualImageModels : null,
    billingKind: object(provenance.billing).kind ?? null, charge: provenance.charge ?? 'unknown',
    usage: provenance.usage ?? null,
  } : null
  type Entry = (typeof entries)[number]
  let media: { entry: Entry; source: Entry; resource: string; resourceId: string;
    via: 'same-run' | 'same-run-batch' | 'host-re-signed' } | undefined
  for (const entry of entries) {
    if (entry.operation.status !== 'applied' || !string(entry.operation.documentId)) continue
    const batch = entry.tool.call.name === 'batch' && Array.isArray(entry.input.operations)
      ? entry.input.operations.map(object) : []
    const mutations = entry.tool.call.name === 'media.insert' || entry.tool.call.name === 'media.apply'
      ? [{ name: entry.tool.call.name, input: entry.input }]
      : batch
    for (const mutation of mutations) {
      if (mutation.name !== 'media.insert' && mutation.name !== 'media.apply') continue
      const resource = object(mutation.input).resource
      if (!string(resource)) continue
      const direct = images.find(source => source.runIndex === entry.runIndex
        && source.toolIndex < entry.toolIndex && source.data.documentId === entry.operation.documentId
        && imageResources(source).some(value => value.resource === resource))
      const directResource = direct && imageResources(direct).find(value => value.resource === resource)
      if (direct && string(directResource?.resourceId)) { media = { entry, source: direct, resource,
        resourceId: directResource.resourceId,
        via: entry.tool.call.name === 'batch' ? 'same-run-batch' : 'same-run' }; break }
      const signed = entry.run.hostContinuationImages?.find(value => value.resource === resource
        && (value.destinationDocumentId ?? value.documentId) === entry.operation.documentId)
      if (!signed) continue
      const source = images.find(candidate => candidate.runIndex < entry.runIndex
        && candidate.run.runId === signed.sourceRunId && candidate.data.job === signed.sourceJobId
        && candidate.data.documentId === (signed.sourceDocumentId ?? signed.documentId)
        && imageResources(candidate).some(value => value.resourceId === signed.resourceId))
      if (source) { media = { entry, source, resource, resourceId: signed.resourceId,
        via: 'host-re-signed' }; break }
    }
    if (media) break
  }
  // The saved project is a separate witness: an applied receipt alone does not prove the
  // generated bytes survived save/reopen or are actually referenced by a slide.
  const mediaResourceIds = media ? [media.resourceId] : []
  const projectMedia = reopened && media ? reopened.project.surfaces.flatMap((surface, surfaceIndex) =>
    surface.type === 'slide' ? surface.scenes.flatMap((scene, sceneIndex) =>
      scene.layerItems.flatMap((item, itemIndex) => {
        if (item.kind !== 'native' || item.content.nativeType !== 'image') return []
        const assetId = item.content.data.assetId, asset = reopened.project.assets[assetId]
        const bytes = reopened.assetFiles[assetId]
        if (asset?.kind !== 'image' || !asset.mimeType.startsWith('image/') || !bytes?.length
          || asset.byteLength !== bytes.length) return []
        const resourceId = `image_${createHash('sha256').update(bytes).digest('hex')}`
        return mediaResourceIds.includes(resourceId) ? [{ assetId, resourceId, surfaceIndex, sceneIndex, itemIndex }] : []
      })) : []) : []
  const mediaLinked = !!media && (!reopened || !!projectMedia?.length)
  const compiles = entries.filter(entry => entry.tool.call.name === 'build.compile'
    && string(entry.input.job) && string(entry.input.path))
  const failed = compiles.filter(entry => entry.data.ok === false)
  const success = compiles.filter(entry => entry.data.ok === true)
  // A cancelled ancestor scratch has no verified source clone into the new job.
  // A new job must itself show the failed compile and corrected compile.
  const buildFrom = (fixed: (typeof compiles)[number]) => {
    const ready = entries.find(entry => entry.runIndex === fixed.runIndex
      && entry.toolIndex > fixed.toolIndex && entry.tool.call.name === 'build.check'
      && entry.input.job === fixed.input.job && entry.data.job === fixed.input.job
      && entry.data.status === 'ready' && string(entry.data.artifact))
    const imported = ready && entries.find(entry => entry.runIndex === ready.runIndex
      && entry.toolIndex > ready.toolIndex && entry.tool.call.name === 'build.import'
      && entry.input.job === fixed.input.job && entry.input.artifact === ready.data.artifact
      && entry.operation.status === 'applied')
    return { ready, imported }
  }
  const pairs = success.map(fixed => ({ fixed, broken: failed.find(broken => broken.runIndex === fixed.runIndex
    && broken.toolIndex < fixed.toolIndex && broken.input.job === fixed.input.job
    && broken.input.path === fixed.input.path) })).filter(candidate => candidate.broken)
  const candidates = pairs.map(pair => ({ ...pair, ...buildFrom(pair.fixed) }))
  const repaired = candidates.find(candidate => candidate.imported)
    ?? candidates.find(candidate => candidate.ready)
    ?? candidates[0]
  const selected = repaired ?? success.map(buildFrom).find(candidate => candidate.imported)
    ?? success.map(buildFrom).find(candidate => candidate.ready)
  const pair = repaired?.broken ? repaired : undefined
  const receiptSequence = {
    failedCompile: pair?.broken ? { runId: pair.broken.run.runId ?? null, index: pair.broken.toolIndex,
      job: pair.broken.input.job, path: pair.broken.input.path, message: pair.broken.data.message ?? null } : null,
    fixedCompile: pair ? { runId: pair.fixed.run.runId ?? null, index: pair.fixed.toolIndex,
      job: pair.fixed.input.job, path: pair.fixed.input.path } : null,
    readyCheck: selected?.ready ? { runId: selected.ready.run.runId ?? null, index: selected.ready.toolIndex,
      job: selected.ready.input.job, artifact: selected.ready.data.artifact } : null,
    appliedImport: selected?.imported ? { runId: selected.imported.run.runId ?? null,
      index: selected.imported.toolIndex, job: selected.imported.input.job,
      artifact: selected.imported.input.artifact, revision: selected.imported.operation.revision ?? null } : null,
  }
  return {
    image: imageReceipt, imageReady: !!image && imageResources(image).length > 0, mediaLinked,
    projectMedia: reopened ? projectMedia : null,
    mediaReceipt: media ? { runId: media.entry.run.runId ?? null, index: media.entry.toolIndex,
      resource: media.resource, revision: media.entry.operation.revision ?? null,
      sourceRunId: media.source.run.runId ?? null, sourceJobId: media.source.data.job ?? null,
      via: media.via } : null,
    compile: { attempts: compiles.length, failed: failed.length > 0,
      firstError: failed[0]?.data.message ?? null, fixedAfterFailure: !!pair },
    build: { checkReady: !!selected?.ready, importAppliedAfterReady: !!selected?.imported,
      receiptSequence },
    firstPass: runs.length === 1 && last.status === 'completed' && failed.length === 0 && !!image && mediaLinked
      && !!selected?.ready && !!selected.imported,
    repairedSuccess: last.status === 'completed' && !!pair && !!image && mediaLinked
      && !!selected?.ready && !!selected.imported,
  }
}
import { createHash } from 'node:crypto'
import type { CourseProjectArchiveData } from '../../../src/core/drivers/codecs/courseProjectArchive'
