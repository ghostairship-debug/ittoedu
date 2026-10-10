// @vitest-environment node
import { createPackageWithOptions } from '@electron/asar'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { AttachmentService } from '../../src/main/workbench/attachments/AttachmentService'
import { assertSharpPngSnapshot, collectSharpPayload, createPortableSharpReportDirectory,
  parsePortableSharpArguments, sharpSmokePng, verifyPortableSharp } from '../../scripts/portableSharpVerification'

const temporary: string[] = []
async function directory() { const root = await mkdtemp(path.join(tmpdir(), 'portable-sharp-unit-')); temporary.push(root); return root }
afterEach(async () => { await Promise.all(temporary.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

it('requires explicit artifact and evidence paths and rejects ambiguous CLI flags', () => {
  const cwd = path.resolve('artifact-tests')
  expect(parsePortableSharpArguments(['--portable-sharp', '--portable', 'portable.exe', '--unpacked', 'dir/app.exe', '--output', 'new evidence'], cwd))
    .toEqual({ portable: path.join(cwd, 'portable.exe'), unpacked: path.join(cwd, 'dir/app.exe'), output: path.join(cwd, 'new evidence') })
  for (const args of [
    ['--portable-sharp'],
    ['--portable-sharp', '--portable', '--unpacked'],
    ['--portable-sharp', '--portable', 'a.exe', '--unpacked', 'a.exe', '--output', 'new'],
    ['--portable-sharp', '--portable', 'a.exe', '--unpacked', 'b.exe', '--output', 'new', '--output', 'old'],
    ['--portable-sharp', '--portable', 'a.exe', '--unpacked', 'b.exe', '--output', 'new', '--m13-package'],
  ]) expect(() => parsePortableSharpArguments(args, cwd)).toThrow()
})

it('never reuses an evidence directory or overwrites an existing report', async () => {
  const root = await directory(), output = path.join(root, 'new')
  await createPortableSharpReportDirectory(output)
  await writeFile(path.join(output, 'report.json'), 'historical evidence')
  await expect(createPortableSharpReportDirectory(output)).rejects.toMatchObject({ code: 'EEXIST' })
  expect(await readFile(path.join(output, 'report.json'), 'utf8')).toBe('historical evidence')
})

it('uses the real attachment PNG decode and rejects wrong bytes, dimensions or unverified representations', async () => {
  const root = await directory(), service = new AttachmentService({ directory: root })
  const snapshot = await service.receiveBytes({ name: 'smoke.png', bytes: Buffer.from(sharpSmokePng.base64, 'base64'),
    declaredMediaType: 'image/png', source: { kind: 'paste' } })
  expect(assertSharpPngSnapshot(snapshot)).toMatchObject({ width: 3, height: 2, digest: sharpSmokePng.digest, producer: 'sharp-verified-v1' })
  const image = snapshot.representations[0]
  expect(() => assertSharpPngSnapshot({ ...snapshot, digest: '0'.repeat(64) })).toThrow(/摘要/)
  expect(() => assertSharpPngSnapshot({ ...snapshot, representations: [{ ...image, width: 4 }] })).toThrow(/尺寸/)
  expect(() => assertSharpPngSnapshot({ ...snapshot, representations: [{ ...image, provenance: { ...image.provenance, producer: 'original-v1' } }] })).toThrow(/完整 sharp/)
})

it('checks an actual ASAR JS export chain and physical unpacked native files', async () => {
  const root = await directory(), app = path.join(root, 'app'), resources = path.join(root, 'resources')
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'probe', version: '0.0.1' }),
    'node_modules/sharp/package.json': JSON.stringify({ name: 'sharp', version: '0.35.3', main: './dist/index.cjs' }),
    'node_modules/sharp/dist/index.cjs': 'module.exports = require("./sharp.cjs")',
    'node_modules/sharp/dist/sharp.cjs': 'module.exports = require("@img/sharp-win32-x64/sharp.node")',
    'node_modules/@img/sharp-win32-x64/package.json': JSON.stringify({ version: '0.35.3', exports: { './sharp.node': './index.cjs' } }),
    'node_modules/@img/sharp-win32-x64/index.cjs': 'module.exports = require("./lib/sharp.node")',
    'node_modules/@img/sharp-win32-x64/lib/sharp.node': 'native fixture',
    'node_modules/@img/sharp-win32-x64/lib/a.dll': 'first DLL fixture',
    'node_modules/@img/sharp-win32-x64/lib/b.dll': 'second DLL fixture',
  }
  for (const [relative, bytes] of Object.entries(files)) {
    const filename = path.join(app, relative); await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, bytes)
  }
  await mkdir(resources)
  await createPackageWithOptions(app, path.join(resources, 'app.asar'), { unpack: '**/lib/*' })
  expect(await collectSharpPayload(resources)).toMatchObject({ sharpVersion: '0.35.3', package: { name: 'probe' }, nativeFiles: expect.arrayContaining([expect.objectContaining({ path: 'sharp.node' })]) })
  await rm(path.join(resources, 'app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib/a.dll'))
  await expect(collectSharpPayload(resources)).rejects.toThrow(/实体/)
})

it('reports a non-Windows evidence boundary only in the explicitly fresh report directory', async () => {
  if (process.platform === 'win32') return
  const root = await directory(), output = path.join(root, 'evidence')
  await expect(verifyPortableSharp(['--portable-sharp', '--portable', path.join(root, 'a.exe'), '--unpacked', path.join(root, 'b.exe'), '--output', output])).rejects.toThrow(/Windows x64/)
  const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'))
  expect(report).toMatchObject({ status: 'failed', expectedRounds: 10, rounds: [] })
  expect(report.failure).toContain('当前未执行启动或解码')
})
