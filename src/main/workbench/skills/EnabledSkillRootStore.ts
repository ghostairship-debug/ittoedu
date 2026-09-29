import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { resolveAuthorizedSkillRoot, type SkillRoot } from './ScopedSkillService'

const entrySchema = z.object({ source: z.enum(['user', 'workspace']), configuredDirectory: z.string().min(1),
  configuredAuthority: z.string().min(1), realDirectory: z.string().min(1), realAuthority: z.string().min(1) }).strict()
const stateSchema = z.object({ schemaVersion: z.literal(1), revision: z.number().int().nonnegative(),
  entries: z.array(entrySchema).max(1000) }).strict()
type State = z.infer<typeof stateSchema>
const empty = (): State => ({ schemaVersion: 1, revision: 0, entries: [] })
const normalized = (value: string) => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
const key = (root: SkillRoot) => `${root.source}\0${normalized(root.authorizedRoot)}\0${normalized(root.directory)}`
const entryKey = (entry: State['entries'][number]) => `${entry.source}\0${normalized(entry.configuredAuthority)}\0${normalized(entry.configuredDirectory)}`

/** Persisted opt-in list only. Entries are not grants and never modify or execute Skill contents. */
export class EnabledSkillRootStore {
  private updates: Promise<unknown> = Promise.resolve()
  constructor(private readonly filename: string) {}

  async readState(): Promise<State> {
    let bytes: Buffer
    try { bytes = await fs.readFile(this.filename) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return empty(); throw error }
    if (bytes.byteLength > 1024 * 1024) throw new Error('Skill 启用配置超过读取上限')
    return stateSchema.parse(JSON.parse(bytes.toString('utf8')))
  }

  async enabledRoots(candidates: readonly SkillRoot[]): Promise<{ roots: SkillRoot[]; revision: number; warnings: string[] }> {
    await this.updates
    const state = await this.readState(), roots: SkillRoot[] = [], warnings: string[] = []
    for (const root of candidates) {
      const entry = state.entries.find(item => entryKey(item) === key(root))
      if (!entry) continue
      try {
        const actual = await resolveAuthorizedSkillRoot(root)
        if (normalized(actual.authority) !== normalized(entry.realAuthority)
          || normalized(actual.directory) !== normalized(entry.realDirectory)) throw new Error('目录身份已改变')
        roots.push(root)
      } catch { warnings.push(`${root.source}: 已启用 Skill 目录无法在当前授权根下确认，未加载`) }
    }
    return { roots, revision: state.revision, warnings }
  }

  setEnabled(root: SkillRoot, enabled: boolean): Promise<{ revision: number; enabled: boolean }> {
    const task = this.updates.then(async () => {
      const state = await this.readState(), index = state.entries.findIndex(item => entryKey(item) === key(root))
      if (enabled) {
        const actual = await resolveAuthorizedSkillRoot(root)
        const entry = { source: root.source, configuredDirectory: path.resolve(root.directory), configuredAuthority: path.resolve(root.authorizedRoot),
          realDirectory: actual.directory, realAuthority: actual.authority }
        if (index >= 0) state.entries[index] = entry
        else state.entries.push(entry)
      } else if (index >= 0) state.entries.splice(index, 1)
      else return { revision: state.revision, enabled: false }
      const next = stateSchema.parse({ ...state, revision: state.revision + 1 })
      await fs.mkdir(path.dirname(this.filename), { recursive: true })
      const temporary = `${this.filename}.${randomUUID()}.tmp`
      try { await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600 }); await fs.rename(temporary, this.filename) }
      finally { await fs.rm(temporary, { force: true }).catch(() => undefined) }
      return { revision: next.revision, enabled }
    })
    this.updates = task.then(() => undefined, () => undefined)
    return task
  }
}
