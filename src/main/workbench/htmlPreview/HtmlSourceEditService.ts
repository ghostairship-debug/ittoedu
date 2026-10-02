import type { DocumentOperation, DocumentOperationResult, DocumentSnapshot } from '../../../shared/workbench/document'
import { promises as fs } from 'node:fs'
import { scanHtmlSource, indexHtmlElements } from '../../../shared/html/htmlSourceScanner'
import type { HtmlPreviewEditOutcome, HtmlPreviewRequest, HtmlPreviewResolvedTarget } from '../../../shared/workbench/htmlPreview'
import { htmlPreviewTargetReportSchema } from '../../../shared/workbench/htmlPreview'
import type { z } from 'zod'

type HtmlPreviewTargetReport = z.infer<typeof htmlPreviewTargetReportSchema>
import type { HtmlPreviewEditContext, HtmlPreviewEditPort } from './HtmlPreviewService'
import { escapeHtmlAttribute, escapeHtmlText, locateHtmlSourceTarget } from './htmlSourceLocator'
import { prepareHtmlImage } from './htmlImagePreparation'
import { replaceSrcsetUrls } from '../../../shared/html/responsiveImage'

type ResolveRequest = Extract<HtmlPreviewRequest, { type: 'html-preview.resolve-target' }>
type EditRequest = Extract<HtmlPreviewRequest, { type: 'html-preview.edit' }>
type EditRecord = { revision: number; report: HtmlPreviewTargetReport; resolved: HtmlPreviewResolvedTarget }
type Splice = { from: number; to: number; text: string }

export interface HtmlSourceEditDependencies {
  readDocument(documentId: string): Promise<DocumentSnapshot>
  execute(operation: DocumentOperation): Promise<DocumentOperationResult>
  withFileAccess<T>(work: () => Promise<T>): Promise<T>
}

function recordKey(leaseId: string, loadId: string, handle: string): string { return `${leaseId}\0${loadId}\0${handle}` }

function matchingSnapshot(snapshot: DocumentSnapshot, request: EditRequest, context: HtmlPreviewEditContext): boolean {
  return snapshot.documentId === request.documentId && snapshot.epoch === request.epoch
    && snapshot.revision === request.baseRevision && snapshot.binding.kind === 'file'
    && snapshot.binding.bindingVersion === request.bindingVersion && snapshot.binding.path === context.bindingPath
    && snapshot.model.kind === 'text'
}

function attributeRemoval(source: string, tokenStart: number, tokenEnd: number, nameStart: number, valueEnd: number): Splice | null {
  let from = nameStart
  while (from > tokenStart && /\s/.test(source[from - 1]!)) from -= 1
  let to = valueEnd
  if (source[to] === '"' || source[to] === "'") to += 1
  if (from === nameStart || to > tokenEnd) return null
  return { from, to, text: '' }
}

function imageResponsiveEdits(source: string, elementStart: number, url: string, mimeType: string): Splice[] | null {
  const scan = scanHtmlSource(source)
  const index = indexHtmlElements(source, scan.tokens)
  const elementAt = index.elements.findIndex(element => element.startTag.start === elementStart)
  if (elementAt < 0) return null
  const element = index.elements[elementAt]!
  const parent = element.parent === null ? null : index.elements[element.parent]!
  const relevant = [element, ...(parent?.name === 'picture'
    ? index.elements.filter(candidate => candidate.parent === element.parent && candidate.name === 'source') : [])]
  const edits: Splice[] = []
  for (const node of relevant) {
    const token = scan.tokens.find(candidate => candidate.kind === 'start-tag' && candidate.span.start === node.startTag.start)
    if (!token) return null
    for (const attribute of token.attributes ?? []) {
      if (node.name === 'source' && attribute.name === 'type' && attribute.decodedValue?.toLowerCase() !== mimeType.toLowerCase()) {
        const removal = attributeRemoval(source, token.span.start, token.span.end, attribute.span.start, attribute.valueSpan?.end ?? attribute.span.end)
        if (removal) edits.push(removal)
        continue
      }
      if (attribute.name !== 'srcset') continue
      if (!attribute.valueSpan) return null
      edits.push({ from: attribute.valueSpan.start, to: attribute.valueSpan.end,
        text: escapeHtmlAttribute(replaceSrcsetUrls(attribute.decodedValue ?? '', url), attribute.quote) })
    }
  }
  return edits
}

function applySplices(source: string, edits: Splice[]): string | null {
  const sorted = [...edits].sort((a, b) => b.from - a.from)
  for (let index = 0; index < sorted.length; index += 1) {
    const edit = sorted[index]!
    if (edit.from < 0 || edit.to > source.length || edit.from > edit.to
      || (index > 0 && edit.to > sorted[index - 1]!.from)) return null
    source = source.slice(0, edit.from) + edit.text + source.slice(edit.to)
  }
  return source
}

export class HtmlSourceEditService implements HtmlPreviewEditPort {
  private readonly records = new Map<string, EditRecord>()
  constructor(private readonly dependencies: HtmlSourceEditDependencies) {}

  async resolveTarget(request: ResolveRequest, context: HtmlPreviewEditContext): Promise<{ revision: number; targets: HtmlPreviewResolvedTarget[] }> {
    const model = context.snapshot.model
    if (model.kind !== 'text') throw new Error('HTML 文档已变化')
    const identity = { documentId: context.snapshot.documentId, epoch: context.snapshot.epoch,
      revision: context.snapshot.revision, bindingVersion: context.lease.bindingVersion }
    const targets = request.targets.map(report => {
      const resolved = locateHtmlSourceTarget(model.source, report, identity)
      this.records.set(recordKey(request.leaseId, request.loadId, report.handle), { revision: request.revision, report, resolved })
      return resolved
    })
    if (this.records.size > 4096) this.records.clear()
    return { revision: context.snapshot.revision, targets }
  }

