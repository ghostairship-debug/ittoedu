import path from 'node:path'
import { nativeProjectFilename } from '../shared/nativeProjectFile'

/** A dialog only confirms replacement of the filename it actually returned. */
export function nativeProjectSaveSelection(selected: string): { path: string; overwriteConfirmed: boolean } {
  const target = nativeProjectFilename(selected)
  const key = (filename: string) => process.platform === 'win32' ? path.resolve(filename).toLowerCase() : path.resolve(filename)
  return { path: target, overwriteConfirmed: key(target) === key(selected) }
}
