export interface ExtractedResourceOrigin {
  kind: 'data-uri' | 'relative'
  context: 'html-attr' | 'srcset' | 'css-url' | 'js-string' | 'unknown'
  /** data URI 只保留前 64 个字符。 */
  reference: string
}

export interface ExtractedResource {
  /** sha256 hex */
  key: string
  mediaType: string
  bytes: Uint8Array
  origins: ExtractedResourceOrigin[]
}

export interface RemoteReference {
  url: string
  context: 'html-attr' | 'srcset' | 'css-url' | 'js-string' | 'unknown'
  usage: 'image' | 'media' | 'script' | 'stylesheet' | 'font' | 'unknown'
}

export interface ImportDiagnostic {
  level: 'info' | 'warning' | 'error'
  code: string
  message: string
  reference?: string
}

export interface ExtractHtmlResourcesInput {
  html: string
  /** 键为相对 HTML 所在目录的规范化路径，`/` 分隔。 */
  siblingFiles?: ReadonlyMap<string, Uint8Array>
}

export interface ExtractHtmlResourcesResult {
  html: string
  resources: ExtractedResource[]
  remoteReferences: RemoteReference[]
  diagnostics: ImportDiagnostic[]
}
