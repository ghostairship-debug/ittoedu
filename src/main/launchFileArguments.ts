import { fileCapabilities } from '../shared/workbench/sourceFileKind'
import path from 'node:path'
import { promises as fs } from 'node:fs'

/** File arguments request data/source opens, never URL navigation or process execution. */
export async function launchFileArguments(argv: readonly string[], cwd: string, packaged: boolean): Promise<string[]> {
  const files: string[] = []
  for (const argument of argv.slice(packaged ? 1 : 2)) {
    if (argument.startsWith('-') || (/^[a-z][a-z\d+.-]*:/i.test(argument) && !/^[a-z]:[\\/]/i.test(argument))
      || fileCapabilities(argument).openKind === 'blocked') continue
    const candidate = path.resolve(cwd, argument)
    const absolute = await fs.realpath(candidate).catch(() => candidate)
    if (fileCapabilities(absolute).openKind === 'blocked') continue
    const stat = await fs.stat(absolute).catch(() => null)
    // Existing extensionless files are valid source. Do not turn a bare option value (e.g. a port) into a missing file.
    if (!stat && !path.isAbsolute(argument) && !/[\\/]/.test(argument) && path.extname(argument) === '') continue
    if (!stat || stat.isFile()) if (!files.some(file => process.platform === 'win32' ? file.toLowerCase() === absolute.toLowerCase() : file === absolute)) files.push(absolute)
  }
  return files
}
