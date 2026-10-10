import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { DEFAULT_EXTERNAL_MCP_SETTINGS, externalMcpSettingsSchema, type ExternalMcpSettings } from '../../../shared/workbench/external'

const SETTINGS_FILE = 'settings.json'
const TOKENLESS_CHOICE = 'tokenlessEnabled'

async function writeAtomic(filename: string, bytes: string | Uint8Array): Promise<void> {
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 })
  const temporary = `${filename}.${randomUUID()}.tmp`
  try {
    const file = await fs.open(temporary, 'wx', 0o600)
    try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
    await fs.rename(temporary, filename)
  } finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
}

/** One owner for local endpoint preferences and the explicit tokenless-enable choice. */
export class ResidentMcpSettingsStore {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly options: { directory: string }) {}
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(() => undefined).then(work)
    this.queue = next
    return next
  }
  private async load(): Promise<ExternalMcpSettings> {
    try {
      const stored = JSON.parse(await fs.readFile(path.join(this.options.directory, SETTINGS_FILE), 'utf8')) as Record<string, unknown>
      const { [TOKENLESS_CHOICE]: tokenlessEnabled, ...preferences } = stored
      // An old enabled:true authorized bearer transport, not the new tokenless endpoint.
      const parsed = externalMcpSettingsSchema.safeParse({ ...DEFAULT_EXTERNAL_MCP_SETTINGS,
        ...preferences, enabled: tokenlessEnabled === true && preferences.enabled === true })
      // Settings hold no secret; an unreadable file falls back to the defaults and is rewritten on the next change.
      return parsed.success ? parsed.data : { ...DEFAULT_EXTERNAL_MCP_SETTINGS }
    } catch { return { ...DEFAULT_EXTERNAL_MCP_SETTINGS } }
  }
  read(): Promise<ExternalMcpSettings> { return this.serial(() => this.load()) }
  update(patch: Partial<ExternalMcpSettings>): Promise<ExternalMcpSettings> {
    return this.serial(async () => {
      const next = externalMcpSettingsSchema.parse({ ...await this.load(), ...patch })
      await writeAtomic(path.join(this.options.directory, SETTINGS_FILE), JSON.stringify({ ...next, [TOKENLESS_CHOICE]: next.enabled }))
      return next
    })
  }
}
