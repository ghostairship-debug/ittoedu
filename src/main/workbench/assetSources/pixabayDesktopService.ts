import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pixabaySettingsRequestSchema } from '../../../shared/workbench/pixabaySettingsDesktop'
import { DesktopOperationError } from '../../errors'
import { createElectronCredentialEncryption } from '../providers/providerCredentials'
import { PixabaySettingsStore } from './PixabaySettingsStore'
import { PixabaySource } from './pixabay'
import { OpenImageService } from './OpenImageService'
import { openLibraryUserAgent, publicAssetHttp } from './publicAssetHttp'
import type { AssetHttpPort } from './assetSourceTypes'

/** Only a build artifact supplies the product default. Development environment keys are never used. */
export async function readPixabayDefaultKey(directory = __dirname): Promise<string | undefined> {
  try {
    const value: unknown = JSON.parse(await fs.readFile(path.join(directory, 'pixabay-default-key.json'), 'utf8'))
    return value && typeof value === 'object' && 'key' in value && typeof value.key === 'string' && value.key.trim()
      && !/[\r\n\x00]/.test(value.key) ? value.key.trim() : undefined
  } catch { return undefined }
}

let singleton: Promise<PixabaySettingsStore> | undefined
export function pixabaySettingsStore(): Promise<PixabaySettingsStore> {
  return singleton ??= (async () => {
    const { app } = await import('electron')
    await app.whenReady()
    return new PixabaySettingsStore({ directory: path.join(app.getPath('userData'), 'workbench-v2', 'settings'),
      encryption: await createElectronCredentialEncryption(), defaultKey: await readPixabayDefaultKey() })
  })().catch(error => { singleton = undefined; throw error })
}

export async function operatePixabaySettings(raw: unknown, store?: PixabaySettingsStore) {
  const parsed = pixabaySettingsRequestSchema.safeParse(raw)
  if (!parsed.success) throw new DesktopOperationError('invalid-pixabay-settings', 'Pixabay 设置未完成', 'Pixabay 设置请求无效，原设置已保留', '请检查 API key。')
  try {
    const settings = store ?? await pixabaySettingsStore()
    return parsed.data.type === 'read' ? await settings.read() : await settings.saveKey(parsed.data.key)
  } catch {
    // No raw encryption, filesystem or request error (and hence no key) reaches IPC/logs.
    throw new DesktopOperationError('pixabay-settings-failed', 'Pixabay 设置未完成', '无法完成 Pixabay 设置，原设置已保留', '请检查系统安全存储后重试。')
  }
}

/** This is the production composition used by image.search; tests may supply a local HTTP fixture. */
export function createWorkbenchOpenImageService(version: string, options: {
  http?: AssetHttpPort; settings?: Pick<PixabaySettingsStore, 'resolveKey'>
} = {}): OpenImageService {
  return new OpenImageService({ http: options.http ?? publicAssetHttp(openLibraryUserAgent(version)),
    pixabay: new PixabaySource({ key: async () => (options.settings ?? await pixabaySettingsStore()).resolveKey() }) })
}
