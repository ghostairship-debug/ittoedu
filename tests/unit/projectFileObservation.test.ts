// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertProjectFileCurrent, prepareProjectFileObservation, projectFileStatus, rememberProjectFileBytes } from '../../src/main/projectFileObservation'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) {
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test root')
  await fs.rm(root, { recursive: true, force: true })
} })
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'project-file-observation-')); roots.push(root)
  const file = path.join(root, 'lesson.h5lesson'), bytes = new TextEncoder().encode('original course archive')
  await fs.writeFile(file, bytes)
  return { root, file, bytes }
}
describe('opened project file conflicts', () => {
  it('starts from acknowledged loaded bytes and detects an external overwrite before accepting a new baseline', async () => {
    const { file, bytes } = await fixture()
    const confirm = prepareProjectFileObservation(file, bytes)
    expect((await projectFileStatus(file)).status).toBe('unavailable')
    confirm()
    await expect(assertProjectFileCurrent(file)).resolves.toBeUndefined()
    await fs.writeFile(file, 'external CLI content')
    await expect(assertProjectFileCurrent(file)).rejects.toThrow('stale')
    expect((await projectFileStatus(file)).status).toBe('changed')
    expect(await fs.readFile(file, 'utf8')).toBe('external CLI content')
    rememberProjectFileBytes(file, new TextEncoder().encode('external CLI content'))
    expect((await projectFileStatus(file)).status).toBe('current')
  })
  it('does not confuse metadata-only changes with changes to the actual project bytes', async () => {
    const { file, bytes } = await fixture()
    rememberProjectFileBytes(file, bytes)
    await assertProjectFileCurrent(file)
    const later = new Date(Date.now() + 2000)
    await fs.utimes(file, later, later)
    expect((await projectFileStatus(file)).status).toBe('current')
  })
  it('rejects deletion and keeps Save As identities separate', async () => {
    const { root, file, bytes } = await fixture()
    rememberProjectFileBytes(file, bytes)
    const copy = path.join(root, 'copy.h5lesson')
    await fs.writeFile(copy, bytes); rememberProjectFileBytes(copy, bytes)
    await fs.rm(file)
    expect((await projectFileStatus(file)).status).toBe('changed')
    expect((await projectFileStatus(copy)).status).toBe('current')
  })
})
