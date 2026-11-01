// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { launchFileArguments } from '../../src/main/launchFileArguments'

const fixtures: string[] = []
afterEach(async () => { for (const directory of fixtures.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })

it('launches source and extensionless files using the shared file capabilities', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-file-launch-'))
  fixtures.push(directory)
  const names = ['settings.jsonc', 'main.ts', 'config.yaml', '.env', 'README', 'notes.custom', 'script.cmd', 'paper.pdf']
  for (const name of names) await fs.writeFile(path.join(directory, name), 'fixture')
  await fs.mkdir(path.join(directory, 'folder'))
  await fs.writeFile(path.join(directory, 'program.exe'), 'MZ')
  await fs.writeFile(path.join(directory, 'shortcut.lnk'), 'fixture')
  const result = await launchFileArguments(['electron', '.', ...names, 'folder', 'program.exe', 'shortcut.lnk', '--inspect=9222', '--remote-debugging-port', '9222', 'https://example.test/config.json', 'javascript:alert(1)', names[0]!], directory, false)
  expect(result).toEqual(await Promise.all(names.map(name => fs.realpath(path.join(directory, name)))))
})

it('keeps a missing selected text path so the app can report the missing file', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-file-missing-'))
  fixtures.push(directory)
  expect(await launchFileArguments(['app.exe', 'missing.jsonc'], directory, true)).toEqual([path.join(directory, 'missing.jsonc')])
})
