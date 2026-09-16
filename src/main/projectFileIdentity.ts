import { unzipSync } from 'fflate'
import { courseProjectDocumentSchema } from '../shared/courseProjectSchema'
import { readProjectFileBytes } from './fileDialogs'
import { createWorkspaceIdentity } from './workspaceIdentity'
import { MAX_RECOVERY_PROJECT_BYTES } from './projectPersistence'

/** Main-side identity read uses the existing bounded file reader and the strict shared V9 contract. */
export async function readCourseProjectFileIdentity(filename: string) {
  try {
    const bytes = await readProjectFileBytes(filename)
    const entry = unzipSync(bytes, { filter: item => item.name === 'project.json' && item.originalSize <= MAX_RECOVERY_PROJECT_BYTES })['project.json']
    if (!entry) throw new Error('Missing project.json')
    const document = courseProjectDocumentSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entry)))
    return createWorkspaceIdentity(document.id, filename)
  } catch (cause) {
    throw new Error('课例工程无法读取或格式不受支持，请重新打开或修复工程后创建对话。', { cause })
  }
}
