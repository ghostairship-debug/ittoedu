import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { LocalAgentCapabilities, LocalAgentId } from '../../shared/localAgentContract'

type SessionConfiguration = Pick<LocalAgentCapabilities, 'current' | 'requestedConfiguration'>
interface CapabilityEntry { expiresAt: number; value: LocalAgentCapabilities; sessionConfiguration?: SessionConfiguration }

function withSessionConfiguration(directory: LocalAgentCapabilities, session?: SessionConfiguration): LocalAgentCapabilities {
  if (!session) return directory
  const current = session.current
  const model = directory.models.find(model => model.id === current.model)
  // The strict wire requires current to be expressible by this directory. Keep
  // an unavailable confirmation internally without inventing a catalog entry.
  const representable = (current.model === null || !!model)
    && (!current.resolvedModel || !model?.resolvedModel || current.resolvedModel === model.resolvedModel)
    && (current.effort === null || (model?.effort.kind === 'supported' && model.effort.values.includes(current.effort)))
  return { ...directory, current: representable ? current : { model: null, resolvedModel: null, effort: null },
    requestedConfiguration: session.requestedConfiguration }
}

/** Metadata only: changes invalidate discovery without reading credentials into a cache key. */
export async function nativeConfigurationIdentity(id: LocalAgentId, cwd: string): Promise<string> {
  const user = os.homedir()
  const paths = id === 'codex'
    ? [path.join(process.env.CODEX_HOME ?? path.join(user, '.codex'), 'config.toml'), path.join(cwd, '.codex', 'config.toml')]
    : id === 'claude'
      ? [path.join(user, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')]
      : [path.join(process.env.XDG_CONFIG_HOME ?? path.join(user, '.config'), 'opencode', 'opencode.json'),
        path.join(process.env.XDG_CONFIG_HOME ?? path.join(user, '.config'), 'opencode', 'opencode.jsonc'),
        path.join(cwd, 'opencode.json'), path.join(cwd, 'opencode.jsonc')]
  return JSON.stringify(await Promise.all(paths.map(async file => {
    const stat = await fs.stat(file).catch(() => null)
    return [file, stat?.mtimeMs ?? null, stat?.size ?? null]
  })))
}

/** Five-minute discovery cache; simultaneous refreshes share the same zero-turn native query. */
export class NativeCapabilityCache {
  private readonly versions = new Map<LocalAgentId, string>()
  private readonly epochs = new Map<LocalAgentId, number>()
  private readonly entries = new Map<string, CapabilityEntry>()
  private readonly pending = new Map<string, { epoch: number; promise: Promise<LocalAgentCapabilities> }>()
  constructor(private readonly ttlMs = 5 * 60 * 1000) {}
  async read(id: LocalAgentId, cwd: string, refresh: boolean, discover: () => Promise<LocalAgentCapabilities>): Promise<LocalAgentCapabilities> {
    const identity = JSON.stringify([id, path.resolve(cwd), await nativeConfigurationIdentity(id, cwd)])
    const key = JSON.stringify([identity, this.versions.get(id) ?? null])
    const epoch = this.epochs.get(id) ?? 0
    const running = this.pending.get(identity)
    if (running?.epoch === epoch) return running.promise
    const cached = this.entries.get(key)
    if (!refresh && cached && cached.expiresAt > Date.now()) return cached.value
    const pending = discover().then(value => {
      if (epoch !== (this.epochs.get(id) ?? 0)) throw new Error('原生CLI目录已变化，请刷新后重试')
      const previousVersion = this.versions.get(id)
      if (previousVersion && previousVersion !== value.cliVersion) this.invalidate(id, value.cliVersion)
      else this.versions.set(id, value.cliVersion)
      const discoveredKey = JSON.stringify([identity, value.cliVersion])
      const sessionConfiguration = this.entries.get(discoveredKey)?.sessionConfiguration
      value = withSessionConfiguration(value, sessionConfiguration)
      this.entries.set(discoveredKey, { value, sessionConfiguration, expiresAt: Date.now() + this.ttlMs })
      while (this.entries.size > 30) this.entries.delete(this.entries.keys().next().value!)
      return value
    }).finally(() => { if (this.pending.get(identity)?.promise === pending) this.pending.delete(identity) })
    this.pending.set(identity, { epoch, promise: pending })
    return pending
  }
  async merge(id: LocalAgentId, cwd: string, fallback: LocalAgentCapabilities,
    update: (current: LocalAgentCapabilities) => LocalAgentCapabilities,
    origin: 'directory' | 'native-session' = 'directory'): Promise<LocalAgentCapabilities> {
    // A native confirmation must not wait behind an unrelated catalog query.
    const current = origin === 'native-session' ? fallback : await this.read(id, cwd, false, async () => fallback)
    const identity = JSON.stringify([id, path.resolve(cwd), await nativeConfigurationIdentity(id, cwd)])
    const version = this.versions.get(id) ?? fallback.cliVersion
    if (version !== fallback.cliVersion || current.cliVersion !== fallback.cliVersion) throw new Error('原生CLI版本已变化，请刷新模型目录后重试配置')
    this.versions.set(id, version)
    const key = JSON.stringify([identity, version])
    const latest = this.entries.get(key)
    const updated = update(latest?.value ?? current)
    const sessionConfiguration = origin === 'native-session'
      ? { current: { ...updated.current }, requestedConfiguration: updated.requestedConfiguration ? { ...updated.requestedConfiguration } : updated.requestedConfiguration }
      : latest?.sessionConfiguration
    const value = withSessionConfiguration(updated, sessionConfiguration)
    this.entries.set(key, { value, sessionConfiguration, expiresAt: Date.now() + this.ttlMs })
    return value
  }
  invalidate(id: LocalAgentId, version?: string): void {
    if (version && this.versions.get(id) === version) return
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1)
    if (version) this.versions.set(id, version)
    for (const key of this.entries.keys()) if (JSON.parse(JSON.parse(key)[0])[0] === id) this.entries.delete(key)
  }
}
