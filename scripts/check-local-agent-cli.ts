import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { LocalAgentHarness } from '../src/main/localAgent/harness'
import { LocalAgentRepository } from '../src/main/localAgent/repository'
import { createWorkspaceIdentity } from '../src/main/workspaceIdentity'
import { localAgentIdSchema, type LocalAgentRecord } from '../src/shared/localAgentContract'

/** Opt-in real CLI acceptance. Never required by offline unit tests; uses CLI-owned authentication. */
async function main() {
  const adapters = process.argv[2] ? [localAgentIdSchema.parse(process.argv[2])] : localAgentIdSchema.options
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'courseware-cli-live-'))
  const harness = new LocalAgentHarness(new LocalAgentRepository(directory))
  const owner = createWorkspaceIdentity('live-cli-fixture', path.join(directory, 'fixture.h5lesson'))
  const wait = async (id: string): Promise<LocalAgentRecord> => {
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      const record = (await harness.list(owner)).records.find(record => record.id === id)
      if (record && record.status !== 'running') return record
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    await harness.cancel(owner, id)
    throw new Error('CLI response timed out after 180 seconds')
  }
  const assertCompleted = (record: LocalAgentRecord, expected: string) => {
    if (record.status !== 'completed') throw new Error(`CLI failed: ${record.events.at(-1)?.failure ?? record.status}`)
    const text = record.events.filter(event => event.kind === 'text').map(event => (event.payload as { text: string }).text).join('\n')
    if (!text.includes(expected)) throw new Error('CLI did not retain the expected conversation content')
  }
  try {
    for (const adapter of adapters) {
      try {
        const probe = await harness.probe(adapter)
        console.log(JSON.stringify(probe))
        const token = randomUUID()
        const first = await wait(await harness.start(owner, adapter, `Remember this token: ${token}. Respond exactly READY. Do not use tools, read or write files, or run commands.`))
        assertCompleted(first, 'READY')
        console.log(`${adapter}: start and text passed`)
        const resumed = await wait(await harness.resume(owner, first.id, 'Repeat only the token I asked you to remember. Do not use tools.'))
        assertCompleted(resumed, token)
        if (resumed.externalSessionId !== first.externalSessionId) throw new Error('Resume changed external session identity')
        const cancelled = await harness.start(owner, adapter, 'Respond only OK. Do not use tools.')
        await harness.cancel(owner, cancelled)
        if ((await harness.list(owner)).records.find(record => record.id === cancelled)?.status !== 'cancelled') throw new Error('Cancel did not reach cancelled')
        console.log(`${adapter}: probe / start / text / resume identity and memory / cancel passed`)
      } catch (error) { process.exitCode = 1; console.error(`${adapter}: ${error instanceof Error ? error.message : 'failed'}`) }
    }
  } finally {
    await harness.close()
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('courseware-cli-live-')) throw new Error('Invalid fixture directory')
    await fs.rm(directory, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Live CLI check failed'); process.exitCode = 1 })
