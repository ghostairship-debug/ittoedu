// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalAgentRepository } from '../../src/main/localAgent/repository'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'
import { localAgentRecordV2Schema } from '../../src/shared/localAgentTaskContract'

const directories: string[] = []
const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
afterEach(async () => {
  vi.restoreAllMocks()
  Object.defineProperty(process, 'platform', platformDescriptor)
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
})
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-repository-lock-'))
  directories.push(directory)
  const workspace = createWorkspaceIdentity('repository-lock', path.join(directory, '课件.h5lesson'))
  const repository = new LocalAgentRepository(directory), id = randomUUID()
  const record = localAgentRecordV2Schema.parse({ version: 3, id, adapter: 'opencode', workspace,
    externalSessionId: 'before', workingDirectoryId: id, tasks: [], observations: [], hostResults: [], events: [] })
  await repository.write(record)
  return { repository, record, workspace, filename: path.join(repository.v2Directory(workspace), `${id}.json`),
    temporary: path.join(repository.v2Directory(workspace), `${id}.tmp`) }
}
const lockError = (code = 'EPERM') => Object.assign(new Error('rename failed'), { code, syscall: 'rename' })

describe('local agent repository bounded atomic replacement', () => {
  it('reads only the requested lesson record without enumerating history or quarantining an unrelated damaged record', async () => {
    const f = await fixture()
    const workspace = { version: 1 as const, kind: 'lesson' as const, lessonId: randomUUID(), normalizedDirectory: f.workspace.normalizedPath, conversationId: randomUUID() }
    const target = { ...f.record, workspace }
    await f.repository.write(target)
    const neighbor = path.join(f.repository.v2Directory(workspace), `${randomUUID()}.json`)
    await fs.writeFile(neighbor, 'not JSON')
    const readdir = vi.spyOn(fs, 'readdir'), readFile = vi.spyOn(fs, 'readFile')
    expect((await f.repository.read(workspace, target.id)).records).toMatchObject([{ id: target.id, workspace }])
    expect((await f.repository.read(workspace, target.id)).v2).toEqual([target])
    expect(readdir).not.toHaveBeenCalled()
    expect(readFile.mock.calls.some(([filename]) => filename === neighbor)).toBe(false)
    expect(await fs.readFile(neighbor, 'utf8')).toBe('not JSON')
    const listed = await f.repository.list(workspace)
    expect(listed.damaged).toEqual([path.basename(neighbor)])
    expect((await f.repository.read(workspace, target.id)).damaged).toEqual([])
    expect((await f.repository.read(workspace, path.basename(neighbor, '.json'))).damaged).toEqual([`${path.basename(neighbor)}.damaged`])
  })

  it('finds a project record stored in its lesson and isolates same UUID records in other scopes', async () => {
    const f = await fixture()
    await fs.unlink(f.filename)
    const lesson = { version: 1 as const, kind: 'lesson' as const, lessonId: randomUUID(), normalizedDirectory: f.workspace.normalizedPath, conversationId: randomUUID() }
    const target = { ...f.record, lessonWorkspace: lesson }
    const otherLesson = { ...lesson, lessonId: randomUUID(), conversationId: randomUUID() }
    const otherProject = { ...f.record.workspace, projectId: 'different-project' }
    await f.repository.write(target)
    await f.repository.write({ ...target, workspace: otherProject, lessonWorkspace: otherLesson, externalSessionId: 'other-native' })
    const neighborId = randomUUID()
    await f.repository.write({ ...target, id: neighborId })
    const readFile = vi.spyOn(fs, 'readFile')
    expect((await f.repository.read(f.record.workspace, target.id)).v2).toEqual([target])
    expect(readFile.mock.calls.some(([filename]) => String(filename).endsWith(`${neighborId}.json`))).toBe(false)
    expect((await f.repository.read(lesson, target.id)).v2).toEqual([target])
    expect((await f.repository.read(otherLesson, target.id)).records).toMatchObject([{ workspace: otherProject, externalSessionId: 'other-native' }])
    expect((await f.repository.read({ ...lesson, conversationId: randomUUID() }, target.id)).records).toEqual([])
    expect((await f.repository.read({ ...f.record.workspace, projectId: 'unbound-project' }, target.id)).records).toEqual([])
    // Even a file placed under the requested directory cannot override its recorded owner.
    await fs.writeFile(path.join(f.repository.v2Directory(lesson), `${target.id}.json`), JSON.stringify({ ...target, lessonWorkspace: otherLesson }))
    expect(await f.repository.read(lesson, target.id)).toEqual({ records: [], v2: [], damaged: [] })
  })

  it('retries only a complete temporary record and retains queue ordering', async () => {
    const f = await fixture(), nativeRename = fs.rename.bind(fs), snapshots: string[] = []
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const rename = vi.spyOn(fs, 'rename').mockImplementation(async (temporary, target) => {
      snapshots.push(JSON.parse(await fs.readFile(temporary, 'utf8')).externalSessionId)
      if (snapshots.length <= 2) throw lockError()
      await nativeRename(temporary, target)
    })
    const first = f.repository.write({ ...f.record, externalSessionId: 'first' })
    const readBetween = f.repository.list(f.record.workspace)
    const second = f.repository.write({ ...f.record, externalSessionId: 'second' })
    await first
    expect((await readBetween).v2[0]!.externalSessionId).toBe('first')
    await second
    expect(snapshots).toEqual(['first', 'first', 'first', 'second'])
    expect(rename).toHaveBeenCalledTimes(4)
    expect(JSON.parse(await fs.readFile(f.filename, 'utf8')).externalSessionId).toBe('second')
  })

  it('bounds persistent Windows sharing failures without replacing old JSON and lets the next write proceed', async () => {
    const f = await fixture(), original = await fs.readFile(f.filename, 'utf8')
    Object.defineProperty(process, 'platform', { value: 'win32' })
    const error = lockError(), rename = vi.spyOn(fs, 'rename').mockRejectedValue(error)
    await expect(f.repository.write({ ...f.record, externalSessionId: 'failed' })).rejects.toBe(error)
    expect(rename).toHaveBeenCalledTimes(6)
    expect(await fs.readFile(f.filename, 'utf8')).toBe(original)
    await expect(fs.stat(f.temporary)).rejects.toMatchObject({ code: 'ENOENT' })
    rename.mockRestore()
    await f.repository.write({ ...f.record, externalSessionId: 'recovered' })
    expect((await f.repository.list(f.record.workspace)).v2[0]!.externalSessionId).toBe('recovered')
  })

  it.each([['win32', 'ENOSPC'], ['linux', 'EPERM']] as const)('does not retry %s %s failures', async (platform, code) => {
    const f = await fixture()
    Object.defineProperty(process, 'platform', { value: platform })
    const error = lockError(code), rename = vi.spyOn(fs, 'rename').mockRejectedValue(error)
    await expect(f.repository.write({ ...f.record, externalSessionId: 'failed' })).rejects.toBe(error)
    expect(rename).toHaveBeenCalledOnce()
    expect(JSON.parse(await fs.readFile(f.filename, 'utf8')).externalSessionId).toBe('before')
  })

  it.runIf(process.platform === 'win32')('recovers after a real Windows destination reader closes, while sustained occupancy fails safely', async () => {
    const f = await fixture()
    const transient = await fs.open(f.filename, 'r')
    let closeTransient = Promise.resolve()
    const release = setTimeout(() => { closeTransient = transient.close() }, 45)
    try {
      await f.repository.write({ ...f.record, externalSessionId: 'after-release' })
      expect(JSON.parse(await fs.readFile(f.filename, 'utf8')).externalSessionId).toBe('after-release')
    } finally { clearTimeout(release); await closeTransient; await transient.close() }
    const held = await fs.open(f.filename, 'r')
    try {
      await expect(f.repository.write({ ...f.record, externalSessionId: 'must-not-replace' })).rejects.toMatchObject({ code: 'EPERM' })
      expect(JSON.parse(await fs.readFile(f.filename, 'utf8')).externalSessionId).toBe('after-release')
    } finally { await held.close() }
    await f.repository.write({ ...f.record, externalSessionId: 'next' })
    expect((await f.repository.list(f.record.workspace)).v2[0]!.externalSessionId).toBe('next')
  })
})
