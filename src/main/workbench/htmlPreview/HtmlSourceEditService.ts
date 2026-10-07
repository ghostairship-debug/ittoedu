import type { DocumentOperation, DocumentOperationResult, DocumentSnapshot } from '../../../shared/workbench/document'
import { promises as fs } from 'node:fs'
import { scanHtmlSource, indexHtmlElements } from '../../../shared/html/htmlSourceScanner'
import type { HtmlPreviewEditOutcome, HtmlPreviewRequest, HtmlPreviewResolvedTarget } from '../../../shared/workbench/htmlPreview'
import { htmlPreviewTargetReportSchema } from '../../../shared/workbench/htmlPreview'
import type { z } from 'zod'

type HtmlPreviewTargetReport = z.infer<typeof htmlPreviewTargetReportSchema>
import type { HtmlPreviewEditContext, HtmlPreviewEditPort } from './HtmlPreviewService'
import { escapeHtmlAttribute, escapeHtmlText, locateHtmlSourceTarget, locateHtmlAuthorRecordSource } from './htmlSourceLocator'
import { prepareHtmlImage } from './htmlImagePreparation'
import { replaceSrcsetUrls } from '../../../shared/html/responsiveImage'
import type { HtmlSourceEditOutcome } from '../../../shared/html/sourceEditCommands'
import { applyHtmlSourceEdit } from './htmlSourceEdits'
import { patchHtmlAuthoringRecords, readHtmlAuthoringRecords } from '../../../shared/html/htmlAuthoringRecords'

type ResolveRequest = Extract<HtmlPreviewRequest, { type: 'html-preview.resolve-target' }>
type EditRequest = Extract<HtmlPreviewRequest, { type: 'html-preview.edit' }>
type SourceEditRequest = Extract<HtmlPreviewRequest, { type: 'html-preview.edit-source' }>
type EditRecord = { revision: number; report: HtmlPreviewTargetReport; resolved: HtmlPreviewResolvedTarget }
type Splice = { from: number; to: number; text: string }

export interface HtmlSourceEditDependencies {
  readDocument(documentId: string): Promise<DocumentSnapshot>
  execute(operation: DocumentOperation): Promise<DocumentOperationResult>
  withFileAccess<T>(work: () => Promise<T>): Promise<T>
}

function recordKey(leaseId: string, loadId: string, handle: string): string { return `${leaseId}\0${loadId}\0${handle}` }