  async edit(request: EditRequest, context: HtmlPreviewEditContext): Promise<HtmlPreviewEditOutcome> {
    const record = this.records.get(recordKey(request.leaseId, request.loadId, request.target))
    if (!record || record.revision !== request.baseRevision || record.resolved.status !== 'editable'
      || record.report.kind !== request.change.kind) return { status: 'rejected', reason: 'not-editable' }
    return this.dependencies.withFileAccess(async () => {
      const snapshot = await this.dependencies.readDocument(request.documentId)
      if (!matchingSnapshot(snapshot, request, context)) return { status: 'rejected', reason: 'stale-revision' }
      if (snapshot.model.kind !== 'text') return { status: 'rejected', reason: 'not-editable' }
      const source = snapshot.model.source
      const located = locateHtmlSourceTarget(source, record.report, {
        documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
        bindingVersion: request.bindingVersion,
      })
      if (located.status !== 'editable') return { status: 'rejected', reason: 'source-changed' }
      const locator = located.locator
      const original = record.resolved
      if (original.status !== 'editable' || (request.change.kind === 'text' && !locator.valueSpan)
        || Boolean(locator.valueSpan) !== Boolean(original.locator.valueSpan)
        || (locator.valueSpan && source.slice(locator.valueSpan.start, locator.valueSpan.end) !== original.locator.expectedRaw)
        || locator.elementSpan.start !== original.locator.elementSpan.start) return { status: 'rejected', reason: 'source-changed' }
      let patchValue: string
      let replacement: string
      let createdImage: string | null = null
      const removeUnreferencedPreparedImage = async () => {
        if (!createdImage) return
        try {
          const current = await this.dependencies.readDocument(snapshot.documentId)
          if (current.model.kind === 'text' && current.model.source.includes(patchValue)) return
          const stat = await fs.lstat(createdImage)
          if (stat.isFile() && !stat.isSymbolicLink()) await fs.unlink(createdImage)
        } catch { /* A failed cleanup must not change the canonical edit receipt. */ }
      }
      let edits: Splice[] = []
      if (request.change.kind === 'text') {
        patchValue = request.change.value
        replacement = escapeHtmlText(patchValue)
        const previousRaw = locator.valueSpan ? source.slice(locator.valueSpan.start, locator.valueSpan.end) : ''
        if (previousRaw.includes('\r\n') || (source.includes('\r\n') && !/(^|[^\r])\n/.test(source))) {
          replacement = replacement.replace(/\r?\n/g, '\r\n')
        }
      } else {
        try {
          const prepared = await prepareHtmlImage({ entryRealPath: context.entryRealPath, rootRealPath: context.rootRealPath,
            operationId: request.operationId, ...request.change })
          createdImage = prepared.created ? prepared.filename : null
          patchValue = prepared.relativeUrl
        } catch { return { status: 'rejected', reason: 'not-editable' } }
        const scan = scanHtmlSource(source)
        const tag = scan.tokens.find(token => token.kind === 'start-tag' && token.span.start === locator.elementSpan.start)
        const attribute = tag?.attributes?.find(value => value.name === 'src')
        if (!tag || (locator.valueSpan && !attribute?.valueSpan) || (!locator.valueSpan && attribute)) {
          await removeUnreferencedPreparedImage(); return { status: 'rejected', reason: 'source-changed' }
        }
        replacement = escapeHtmlAttribute(patchValue, attribute?.quote ?? '"')
        const responsive = imageResponsiveEdits(source, locator.elementSpan.start, patchValue, request.change.mimeType)
        if (!responsive) { await removeUnreferencedPreparedImage(); return { status: 'rejected', reason: 'not-editable' } }
        edits = responsive
      }
      if (locator.valueSpan) edits.push({ from: locator.valueSpan.start, to: locator.valueSpan.end, text: replacement })
      else if (request.change.kind === 'image') {
        const scan = scanHtmlSource(source)
        const tag = scan.tokens.find(token => token.kind === 'start-tag' && token.span.start === locator.elementSpan.start)
        if (!tag) { await removeUnreferencedPreparedImage(); return { status: 'rejected', reason: 'source-changed' } }
        const insertion = source[tag.span.end - 2] === '/' ? tag.span.end - 2 : tag.span.end - 1
        edits.push({ from: insertion, to: insertion, text: ` src="${replacement}"` })
      }
      const updated = applySplices(source, edits)
      if (updated === null) { await removeUnreferencedPreparedImage(); return { status: 'rejected', reason: 'not-editable' } }
      if (updated === source) { await removeUnreferencedPreparedImage(); return { status: 'unchanged', revision: snapshot.revision } }
      let result: DocumentOperationResult
      try {
        result = await this.dependencies.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch,
          operationId: request.operationId, baseRevision: snapshot.revision, actor: 'human',
          mutation: { type: 'command', command: { type: 'markdown.replace', source: updated } } })
      } catch (error) { await removeUnreferencedPreparedImage(); throw error }
      if (result.status !== 'applied') {
        await removeUnreferencedPreparedImage()
        return result.status === 'unchanged' ? { status: 'unchanged', revision: result.revision }
          : { status: 'rejected', reason: 'conflict' }
      }
      return { status: 'applied', revision: result.revision, savedRevision: null,
        dirty: true, patch: { handle: request.target, kind: request.change.kind, value: patchValue,
          ...(request.change.kind === 'image' && edits.length > 1 ? { rewroteResponsive: true } : {}) } }
    })
  }
}
