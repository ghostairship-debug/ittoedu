/** Extracted material is evidence of available content, never evidence of model reading. */
export interface MaterialFragment {
  id: string
  kind: 'text' | 'table' | 'image' | 'formula'
  locator: { part: string; page?: number; paragraph?: number }
  text?: string
  assetId?: string
}
export interface MaterialExtraction {
  version: 1
  extractorVersion: string
  format: 'pdf' | 'docx' | 'pptx' | 'text' | 'image'
  fragments: MaterialFragment[]
  assets: { id: string; mime: string; bytes: Uint8Array }[]
  gaps: { locator: MaterialFragment['locator']; reason: string; resolution?: { kind: 'read-page-image'; assetId: string } }[]
}
export const MATERIAL_EXTRACTION_LIMITS = { sourceBytes: 32 * 1024 * 1024, outputBytes: 128 * 1024 * 1024, pages: 100, textCharacters: 2 * 1024 * 1024 } as const

export interface LessonMaterialTarget { lessonId: string; rootPath: string }
export interface LessonMaterialRecord {
  version: 1
  id: string
  lessonId: string
  title: string
  createdAt: number
  sourceVersion: string
  extractionVersion: string
  sourcePath: string
  format: MaterialExtraction['format']
  extractorVersion: string
  fragments: MaterialFragment[]
  assets: { id: string; mime: string; path: string; version: string }[]
  gaps: MaterialExtraction['gaps']
}
export interface LessonMaterialRead {
  materialId: string
  sourceVersion: string
  extractionVersion: string
  readAt: number
  fragments: MaterialFragment[]
  assets: MaterialExtraction['assets']
}
