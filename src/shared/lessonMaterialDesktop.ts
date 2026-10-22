import type { LessonMaterialList, LessonMaterialRead, LessonMaterialRecord, LessonMaterialTarget, MaterialExtraction } from './materialExtraction'
export interface LessonMaterialSource { title: string; bytes: Uint8Array }
export interface LessonMaterialSelectResult { sources: LessonMaterialSource[]; failures: { title: string; message: string }[] }
export interface LessonMaterialImportProgress { requestId: string; page: number; total: number }
export interface LessonMaterialPdfInput { requestId: string; title: string; original: Uint8Array; pages?: { from: number; to: number }; fromPage?: number }
export interface LessonMaterialDesktopAPI {
  selectSource(input?: { path: string }): Promise<LessonMaterialSelectResult>
  importMaterial(target: LessonMaterialTarget, input: { title: string; original: Uint8Array; extraction: MaterialExtraction }): Promise<LessonMaterialRecord>
  importPdf(target: LessonMaterialTarget, input: LessonMaterialPdfInput): Promise<LessonMaterialRecord>
  cancelImport(requestId: string): Promise<void>
  subscribeImportProgress(listener: (progress: LessonMaterialImportProgress) => void): () => void
  list(target: LessonMaterialTarget): Promise<LessonMaterialList>
  read(target: LessonMaterialTarget, input: { id: string; extractionVersion: string; fragmentIds: string[] }): Promise<LessonMaterialRead>
}
