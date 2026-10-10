// @vitest-environment node
import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import sharp from 'sharp'
import { afterAll, beforeAll, expect, it } from 'vitest'

const run = promisify(execFile), root = process.cwd()
let directory: string, bundle: string, png: string
beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'guoling-native-startup-'))
  bundle = path.join(directory, 'startup.cjs')
  await build({ stdin: { resolveDir: root, contents: `
    export * from './src/main/workbench/admittedImageResource';
    export * from './src/main/workbench/providers/ModelCapabilityProbe';
    export * from './src/main/workbench/mediaFiles/imageFileEditing';
    export * from './src/main/workbench/assetSources/OpenImageService';
    export * from './src/main/workbench/attachments/AttachmentService';
    export * from './src/main/workbench/attachments/attachmentOperationErrors';
    export * from './src/main/workbench/imageDecoder';
    export * from './src/main/errors';
    export {diagnosticLog} from './src/main/diagnosticLog';
  ` }, bundle: true, platform: 'node', format: 'cjs', external: ['electron', 'sharp'], outfile: bundle, logLevel: 'silent' })
  png = (await sharp({ create: { width: 9, height: 7, channels: 4, background: '#123456' } }).png().toBuffer()).toString('base64')
})
afterAll(async () => { if (directory) await fs.rm(directory, { recursive: true, force: true }) })

it.each(['MODULE_NOT_FOUND', 'ERR_DLOPEN_FAILED'])('starts the actual image entry modules without %s and recovers on a later explicit image operation', async code => {
  const work = path.join(directory, code); await fs.mkdir(work)
  const { stdout, stderr } = await run(process.execPath, [path.join(root, 'tests/helpers/imageDecoderFailure.cjs'), bundle, root, work, code, png], { timeout: 25_000 }).catch(error => {
    throw new Error(`Native startup fixture failed: ${error.stderr || error.message}`, { cause: error })
  })
  expect(JSON.parse(stdout)).toMatchObject({ startupLoaded: true, nonImageAvailable: true, providerCalls: 1, recoveredImages: 3, recoveredExtraction: true })
  expect(stderr).toContain(code)
  expect(stderr).toContain('图片处理模块加载失败')
}, 30_000)
