import type { DocumentCommand, DocumentDriver, DocumentModel, DocumentResources } from '../../shared/workbench/document'
import { emptyDocumentResources } from './resources'

/** Decode failure is recognizable before the host wraps it for IPC. */
export class TextEncodingError extends Error {
  readonly code = 'TEXT_ENCODING_UNSUPPORTED'
  constructor(message = '不是 UTF-8 编码的文本文件') {
    super(message)
    this.name = 'TextEncodingError'
  }
}

function sourceIsValid(source: string): void {
  if (typeof source === 'string' && source.includes(String.fromCharCode(0))) throw new TextEncodingError('文件含二进制零字节，不能作为 UTF-8 源文编辑')
  if (typeof source !== 'string' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(source)) throw new TypeError('纯文本必须是有效 Unicode 源文')
}

function assertEmptyResources(resources: DocumentResources): void {
  if (!resources || typeof resources !== 'object' || Object.keys(resources.assets).length > 0 || Object.keys(resources.components).length > 0) {
    throw new TypeError('纯文本文档不接受资源')
  }
}

export const createTextDriver = (): DocumentDriver => new TextDriver()

function text(model: DocumentModel): asserts model is Extract<DocumentModel, { kind: 'text' }> {
  if (model.kind !== 'text') throw new TypeError('纯文本 Driver 不接受其他文档格式')
}

/** Plain text source is authoritative. The saved bytes are the UTF-8 text itself. */
export class TextDriver implements DocumentDriver {
  readonly kind = 'text' as const
  validate(model: DocumentModel): void {
    text(model)
    sourceIsValid(model.source)
    assertEmptyResources(model.resources)
  }
  apply(model: DocumentModel, command: DocumentCommand): DocumentModel {
    this.validate(model)
    text(model)
    let source: string
    if (command.type === 'markdown.replace') source = command.source
    else if (command.type === 'markdown.splice') {
      const { from, to, text: insert } = command
      sourceIsValid(insert)
      if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to > model.source.length) {
        throw new RangeError('纯文本修改范围已失效')
      }
      sourceIsValid(model.source.slice(0, from))
      sourceIsValid(model.source.slice(to))
      source = model.source.slice(0, from) + insert + model.source.slice(to)
    } else throw new TypeError('纯文本 Driver 不支持该操作')
    sourceIsValid(source)
    if (command.resources) assertEmptyResources(command.resources)
    return { kind: 'text', source, resources: emptyDocumentResources() }
  }
  withRevision(model: DocumentModel, revision: number): DocumentModel {
    this.validate(model)
    if (!Number.isSafeInteger(revision) || revision < 0) throw new RangeError('文档版本无效')
    return model
  }
  load(bytes: Uint8Array): DocumentModel {
    let source: string
    try {
      // ignoreBOM preserves a literal UTF-8 BOM, as well as CRLF and final newlines.
      source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    } catch (error) {
      if (error instanceof TypeError) throw new TextEncodingError()
      throw error
    }
    sourceIsValid(source)
    return { kind: 'text', source, resources: emptyDocumentResources() }
  }
  serialize(model: DocumentModel): Uint8Array {
    this.validate(model)
    text(model)
    return new TextEncoder().encode(model.source)
  }
}
