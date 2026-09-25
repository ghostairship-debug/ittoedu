import type { DocumentCommand, DocumentDriver, DocumentModel } from '../../shared/workbench/document'
import { cloneDocumentResources, emptyDocumentResources } from './resources'

function sourceIsValid(source: string): void {
  if (typeof source !== 'string' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(source)) throw new TypeError('Markdown 必须是有效 Unicode 源文')
}

export const createMarkdownDriver = (): DocumentDriver => new MarkdownDriver()

function markdown(model: DocumentModel): asserts model is Extract<DocumentModel, { kind: 'markdown' }> {
  if (model.kind !== 'markdown') throw new TypeError('Markdown Driver 不接受其他文档格式')
}

/** Markdown source is authoritative. Parsing/rendering never rewrites the saved text. */
export class MarkdownDriver implements DocumentDriver {
  readonly kind = 'markdown' as const
  validate(model: DocumentModel): void {
    markdown(model)
    sourceIsValid(model.source)
    cloneDocumentResources(model.resources, true)
  }
  apply(model: DocumentModel, command: DocumentCommand): DocumentModel {
    this.validate(model)
    markdown(model)
    let source: string
    if (command.type === 'markdown.replace') source = command.source
    else if (command.type === 'markdown.splice') {
      const { from, to, text } = command
      sourceIsValid(text)
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to > model.source.length) {
        throw new RangeError('Markdown 修改范围已失效')
      }
      // Offsets use the same UTF-16 convention as the editor; splitting a scalar is never a valid edit.
      sourceIsValid(model.source.slice(0, from))
      sourceIsValid(model.source.slice(to))
      source = model.source.slice(0, from) + text + model.source.slice(to)
    } else throw new TypeError('Markdown Driver 不支持该操作')
    sourceIsValid(source)
    return { kind: 'markdown', source, resources: cloneDocumentResources(command.resources ?? model.resources, true) }
  }
  withRevision(model: DocumentModel, revision: number): DocumentModel {
    this.validate(model)
    if (!Number.isSafeInteger(revision) || revision < 0) throw new RangeError('文档版本无效')
    return model
  }
  load(bytes: Uint8Array): DocumentModel {
    // ignoreBOM preserves a literal UTF-8 BOM, as well as CRLF and final newlines.
    const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    sourceIsValid(source)
    return { kind: 'markdown', source, resources: emptyDocumentResources() }
  }
  serialize(model: DocumentModel): Uint8Array {
    this.validate(model)
    markdown(model)
    return new TextEncoder().encode(model.source)
  }
}
