// @vitest-environment node
import { fork, type ForkOptions } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe cleanup')
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function killAt(root: string, point: string) {
  const options: ForkOptions & { windowsHide: boolean } =
    { execArgv: ['--import', 'tsx'], windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }
  const child = fork(path.resolve('tests/fixtures/g20ReleaseCrashWorker.ts'), [root, point], options)
  let output = '', reached = false
  child.stdout?.on('data', data => { output += data.toString() })
  child.stderr?.on('data', data => { output += data.toString() })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Kill point timed out: ${point}\n${output}`)) }, 15000)
    child.on('message', message => {
      if ((message as { type?: string }).type === 'kill-now') { reached = true; child.kill('SIGKILL') }
    })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', () => { clearTimeout(timer); reached ? resolve() : reject(new Error(`Worker exited before kill: ${point}\n${output}`)) })
  })
}

it.each(['before-durable', 'after-durable'])(
  'REL-T05 process crash %s preserves two dirty documents, attachment and operation identity', async point => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-rel-crash-'))
    roots.push(root)
    await killAt(root, point)
    const ids = JSON.parse(await fs.readFile(path.join(root, 'identities.json'), 'utf8')) as Record<'a' | 'b' | 'c', string>
    const host = new DocumentHostService(path.join(root, 'documents'))
    const recoverable = await host.internalAPI.recoverable()
    expect(new Set(recoverable.map(item => item.documentId))).toEqual(new Set([
      ids.a, ids.b, ...(point === 'after-durable' ? [ids.c] : []),
    ]))
    const a = await host.internalAPI.restore(ids.a)
    const b = await host.internalAPI.restore(ids.b)
    expect(a).toMatchObject({ revision: 1, dirty: true, recovered: true, model: { source: 'A DIRTY' } })
    expect(b).toMatchObject({ revision: 1, dirty: true, recovered: true,
      model: { source: 'B DIRTY\n![asset](assets/fixture.png)' } })
    if (b.model.kind !== 'markdown') throw new Error('Expected Markdown')
    expect(b.model.resources.assets['assets/fixture.png']).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
    expect(await fs.readFile(path.join(root, 'b.md'), 'utf8')).toBe('BASE')
    expect(await host.internalAPI.lookup(ids.a, 'a-committed')).toMatchObject({ status: 'applied', revision: 1 })
    expect(await host.internalAPI.lookup(ids.b, 'b-committed')).toMatchObject({ status: 'applied', revision: 1 })
    expect((await host.internalAPI.recoverable()).map(item => item.documentId)).toEqual(
      point === 'after-durable' ? [ids.c] : [],
    )
    if (point === 'after-durable') {
      const c = await host.internalAPI.restore(ids.c)
      expect(c).toMatchObject({ revision: 1, dirty: true, recovered: true, model: { source: 'C ACTIVE' } })
      expect(await host.internalAPI.lookup(ids.c, 'c-active')).toMatchObject({ status: 'applied', revision: 1 })
      // The worker was killed before it could produce any outer execution record or receipt.
      // A retry with the same identity returns the durable result without applying twice.
      const replay = await host.internalAPI.dispatch({ documentId: ids.c,
        epoch: recoverable.find(item => item.documentId === ids.c)!.epoch, baseRevision: 0,
        operationId: 'c-active', actor: 'agent', runId: 'active-run', mutation: { type: 'command',
          command: { type: 'markdown.replace', source: 'C ACTIVE', resources: { assets: {}, components: {} } } },
      })
      expect(replay, JSON.stringify(replay)).toMatchObject({ status: 'applied', revision: 1 })
      expect((await host.internalAPI.read(ids.c)).revision).toBe(1)
      expect(await host.internalAPI.recoverable()).toEqual([])
    } else {
      const opened = await host.open(path.join(root, 'c.md'))
      expect(opened).toMatchObject({ revision: 0, dirty: false, model: { source: 'BASE' } })
      expect(await fs.readFile(path.join(root, 'c.md'), 'utf8')).toBe('BASE')
    }
  }, 25000,
)
