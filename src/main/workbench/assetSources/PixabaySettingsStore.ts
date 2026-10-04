import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { CredentialEncryptionPort } from '../providers/providerCredentials'
import type { PixabaySettingsView } from '../../../shared/workbench/pixabaySettingsDesktop'
import { LibraryUnavailableError } from './assetSourceTypes'

/** App-local ciphertext using the same OS safeStorage port as model credentials. */
export class PixabaySettingsStore {
  private readonly filename: string
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly options: { directory: string; encryption: CredentialEncryptionPort; defaultKey?: string }) {
    this.filename = path.join(options.directory, 'pixabay-key.enc')
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.catch(() => undefined).then(work)
    this.queue = result
    return result
  }

  private async encrypted(): Promise<Uint8Array | undefined> {
    try { return await fs.readFile(this.filename) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new LibraryUnavailableError('无法读取 Pixabay 安全凭据，本次跳过 Pixabay；请检查系统安全存储')
    }
  }

  private async view(): Promise<PixabaySettingsView> {
    return { hasUserKey: Boolean(await this.encrypted()), hasDefaultKey: Boolean(this.options.defaultKey),
      secureStorageAvailable: await this.options.encryption.isEncryptionAvailable() }
  }

  read(): Promise<PixabaySettingsView> { return this.serial(() => this.view()) }

  saveKey(key: string | null): Promise<PixabaySettingsView> {
    return this.serial(async () => {
      if (key === null) {
        await fs.rm(this.filename, { force: true })
        return this.view()
      }
      if (!key.trim() || /[\r\n\x00]/.test(key)) throw new Error('Pixabay API key 无效，原设置已保留')
      if (!await this.options.encryption.isEncryptionAvailable()) throw new Error('系统安全凭据存储不可用，原设置已保留')
      let encrypted: Uint8Array
      try { encrypted = await this.options.encryption.encryptString(key.trim()) }
      catch { throw new Error('Pixabay 凭据加密失败，原设置已保留') }
      const temporary = `${this.filename}.tmp`
      try {
        await fs.mkdir(this.options.directory, { recursive: true })
        await fs.writeFile(temporary, encrypted, { mode: 0o600 })
        await fs.rename(temporary, this.filename)
      } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
      return this.view()
    })
  }

  /** Main-only, resolved per search so saving/removing an override takes effect immediately. */
  resolveKey(): Promise<string | undefined> {
    return this.serial(async () => {
      const encrypted = await this.encrypted()
      if (!encrypted) return this.options.defaultKey
      try {
        if (!await this.options.encryption.isEncryptionAvailable()) throw new Error()
        return await this.options.encryption.decryptString(encrypted)
      } catch { throw new LibraryUnavailableError('无法解密 Pixabay 用户 key，本次跳过 Pixabay；请在设置中重新保存或移除自有 key') }
    })
  }
}
