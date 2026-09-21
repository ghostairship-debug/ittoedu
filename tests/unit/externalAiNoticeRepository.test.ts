// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalAgentRepository } from '../../src/main/localAgent/repository'
import { EXTERNAL_AI_NOTICE_VERSION } from '../../src/shared/externalAiNotice'
import type { AiWorkspaceIdentity } from '../../src/shared/workspaceIdentity'

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unexpected test directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

async function fixture() {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'external-ai-notice-'))
  directories.push(userData)
  const repository = new LocalAgentRepository(userData)
  const scope: AiWorkspaceIdentity = { version: 1, projectId: 'project-a', normalizedPath: 'c:/courses/a.h5lesson' }
  return { repository, scope }
}

describe('external AI notice repository', () => {
  it('persists the exact workspace identity and isolates Save As and conversation scopes', async () => {
    const { repository, scope } = await fixture()
    const saveAs: AiWorkspaceIdentity = { ...scope, normalizedPath: 'c:/courses/a-copy.h5lesson' }
    const conversation: AiWorkspaceIdentity = {
      version: 1,
      kind: 'directory',
      normalizedDirectory: 'c:/courses',
      conversationId: crypto.randomUUID(),
    }

    expect(await repository.readExternalAiNotice(scope)).toEqual({ version: EXTERNAL_AI_NOTICE_VERSION, confirmed: false })
    const confirmed = await repository.confirmExternalAiNotice(scope)
    expect(confirmed).toMatchObject({ version: EXTERNAL_AI_NOTICE_VERSION, confirmed: true })
    expect(await repository.readExternalAiNotice(scope)).toEqual(confirmed)
    expect(await repository.list(scope)).toEqual({ records: [], v2: [], damaged: [] })
    expect(await repository.listStoredWorkspaces()).toEqual([])
    expect(await repository.readExternalAiNotice(saveAs)).toEqual({ version: EXTERNAL_AI_NOTICE_VERSION, confirmed: false })
    expect(await repository.readExternalAiNotice(conversation)).toEqual({ version: EXTERNAL_AI_NOTICE_VERSION, confirmed: false })

    const stored = JSON.parse(await fs.readFile(path.join(repository.v2Directory(scope), 'external-ai-notice.json'), 'utf8'))
    expect(stored).toMatchObject({ schemaVersion: 1, noticeVersion: EXTERNAL_AI_NOTICE_VERSION, scope })
  })

  it('requires the current notice version and can retry after a failed atomic confirmation write', async () => {
    const { repository, scope } = await fixture()
    const directory = repository.v2Directory(scope)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'external-ai-notice.json'), JSON.stringify({
      schemaVersion: 1,
      noticeVersion: EXTERNAL_AI_NOTICE_VERSION + 1,
      scope,
      confirmedAt: Date.now(),
    }))
    expect(await repository.readExternalAiNotice(scope)).toEqual({ version: EXTERNAL_AI_NOTICE_VERSION, confirmed: false })

    const nativeRename = fs.rename.bind(fs)
    const failure = Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(failure)
    await expect(repository.confirmExternalAiNotice(scope)).rejects.toBe(failure)
    vi.mocked(fs.rename).mockImplementation(nativeRename)
    await expect(repository.confirmExternalAiNotice(scope)).resolves.toMatchObject({ confirmed: true })
    await expect(repository.readExternalAiNotice(scope)).resolves.toMatchObject({ confirmed: true })
  })

  it('serializes concurrent confirmations for one scope without sharing or stranding the temporary file', async () => {
    const { repository, scope } = await fixture()
    const results = await Promise.all(Array.from({ length: 8 }, () => repository.confirmExternalAiNotice(scope)))
    expect(results).toHaveLength(8)
    expect(results.every(result => result.confirmed)).toBe(true)
    await expect(fs.stat(path.join(repository.v2Directory(scope), 'external-ai-notice.json.tmp'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(repository.readExternalAiNotice(scope)).resolves.toMatchObject({ confirmed: true })
  })

  it('keys the confirmation by CLI so one confirmed adapter never sends through another', async () => {
    const { repository, scope } = await fixture()
    const confirmed = await repository.confirmExternalAiNotice(scope, 'codex')
    expect(confirmed).toMatchObject({ version: EXTERNAL_AI_NOTICE_VERSION, confirmed: true })
    expect(await repository.readExternalAiNotice(scope, 'codex')).toEqual(confirmed)
    expect(await repository.readExternalAiNotice(scope, 'claude')).toEqual({ version: EXTERNAL_AI_NOTICE_VERSION, confirmed: false })
    expect(await repository.readExternalAiNotice(scope, 'opencode')).toEqual({ version: EXTERNAL_AI_NOTICE_VERSION, confirmed: false })
    // 适配器无关的旧记录不是任一 CLI 的确认。
    expect(await repository.readExternalAiNotice(scope)).toEqual({ version: EXTERNAL_AI_NOTICE_VERSION, confirmed: false })

    const stored = JSON.parse(await fs.readFile(path.join(repository.v2Directory(scope), 'external-ai-notice.codex.json'), 'utf8'))
    expect(stored).toMatchObject({ schemaVersion: 1, noticeVersion: EXTERNAL_AI_NOTICE_VERSION, scope, adapter: 'codex' })
    await expect(fs.stat(path.join(repository.v2Directory(scope), 'external-ai-notice.claude.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a record whose stored CLI is not the one being asked about', async () => {
    const { repository, scope } = await fixture()
    const directory = repository.v2Directory(scope)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'external-ai-notice.claude.json'), JSON.stringify({
      schemaVersion: 1, noticeVersion: EXTERNAL_AI_NOTICE_VERSION, scope, adapter: 'codex', confirmedAt: Date.now(),
    }))
    expect(await repository.readExternalAiNotice(scope, 'claude')).toEqual({ version: EXTERNAL_AI_NOTICE_VERSION, confirmed: false })
    expect(await repository.readExternalAiNotice(scope, 'codex')).toEqual({ version: EXTERNAL_AI_NOTICE_VERSION, confirmed: false })
  })

  it('keeps concurrent confirmations of different adapters independent', async () => {
    const { repository, scope } = await fixture()
    const results = await Promise.all((['codex', 'claude', 'opencode'] as const).map(adapter => repository.confirmExternalAiNotice(scope, adapter)))
    expect(results.every(result => result.confirmed)).toBe(true)
    for (const adapter of ['codex', 'claude', 'opencode'] as const) {
      await expect(repository.readExternalAiNotice(scope, adapter)).resolves.toMatchObject({ confirmed: true })
      await expect(fs.stat(path.join(repository.v2Directory(scope), `external-ai-notice.${adapter}.json.tmp`))).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })
})
