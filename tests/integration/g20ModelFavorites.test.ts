// @vitest-environment node
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ExecutionSettingsStore } from '../../src/main/workbench/providers/ExecutionSettingsStore'
import { ExecutionSettingsDesktopService } from '../../src/main/workbench/providers/executionSettingsService'
import type { CredentialEncryptionPort } from '../../src/main/workbench/providers/providerCredentials'
import type { ExecutionConnectionConfiguration, ExecutionModelFavorite, ExecutionProfile } from '../../src/shared/workbench/executionSettings'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    const relative = path.relative(os.tmpdir(), path.resolve(directory))
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('fixture outside temp')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

function encryption(): CredentialEncryptionPort {
  const key = randomBytes(32)
  return {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv)
      const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), bytes])
    },
    decryptString(input) {
      const bytes = Buffer.from(input), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12))
      decipher.setAuthTag(bytes.subarray(12, 28))
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8')
    },
  }
}

const config = (accountId = 'account-one'): ExecutionConnectionConfiguration => ({
  provider: 'fixture-provider', protocol: 'openai-chat', baseURL: 'https://fixture.invalid/v1',
  accountId, authKind: 'api-key', billing: { kind: 'token-plan' },
  capabilities: { tools: 'unknown', vision: 'unknown', stream: 'unknown', reasoning: 'unknown' },
})

async function setup() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-model-favorites-'))
  directories.push(directory)
  const options = { directory, encryption: encryption(), now: () => new Date('2026-10-03T01:02:03Z') }
  return { directory, options, store: new ExecutionSettingsStore(options) }
}

function expectFavorites(actual: ExecutionModelFavorite[] | undefined, expected: ExecutionModelFavorite[]) {
  expect(actual).toHaveLength(expected.length)
  expect(actual).toEqual(expect.arrayContaining(expected))
}

it('persists idempotent favorites by connection and model across connection revisions and a real settings reopen', async () => {
  const { directory, options, store } = await setup()
  expect((await store.read()).modelFavorites).toEqual([])
  const first = await store.saveConnection({ connection: config(), apiKey: 'fixture-first-key' })
  const second = await store.saveConnection({ connection: config('account-two'), apiKey: 'fixture-second-key' })
  const firstFavorite = { connectionId: first.connection.id, model: 'unlisted-model' }
  const secondFavorite = { connectionId: second.connection.id, model: 'unlisted-model' }
  const before = await store.read()
  expect(before.capabilityRecords).toEqual([])
  expect(await store.cachedModelCatalog(first.connection.id, first.connection.revision)).toBeUndefined()
  const service = new ExecutionSettingsDesktopService(store)
  expect(await service.operate({ type: 'set-model-favorite', input: { ...firstFavorite, favorite: true } })).toEqual([firstFavorite])
  expect(await service.operate({ type: 'read' })).toMatchObject({ modelFavorites: [firstFavorite] })
  expect(await store.setModelFavorite({ ...firstFavorite, favorite: true })).toEqual([firstFavorite])
  expectFavorites(await store.setModelFavorite({ ...secondFavorite, favorite: true }), [firstFavorite, secondFavorite])
  const updated = await store.saveConnection({ id: first.connection.id, expectedRevision: first.connection.revision,
    connection: { ...config(), billing: { kind: 'prepaid' } } })
  expect(updated.connection.revision).toBe(first.connection.revision + 1)
  const after = await store.read()
  expectFavorites(after.modelFavorites, [firstFavorite, secondFavorite])
  expect(after.profile).toEqual(before.profile)
  expect(after.capabilityRecords).toEqual(before.capabilityRecords)
  const filename = path.join(directory, 'execution-settings-v1.json')
  const persisted = JSON.parse(await fs.readFile(filename, 'utf8')) as { modelFavorites: ExecutionModelFavorite[] }
  expectFavorites(persisted.modelFavorites, [firstFavorite, secondFavorite])
  const reopened = new ExecutionSettingsStore(options)
  const view = await reopened.read()
  expectFavorites(view.modelFavorites, [firstFavorite, secondFavorite])
  expect(view.connections.find(entry => entry.connection.id === first.connection.id)?.connection.revision).toBe(updated.connection.revision)
  expect(view.profile).toEqual(before.profile)
})

it('defaults a legacy missing favorites field to empty, preserves selected role parameters on removal, and serializes multi-store changes', async () => {
  const { directory, options, store } = await setup()
  const saved = await store.saveConnection({ connection: config(), apiKey: 'fixture-current-key' })
  const current = { connectionId: saved.connection.id, model: 'current-model' }
  const roles: ExecutionProfile['roles'] = {
    conversation: { ...current, parameters: { reasoning_effort: 'high', temperature: 0.35 } },
    vision: { connectionId: saved.connection.id, model: 'vision-model', parameters: { detail: 'high' } },
    imageGenerate: null, imageEdit: null,
  }
  const profile = await store.saveProfile({ expectedRevision: 0, roles })
  await store.setModelFavorite({ ...current, favorite: true })
  const filename = path.join(directory, 'execution-settings-v1.json')
  const legacy = JSON.parse(await fs.readFile(filename, 'utf8'))
  delete legacy.modelFavorites
  await fs.writeFile(filename, JSON.stringify(legacy))
  const reopened = new ExecutionSettingsStore(options)
  const legacyView = await reopened.read()
  expect(legacyView.modelFavorites).toEqual([])
  expect(legacyView.profile).toEqual(profile)
  expect((await reopened.read()).modelFavorites).toEqual([])
  const selected = await reopened.snapshot('conversation')
  await reopened.setModelFavorite({ ...current, favorite: true })
  expect(await reopened.setModelFavorite({ ...current, favorite: false })).toEqual([])
  expect(await reopened.snapshot('conversation')).toEqual(selected)
  expect((await reopened.read()).profile).toEqual(profile)
  expect((await new ExecutionSettingsStore(options).read()).modelFavorites).toEqual([])
  expect((JSON.parse(await fs.readFile(filename, 'utf8')) as { modelFavorites: ExecutionModelFavorite[] }).modelFavorites).toEqual([])

  const removed = { connectionId: saved.connection.id, model: 'remove-me' }
  const addedA = { connectionId: saved.connection.id, model: 'new-a' }
  const addedB = { connectionId: saved.connection.id, model: 'new-b' }
  await reopened.setModelFavorite({ ...removed, favorite: true })
  const other = new ExecutionSettingsStore(options), third = new ExecutionSettingsStore(options)
  expectFavorites((await other.read()).modelFavorites, [removed])
  expectFavorites((await third.read()).modelFavorites, [removed])
  await Promise.all([
    reopened.setModelFavorite({ ...removed, favorite: false }),
    other.setModelFavorite({ ...addedA, favorite: true }),
    third.setModelFavorite({ ...addedB, favorite: true }),
  ])
  const final = await new ExecutionSettingsStore(options).read()
  expectFavorites(final.modelFavorites, [addedA, addedB])
  expect(final.profile).toEqual(profile)
  expect(await reopened.snapshot('conversation')).toEqual(selected)
})
