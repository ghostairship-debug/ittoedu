import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'

const localRequire = createRequire(__filename)
export const runtimeEsbuildVersion: string = localRequire('esbuild/package.json').version
let loaded: Promise<typeof import('esbuild')> | undefined

/** Native spawn receives an OS path, never an Electron ASAR virtual path. */
export async function loadRuntimeEsbuild(): Promise<typeof import('esbuild')> {
  if (!loaded) loaded = (async () => {
    const packageName = `@esbuild/${process.platform}-${process.arch}`
    const relative = process.platform === 'win32' ? 'esbuild.exe' : 'bin/esbuild'
    const resolved = localRequire.resolve(`${packageName}/${relative}`)
    const unpacked = resolved.replace(/([\\/])app\.asar([\\/])/i, '$1app.asar.unpacked$2')
    process.env.ESBUILD_BINARY_PATH = await fs.realpath(unpacked)
    return import('esbuild')
  })().catch(error => { loaded = undefined; throw error })
  return loaded
}
