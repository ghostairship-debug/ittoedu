// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
// Initialize the package's normal public entry before its internal target (it has CJS cycles).
require('app-builder-lib')
const { NsisTarget } = require('app-builder-lib/out/targets/nsis/NsisTarget')
const { Arch } = require('builder-util')

// Exercise the installed builder up to its supported effectiveOptionComputed hook.
// Only app archive creation is stubbed; no compiler, download, EXE or release report is produced.
async function generatedDefines(portable: Record<string, unknown>) {
  let generated: Record<string, unknown> | undefined
  const directory = path.join(os.tmpdir(), 'guoling-unpack-definition-test')
  const appInfo = { id: 'com.ittoedu.courseware-editor', name: 'guoling-workbench', productName: '果铃工作台',
    productFilename: '果铃工作台', sanitizedName: 'guoling-workbench', description: 'fixture', version: '0.0.1',
    buildVersion: '0.0.1', copyright: 'fixture', updaterCacheDirName: 'guoling-workbench-updater',
    getVersionInWeirdWindowsForm: () => '0.0.1.0' }
  const packager = { config: { portable }, appInfo, projectDir: directory, compression: 'normal',
    platformSpecificBuildOptions: {}, expandArtifactNamePattern: () => 'candidate.exe', getIconPath: async () => null,
    info: { metadata: { dependencies: {} }, buildResourcesDir: directory, emitArtifactBuildStarted: async () => {} },
    packagerOptions: { effectiveOptionComputed: async ([defines]: [Record<string, unknown>, unknown]) => {
      generated = defines; return true
    } } }
  const helper = { refCount: 0, packArch: async () => ({ unpackedSize: 0,
    fileInfo: { path: path.join(directory, 'app.7z'), sha512: Buffer.alloc(64).toString('base64') } }) }
  await new NsisTarget(packager, directory, 'portable', helper).buildInstaller(new Map([[Arch.x64, directory]]))
  if (!generated) throw new Error('Builder did not reach its effectiveOptionComputed hook')
  return generated
}

it('generates a per-launch Portable directory with the actual config despite the upstream false annotation', async () => {
  const config = parse(await readFile(path.resolve('electron-builder.yml'), 'utf8')) as { portable: Record<string, unknown> }
  const actual = await generatedDefines(config.portable)
  expect(actual).not.toHaveProperty('UNPACK_DIR_NAME')
  expect(actual.COMPRESSION_METHOD).toBe('7z')
  const shared = await generatedDefines({ ...config.portable, unpackDirName: false })
  expect(shared.UNPACK_DIR_NAME).toEqual(expect.any(String))
  expect(String(shared.UNPACK_DIR_NAME).length).toBeGreaterThan(0)
  const { unpackDirName: _omitted, ...defaultPortable } = config.portable
  expect((await generatedDefines(defaultPortable)).UNPACK_DIR_NAME).toEqual(expect.any(String))
})
