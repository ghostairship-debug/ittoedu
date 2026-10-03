import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { DEFAULT_EXTERNAL_MCP_SETTINGS, externalMcpSettingsSchema, type ExternalMcpSettings } from '../../../shared/workbench/external'
import type { CredentialEncryptionPort } from '../providers/providerCredentials'

const SETTINGS_FILE = 'settings.json'
const TOKEN_FILE = 'token.bin'

async function writeAtomic(filename: string, bytes: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
  const temporary = `${filename}.${randomUUID()}.tmp`
  try {
    const file = await fs.open(temporary, 'wx', 0o600)
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    await fs.rename(temporary, filename)
  } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
}

/** Resident connection settings plus the long-lived local bearer, kept only in the OS credential store's ciphertext. */
export class ResidentMcpSettingsStore {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly options: { directory: string; encryption: CredentialEncryptionPort }) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(work)
    this.queue = next
    return next
  }
  private async load(): Promise<ExternalMcpSettings> {
    try {
      const parsed = externalMcpSettingsSchema.safeParse({ ...DEFAULT_EXTERNAL_MCP_SETTINGS,
        ...JSON.parse(await fs.readFile(path.join(this.options.directory, SETTINGS_FILE), 'utf8')) })
      // Settings hold no secret; an unreadable file falls back to the defaults and is rewritten on the next change.
      return parsed.success ? parsed.data : { ...DEFAULT_EXTERNAL_MCP_SETTINGS }
    } catch { return { ...DEFAULT_EXTERNAL_MCP_SETTINGS } }
  }
  read(): Promise<ExternalMcpSettings> { return this.serial(() => this.load()) }
  update(patch: Partial<ExternalMcpSettings>): Promise<ExternalMcpSettings> {
    return this.serial(async () => {
      const next = externalMcpSettingsSchema.parse({ ...await this.load(), ...patch })
      await writeAtomic(path.join(this.options.directory, SETTINGS_FILE), JSON.stringify(next))
      return next
    })
  }
  private async create(): Promise<string> {
    const token = randomBytes(32).toString('base64url')
    await writeAtomic(path.join(this.options.directory, TOKEN_FILE), await this.options.encryption.encryptString(token))
    return token
  }
  /** Created on first use and valid until regenerated. */
  token(): Promise<string> {
    return this.serial(async () => {
      let ciphertext: Uint8Array
      try { ciphertext = await fs.readFile(path.join(this.options.directory, TOKEN_FILE)) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.create(); throw error }
      if (!(await this.options.encryption.isEncryptionAvailable())) throw new Error('系统安全凭据存储不可用，无法读取外部连接令牌')
      let token: string
      // A token the OS store can no longer decrypt cannot authenticate anyone; replace it instead of blocking the service.
      try { token = await this.options.encryption.decryptString(ciphertext) } catch { return this.create() }
      return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : this.create()
    })
  }
  regenerateToken(): Promise<string> { return this.serial(() => this.create()) }
}
