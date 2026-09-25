// @vitest-environment node
import { fork, type ForkOptions } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { createDocumentJournal } from '../../src/main/workbench/documentJournal'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { createMarkdownDriver } from '../../src/core/drivers/MarkdownDriver'

const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (!path.resolve(directory).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe test cleanup')
    await fs.rm(directory, { recursive: true, force: true })
  }
})

async function crashAt(directory: string, point: string): Promise<void> {
  const options: ForkOptions & { windowsHide: boolean } = {
    execArgv: ['--import', 'tsx'], windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  }
  const child = fork(path.resolve('tests/fixtures/g20DocumentCrashWorker.ts'), [directory, point], options)
  let details = '', reached = false
  child.stderr?.on('data', bytes => { details += bytes.toString() })
  child.stdout?.on('data', bytes => { details += bytes.toString() })
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Fault point timed out: ${point}\n${details}`)) }, 10000)
    child.on('message', message => {
      if ((message as { type?: string }).type === 'kill-now') { reached = true; child.kill('SIGKILL') }
    })
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', () => { clearTimeout(timer); reached ? resolve() : reject(new Error(`Child exited before fault: ${point}\n${details}`)) })
  })
}

it.each(['resources-before-log', 'journal-mid-write', 'durable-before-state', 'save-before-replace', 'save-after-replace'])(
  'S03-T02 actual process kill at %s recovers complete content/resources/receipt', async point => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-crash-'))
    directories.push(directory)
    await crashAt(directory, point)
    const journal = createDocumentJournal({ directory: path.join(directory, 'journal') })
    const state = await journal.recover('crash-document')
    expect(state).not.toBeNull()
    const committed = point !== 'resources-before-log' && point !== 'journal-mid-write'
    expect(state!.revision).toBe(committed ? 1 : 0)
    expect(state!.model).toMatchObject({ source: committed ? '# After\n![New](assets/new.png)\n' : '# Before\n' })
    expect(Object.keys(state!.model.resources.assets)).toEqual(committed ? ['assets/new.png'] : [])
    expect(state!.past).toHaveLength(committed ? 1 : 0)
    const restored = await DocumentSession.restore(state!, 'restart-epoch', createMarkdownDriver(), journal)
    expect(restored.lookupOperation('content-and-resource')?.status ?? null).toBe(committed ? 'applied' : null)
    if (committed) {
      const original = restored.lookupOperation('content-and-resource')!
      expect(original).toMatchObject({ revision: 1 })
      expect(restored.read().revision).toBe(1)
    }
    const fileSource = await fs.readFile(path.join(directory, 'lesson.md'), 'utf8')
    expect(fileSource).toBe(point === 'save-after-replace' ? '# After\n![New](assets/new.png)\n' : '# Before\n')
    if (point === 'save-after-replace') expect(new Uint8Array(await fs.readFile(path.join(directory, 'assets/new.png')))).toEqual(state!.model.resources.assets['assets/new.png'])
    // Reading again after torn-tail repair never repeats the operation.
    expect((await journal.recover('crash-document'))!.revision).toBe(restored.read().revision)
  }, 15000,
)
