import { nanoid } from 'nanoid'
import { inspectProjectFont } from '../../shared/fonts/projectFontFile'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { EditorTransactionPlan } from '../authoring/editorTransaction'
import { applyCourseAssetImports } from '../project/v9AssetAdapter'
import { commitCourseProjectMutation } from './courseProjectMutation'

export async function planProjectFontImport(document: CourseProjectDocument, filename: string, bytes: Uint8Array): Promise<{ assetId: string; transaction: EditorTransactionPlan }> {
  const format = inspectProjectFont(bytes)
  const leaf = filename.replace(/\\/g, '/').split('/').pop()?.trim()
  if (!leaf || leaf.length > 500) throw new Error('字体文件名无效')
  if (typeof FontFace !== 'undefined') {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        new FontFace(`course-import-${nanoid(10)}`, new Uint8Array(bytes).buffer).load(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('字体解码超时')), 5000) }),
      ])
    } finally { if (timer) clearTimeout(timer) }
  }
  const assetId = `font-${nanoid(12)}`
  const meta = { id: assetId, filename: leaf, kind: 'font' as const, mimeType: format.mimeType,
    path: `assets/${assetId}.${format.extension}`, byteLength: bytes.byteLength }
  const nextDocument = commitCourseProjectMutation(document, draft => { applyCourseAssetImports(draft.assets, {}, [{ meta, bytes }]) })
  return { assetId, transaction: { projectId: document.id, baseRevision: document.revision, nextDocument,
    resourceChanges: { assetFileChanges: [{ assetId, after: bytes }] } } }
}
