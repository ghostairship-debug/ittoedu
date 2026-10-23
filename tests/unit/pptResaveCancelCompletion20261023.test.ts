// @vitest-environment node
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { resaveLegacyPpt } from '../../src/main/pptResave'

it('honors cancellation after worker cleanup without starting another cleanup job', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ppt-late-cancel-'))
  const source = path.join(directory, 'original.ppt'), temporary = path.join(directory, 'jobs')
  const bytes = Buffer.alloc(512)
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(bytes)
  await fs.writeFile(source, bytes)
  const controller = new AbortController(), readFile = fs.readFile.bind(fs)
  const spy = vi.spyOn(fs, 'readFile').mockImplementation((async (...args: Parameters<typeof fs.readFile>) => {
    if (String(args[0]).endsWith('output.pptx')) controller.abort()
    return readFile(...args)
  }) as typeof fs.readFile)
  let worker!: ChildProcessWithoutNullStreams
  try {
    await expect(resaveLegacyPpt(source, temporary, { signal: controller.signal, run: (_script, _input, output) => {
      worker = spawn(process.execPath, ['-e', `require('node:fs').writeFileSync(process.argv[1],Buffer.from([80,75])); console.log('PPT_RESAVE_OK')`, output],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
      return worker
    } })).rejects.toThrow('取消')
    expect(worker.exitCode).toBe(0)
    expect(await fs.readdir(temporary)).toEqual([])
    expect(await readFile(source)).toEqual(bytes)
  } finally { spy.mockRestore(); await fs.rm(directory, { recursive: true, force: true }) }
})
