import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { LessonWorkspaceService } from '../../../../src/main/lessonWorkspace'
import { LessonMaterials } from '../../../../src/main/lessonMaterials'
import { extractMaterial } from '../../../../src/renderer/project/materialExtraction'
import { snapshotSelectedLessonMaterials } from '../../../../src/main/workbench/execution/MaterialReadTools'
import { MATERIAL_TEXT, r19LessonMaterials } from '../../../fixtures/r19LessonMaterials'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'pdfjs-dist/build/pdf.worker.min.mjs' }))

it('freezes only teacher-selected content from the real lesson material owner with DOCX paragraph provenance and no fabricated pages or model-owned target IDs', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'T09-selected-'))
  try {
    const workspaceRoot = path.join(directory, 'workspace'); await fs.mkdir(workspaceRoot)
    const workspace = new LessonWorkspaceService(path.join(directory, 'user-data'))
    const lesson = await workspace.create(workspaceRoot, 'Teacher source lesson')
    const target = { lessonId: lesson.identity.lessonId, rootPath: lesson.identity.normalizedDirectory }
    const materials = new LessonMaterials(async () => { await workspace.read(lesson.identity) })
    const docx = r19LessonMaterials().find(material => material.format === 'docx')!
    const selected = await materials.import(target, { title: 'Teacher DOCX', original: docx.bytes, extraction: await extractMaterial(docx.bytes, docx.name) })
    const unrelated = new TextEncoder().encode('UNSELECTED OTHER SOURCE')
    await materials.import(target, { title: 'Unselected notes', original: unrelated, extraction: await extractMaterial(unrelated, 'notes.txt') })
    const chosen = selected.fragments.find(fragment => fragment.kind === 'text')!
    const selection = { id: selected.id, extractionVersion: selected.extractionVersion, fragmentIds: [chosen.id] }
    const messages = await snapshotSelectedLessonMaterials({ target, selections: [selection] }, { workspaceRoot, permission: 'workspace' })
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({ role: 'user' })
    const body = (messages[0].content as { type: string; text?: string }[]).map(part => part.text ?? '').join('\n')
    expect(body).toContain(MATERIAL_TEXT)
    expect(body).toContain('word/document.xml')
    expect(body).toContain('paragraph')
    expect(body).not.toContain('"page"')
    expect(body).not.toContain('UNSELECTED OTHER SOURCE')
    expect(body).not.toContain(selected.id)
    expect(body).not.toContain(lesson.identity.lessonId)
    expect(JSON.stringify(messages)).not.toContain('image_url')
    await expect(snapshotSelectedLessonMaterials({ target, selections: [{ ...selection, extractionVersion: 'stale-version' }] }, { workspaceRoot })).rejects.toThrow('版本已变化')
    const outsider = path.join(directory, 'other-workspace'); await fs.mkdir(outsider)
    await expect(snapshotSelectedLessonMaterials({ target, selections: [selection] }, { workspaceRoot: outsider })).rejects.toThrow('已授权读取')
  } finally {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe fixture cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
