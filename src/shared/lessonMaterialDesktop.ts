import type { LessonMaterialRead, LessonMaterialRecord, LessonMaterialTarget, MaterialExtraction } from './materialExtraction'
export interface LessonMaterialDesktopAPI {
  selectSource(input?: { path: string }): Promise<{ title: string; bytes: Uint8Array } | null>
  importMaterial(target: LessonMaterialTarget, input: { title: string; original: Uint8Array; extraction: MaterialExtraction }): Promise<LessonMaterialRecord>
  list(target: LessonMaterialTarget): Promise<LessonMaterialRecord[]>
  read(target: LessonMaterialTarget, input: { id: string; extractionVersion: string; fragmentIds: string[] }): Promise<LessonMaterialRead>
}