function matchingSnapshot(snapshot: DocumentSnapshot,
  request: Pick<EditRequest, 'documentId' | 'epoch' | 'baseRevision' | 'bindingVersion'>,
  context: HtmlPreviewEditContext): boolean {
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

  /** Source remains the only formal HTML state; visual controls produce an ordinary canonical text transaction. */
  async editSource(request: SourceEditRequest, context: HtmlPreviewEditContext): Promise<HtmlSourceEditOutcome> {
    return this.dependencies.withFileAccess(async () => {
      const snapshot = await this.dependencies.readDocument(request.documentId)
      if (!matchingSnapshot(snapshot, request, context)) return { status: 'rejected', reason: 'stale-revision' }
      if (snapshot.model.kind !== 'text') return { status: 'rejected', reason: 'not-editable' }
      const source = snapshot.model.source
      const edit = applyHtmlSourceEdit(source, request.command)
      if (!edit.ok) return { status: 'rejected', reason: edit.reason, message: edit.message }
      if (!edit.changed) return { status: 'unchanged', revision: snapshot.revision }
      const records = readHtmlAuthoringRecords(source)
      const commands = request.command.type === 'batch' ? request.command.commands : [request.command]
      let changedRecords = false
      for (const [key, record] of Object.entries(records)) {
        const before = locateHtmlAuthorRecordSource(source, record, key)
        if (!before) continue
        const content = commands.find(command => command.type === 'text' && before.valueSpan
          && command.target.from === before.valueSpan.start && command.target.to === before.valueSpan.end)
        const styles = commands.filter(command => (command.type === 'style' || command.type === 'attributes')
          && command.target.from === before.elementSpan.start && command.target.to === before.elementSpan.end)
        const after = locateHtmlAuthorRecordSource(edit.source, record, key, true)
        if (!after) continue
        const overrides = { ...record.overrides, ...(record.overrides.style ? { style: { ...record.overrides.style } } : {}),
          ...(record.overrides.geometry ? { geometry: { ...record.overrides.geometry } } : {}) }
        if (content?.type === 'text') delete overrides.text
        for (const style of styles) if (style.type === 'style') {
          for (const name of Object.keys(style.patch)) {
            if (overrides.style) delete overrides.style[name]
            if (overrides.geometry) {
              if (name === 'width') delete overrides.geometry.width
              if (name === 'height') delete overrides.geometry.height
              if (name === 'translate') { delete overrides.geometry.translateX; delete overrides.geometry.translateY }
              if (name === 'scale') { delete overrides.geometry.scaleX; delete overrides.geometry.scaleY }
              if (name === 'rotate') delete overrides.geometry.rotation
            }
          }
        } else if (style.type === 'attributes' && Object.hasOwn(style.patch, 'src')) delete overrides.src
        records[key] = { ...record, ...(Object.keys(after.scope).length ? { scope: after.scope } : { scope: undefined }),
          binding: { ...record.binding, path: after.path, baseline: after.value }, overrides }
        changedRecords = true
      }
      const updated = changedRecords ? patchHtmlAuthoringRecords(edit.source, records) : edit.source
      const result = await this.dependencies.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch,
        operationId: request.operationId, baseRevision: snapshot.revision, actor: 'human',
        mutation: { type: 'command', command: { type: 'markdown.replace', source: updated } } })
      if (result.status === 'unchanged') return { status: 'unchanged', revision: result.revision }
      if (result.status !== 'applied') return { status: 'rejected', reason: 'conflict' }
      return { status: 'applied', revision: result.revision, savedRevision: null, dirty: true, reload: true }
    })
  }

  async resolveTarget(request: ResolveRequest, context: HtmlPreviewEditContext): Promise<{ revision: number; targets: HtmlPreviewResolvedTarget[] }> {
    const model = context.snapshot.model
    if (model.kind !== 'text') throw new Error('HTML 文档已变化')
    const identity = { documentId: context.snapshot.documentId, epoch: context.snapshot.epoch,
      revision: context.snapshot.revision, bindingVersion: context.lease.bindingVersion }
    const targets = request.targets.map(report => {
      let resolved = locateHtmlSourceTarget(model.source, report, identity)
      if (resolved.status !== 'editable' && report.authoring?.record.kind === report.kind
        && report.bindingStatus !== 'unresolved' && report.bindingStatus !== 'source-required') {
        resolved = { handle: report.handle, status: 'editable', locator: { ...identity, targetKind: report.kind,
          elementSpan: { start: 0, end: 0 }, valueSpan: null, attributeName: report.attributeName,
          expectedRaw: report.rawText, authoring: report.authoring } }
      }
      this.records.set(recordKey(request.leaseId, request.loadId, report.handle), { revision: request.revision, report, resolved })
      return resolved
    })
    return { revision: context.snapshot.revision, targets }
  }

  async edit(request: EditRequest, context: HtmlPreviewEditContext): Promise<HtmlPreviewEditOutcome> {
    const record = this.records.get(recordKey(request.leaseId, request.loadId, request.target))
    if (!record || record.revision !== request.baseRevision || record.resolved.status !== 'editable'
      || ((request.change.kind === 'text' || request.change.kind === 'image') && record.report.kind !== request.change.kind)) return { status: 'rejected', reason: 'not-editable' }
    const resolvedRecord = record.resolved
    return this.dependencies.withFileAccess(async () => {
      const snapshot = await this.dependencies.readDocument(request.documentId)
      if (!matchingSnapshot(snapshot, request, context)) return { status: 'rejected', reason: 'stale-revision' }
      if (snapshot.model.kind !== 'text') return { status: 'rejected', reason: 'not-editable' }
      const source = snapshot.model.source
      const sourceRecords = readHtmlAuthoringRecords(source)
      const described = record.report.authoring
      const existing = described && sourceRecords[described.authorKey]
      const ownsValue = existing && (request.change.kind === 'text' ? existing.overrides.text !== undefined
        : request.change.kind === 'image' ? existing.overrides.src !== undefined
          : request.change.kind === 'style' ? Boolean(existing.overrides.style) : true)
      let authoring = resolvedRecord.locator.authoring ?? ((request.change.kind === 'geometry' || ownsValue) ? described : undefined)
      if (authoring) {
        let authorSource = source
        if (request.change.kind === 'geometry' && !resolvedRecord.locator.authoring) {
          const path = authoring.record.binding.path.map(step => ({ ...step, ...(step.attributes ? { attributes: { ...step.attributes } } : {}) }))
          const last = path.at(-1)
          if (!last) return { status: 'rejected', reason: 'not-editable' }
          last.attributes = { ...last.attributes, 'data-cw-author-key': authoring.authorKey }
          const locator = resolvedRecord.locator
          const patch = applyHtmlSourceEdit(source, { type: 'attributes', target: { kind: 'element', from: locator.elementSpan.start,
            to: locator.elementSpan.end }, patch: { 'data-cw-author-key': authoring.authorKey } })
          if (!patch.ok) return { status: 'rejected', reason: patch.reason }
          authorSource = patch.source
          authoring = { ...authoring, record: { ...authoring.record, binding: { ...authoring.record.binding, path } } }
        }
        const records = readHtmlAuthoringRecords(source)
        const previous = records[authoring.authorKey]
        const current = previous ? { ...previous, ...(authorSource !== source ? { binding: authoring.record.binding } : {}) } : authoring.record
        const overrides = { ...current.overrides }
        let patchValue = record.report.rawText
        if (request.change.kind === 'text') { overrides.text = request.change.value; patchValue = request.change.value }
        else if (request.change.kind === 'image') {
          const prepared = await prepareHtmlImage({ entryRealPath: context.entryRealPath, rootRealPath: context.rootRealPath,
            operationId: request.operationId, ...request.change })
          overrides.src = prepared.relativeUrl; patchValue = prepared.relativeUrl
        } else if (request.change.kind === 'geometry') overrides.geometry = { ...overrides.geometry, ...request.change.geometry }
        else {
          const style = { ...overrides.style }
          for (const [key, value] of Object.entries(request.change.patch)) {
            if (value === null) delete style[key]; else style[key] = value
          }
          overrides.style = style
        }
        records[authoring.authorKey] = { ...current, overrides }
        const updated = patchHtmlAuthoringRecords(authorSource, records)
        if (updated === source) return { status: 'unchanged', revision: snapshot.revision }
        const result = await this.dependencies.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch,
          operationId: request.operationId, baseRevision: snapshot.revision, actor: 'human',
          mutation: { type: 'command', command: { type: 'markdown.replace', source: updated } } })
        if (result.status !== 'applied') return result.status === 'unchanged' ? { status: 'unchanged', revision: result.revision }
          : { status: 'rejected', reason: 'conflict' }
        return { status: 'applied', revision: result.revision, savedRevision: null, dirty: true,
          patch: { handle: request.target, kind: record.report.kind, value: patchValue, authoringRecords: records } }
      }
      const located = locateHtmlSourceTarget(source, record.report, {
        documentId: snapshot.documentId, epoch: snapshot.epoch, revision: snapshot.revision,
        bindingVersion: request.bindingVersion,
      })
      if (located.status !== 'editable') return { status: 'rejected', reason: 'source-changed' }
      const locator = located.locator
      if (request.change.kind === 'style') {
        const edit = applyHtmlSourceEdit(source, { type: 'style', target: { kind: 'element', from: locator.elementSpan.start, to: locator.elementSpan.end }, patch: request.change.patch })
        if (!edit.ok) return { status: 'rejected', reason: edit.reason }
        const result = await this.dependencies.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch,
          operationId: request.operationId, baseRevision: snapshot.revision, actor: 'human',
          mutation: { type: 'command', command: { type: 'markdown.replace', source: edit.source } } })
        if (result.status !== 'applied') return result.status === 'unchanged' ? { status: 'unchanged', revision: result.revision } : { status: 'rejected', reason: 'conflict' }
        return { status: 'applied', revision: result.revision, savedRevision: null, dirty: true, patch: { handle: request.target, kind: record.report.kind, value: record.report.rawText } }
      }
      if (request.change.kind === 'geometry') return { status: 'rejected', reason: 'not-editable' }
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
      let updated = applySplices(source, edits)
      if (updated === null) { await removeUnreferencedPreparedImage(); return { status: 'rejected', reason: 'not-editable' } }
      // An exact source edit retains this object's unrelated geometry/style owner.
      if (described && existing) {
        sourceRecords[described.authorKey] = { ...existing, binding: { ...existing.binding, baseline: patchValue } }
        updated = patchHtmlAuthoringRecords(updated, sourceRecords)
      }
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
          ...(described && existing ? { authoringRecords: sourceRecords } : {}),
          ...(request.change.kind === 'image' && edits.length > 1 ? { rewroteResponsive: true } : {}) } }
    })
  }
}
