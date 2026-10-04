// @vitest-environment node
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { PixabaySettingsStore } from '../../src/main/workbench/assetSources/PixabaySettingsStore'
import { createWorkbenchOpenImageService, operatePixabaySettings, readPixabayDefaultKey } from '../../src/main/workbench/assetSources/pixabayDesktopService'
import { publicAssetHttp } from '../../src/main/workbench/assetSources/publicAssetHttp'
import type { AssetHttpPort } from '../../src/main/workbench/assetSources/assetSourceTypes'
import type { CredentialEncryptionPort } from '../../src/main/workbench/providers/providerCredentials'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })
async function directory() { const value = await mkdtemp(path.join(tmpdir(), 'guoling-pixabay-')); directories.push(value); return value }
function encryption() {
  const values = new Map<string, string>()
  const port: CredentialEncryptionPort = {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn(plaintext => { const ref = `ciphertext-${values.size}`; values.set(ref, plaintext); return Buffer.from(ref) }),
    decryptString: vi.fn(bytes => { const value = values.get(Buffer.from(bytes).toString()); if (!value) throw new Error('locked'); return value }),
  }
  return port
}
const fixtureHit = { id: 1, tags: 'flower', user: 'Fixture', pageURL: 'https://pixabay.com/photos/flower-1/',
  largeImageURL: 'https://cdn.pixabay.com/flower.jpg', imageWidth: 1280, imageHeight: 800 }
function fixtureHttp() {
  const getJson = vi.fn(async (raw: string) => {
    const url = new URL(raw)
    if (url.origin === 'https://pixabay.com') return { totalHits: 1, hits: [fixtureHit] }
    if (url.origin === 'https://commons.wikimedia.org') return { query: { pages: [] } }
    if (url.origin === 'https://api.openverse.org') return { results: [], next: null }
    throw new Error('Unexpected network endpoint')
  })
  return { getJson, getBytes: vi.fn(async () => { throw new Error('unused') }) } satisfies AssetHttpPort
}

it('the production composition searches Pixabay with the build default, a secure override, and the restored default', async () => {
  const store = new PixabaySettingsStore({ directory: await directory(), encryption: encryption(), defaultKey: 'build-fixture' })
  const http = fixtureHttp(), open = createWorkbenchOpenImageService('fixture', { http, settings: store })
  open.beginRun('product')
  expect(await open.search({ runId: 'product', query: 'default' })).toMatchObject({ status: 'results', candidates: [{ source: 'Pixabay' }] })
  expect(new URL(http.getJson.mock.calls.find(([url]) => url.startsWith('https://pixabay.com'))![0]).searchParams.get('key')).toBe('build-fixture')
  expect(await operatePixabaySettings({ type: 'save-key', key: 'user-fixture' }, store)).toMatchObject({ hasUserKey: true, hasDefaultKey: true })
  await open.search({ runId: 'product', query: 'override' })
  expect(new URL(http.getJson.mock.calls.filter(([url]) => url.startsWith('https://pixabay.com')).at(-1)![0]).searchParams.get('key')).toBe('user-fixture')
  await operatePixabaySettings({ type: 'save-key', key: null }, store)
  await open.search({ runId: 'product', query: 'restored' })
  expect(new URL(http.getJson.mock.calls.filter(([url]) => url.startsWith('https://pixabay.com')).at(-1)![0]).searchParams.get('key')).toBe('build-fixture')
})

it('no key skips Pixabay, keeps a successful search, and never sends a Pixabay request', async () => {
  const store = new PixabaySettingsStore({ directory: await directory(), encryption: encryption() })
  const http = fixtureHttp(), open = createWorkbenchOpenImageService('fixture', { http, settings: store })
  open.beginRun('no-key')
  expect(await open.search({ runId: 'no-key', query: 'flowers' })).toMatchObject({ status: 'results',
    unavailable: [{ library: 'Pixabay', reason: expect.stringContaining('未配置') }] })
  expect(http.getJson.mock.calls.every(([url]) => !url.startsWith('https://pixabay.com'))).toBe(true)
})

it('stores only ciphertext, reopens through the same encryption port, and preserves the override when encryption fails', async () => {
  const folder = await directory(), port = encryption(), store = new PixabaySettingsStore({ directory: folder, encryption: port })
  await store.saveKey('user-fixture')
  expect(await readFile(path.join(folder, 'pixabay-key.enc'), 'utf8')).not.toContain('user-fixture')
  const reopened = new PixabaySettingsStore({ directory: folder, encryption: port })
  expect(await reopened.resolveKey()).toBe('user-fixture')
  expect(JSON.stringify(await operatePixabaySettings({ type: 'read' }, reopened))).not.toContain('user-fixture')
  vi.mocked(port.encryptString).mockImplementation(() => { throw new Error('echo replacement-key') })
  await expect(operatePixabaySettings({ type: 'save-key', key: 'replacement-key' }, reopened)).rejects.toThrow('原设置已保留')
  expect(await reopened.resolveKey()).toBe('user-fixture')
  vi.mocked(port.isEncryptionAvailable).mockReturnValue(false)
  await expect(reopened.resolveKey()).rejects.toThrow('本次跳过')
  expect(await reopened.saveKey(null)).toMatchObject({ hasUserKey: false, secureStorageAvailable: false })
})

it('only the explicit distributor build input produces a loadable product default; ordinary development keys do not', async () => {
  const { writePixabayDefaultKey } = await import(pathToFileURL(path.resolve('scripts/build-pixabay-default-key.mjs')).href)
  const output = await directory(), location = path.join(output, 'main/workbench/assetSources')
  await writePixabayDefaultKey(output, { PIXABAY_API_KEY: 'development-only' })
  expect(await readPixabayDefaultKey(location)).toBeUndefined()
  await writePixabayDefaultKey(output, { GUOLING_PIXABAY_DEFAULT_KEY: 'distributor-fixture', PIXABAY_API_KEY: 'development-only' })
  expect(await readPixabayDefaultKey(location)).toBe('distributor-fixture')
  await writePixabayDefaultKey(output, {})
  expect(await readPixabayDefaultKey(location)).toBeUndefined()
})

it('transport errors cannot expose the key through search results', async () => {
  const http = fixtureHttp()
  http.getJson.mockImplementation(async raw => { throw new Error(`failed request ${raw}`) })
  const open = createWorkbenchOpenImageService('fixture', { http, settings: { resolveKey: async () => 'secret-fixture' } })
  open.beginRun('error')
  const result = await open.search({ runId: 'error', query: 'flowers' })
  expect(result).toMatchObject({ status: 'failed', failures: expect.arrayContaining([{ library: 'Pixabay', reason: 'Pixabay 检索未完成，请检查网络后重试' }]) })
  expect(JSON.stringify(result)).not.toContain('secret-fixture')
})

it('AssetHttp forwards unrestricted downloads and retains explicitly requested preview sampling', async () => {
  const transport = vi.fn(async (url: string, _options?: { maxBytes?: number }) => ({ url, status: 200, contentType: 'image/png', bytes: new Uint8Array([1]) }))
  const http = publicAssetHttp('fixture', transport)
  await http.getBytes('https://cdn.pixabay.com/file.png', {})
  expect(transport.mock.calls[0]![1]?.maxBytes).toBeUndefined()
  await http.getBytes('https://cdn.pixabay.com/preview.png', { maxBytes: 20 * 1024 * 1024 })
  expect(transport.mock.calls[1]![1]?.maxBytes).toBe(20 * 1024 * 1024)
})
