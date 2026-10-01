import path from 'node:path'
import { promises as fs } from 'node:fs'

/** File arguments are user open actions, never JavaScript, URLs, or process commands. */
export async function launchFileArguments(argv: readonly string[], cwd: string, packaged: boolean): Promise<string[]> {
  const files: string[] = []
  for (const argument of argv.slice(packaged ? 1 : 2)) {
    if (argument.startsWith('-') || !/\.(?:h5lesson|md|markdown|txt|html?|csv|json|pdf|docx|pptx|xlsx|png|jpe?g|webp|gif)$/i.test(argument)) continue
    const candidate = path.resolve(cwd, argument)
    const absolute = await fs.realpath(candidate).catch(() => candidate)
    const stat = await fs.stat(absolute).catch(() => null)
    if (!stat || stat.isFile()) if (!files.some(file => process.platform === 'win32' ? file.toLowerCase() === absolute.toLowerCase() : file === absolute)) files.push(absolute)
  }
  return files
}
