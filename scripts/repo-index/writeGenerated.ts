import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, resolve, sep } from 'node:path'

export type GeneratedFileMap = ReadonlyMap<string, Buffer>

export interface AtomicReplaceHooks {
  beforeInstall?: () => void
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue)
  }
  if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, child]) => [key, sortJsonValue(child)]),
    )
  }
  return value
}

export function serializeJson(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(sortJsonValue(value), null, 2)}\n`, 'utf8')
}

export function serializeJsonLines(values: readonly unknown[]): Buffer {
  const text = values
    .map((value) => JSON.stringify(sortJsonValue(value)))
    .join('\n')
  return Buffer.from(text.length > 0 ? `${text}\n` : '', 'utf8')
}

function assertFlatGeneratedName(name: string): void {
  if (
    name.length === 0 ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\')
  ) {
    throw new Error(`Generated file names must be flat and relative: ${name}`)
  }
}

export function writeGeneratedFiles(
  outputDirectory: string,
  files: GeneratedFileMap,
): void {
  mkdirSync(outputDirectory, { recursive: true })
  for (const name of [...files.keys()].sort(compareText)) {
    assertFlatGeneratedName(name)
    writeFileSync(resolve(outputDirectory, name), files.get(name)!)
  }
}

function assertSwapPath(parent: string, candidate: string, prefix: string): void {
  const resolvedParent = resolve(parent)
  const resolvedCandidate = resolve(candidate)
  if (
    dirname(resolvedCandidate) !== resolvedParent ||
    !basename(resolvedCandidate).startsWith(prefix) ||
    !resolvedCandidate.startsWith(`${resolvedParent}${sep}`)
  ) {
    throw new Error(`Unsafe generated directory swap path: ${candidate}`)
  }
}

export function replaceGeneratedDirectoryAtomically(
  targetDirectory: string,
  files: GeneratedFileMap,
  hooks: AtomicReplaceHooks = {},
): void {
  const target = resolve(targetDirectory)
  const parent = dirname(target)
  const targetName = basename(target)
  mkdirSync(parent, { recursive: true })
  const scratchParent = resolve(parent, 'contexts')
  mkdirSync(scratchParent, { recursive: true })

  const temporary = mkdtempSync(resolve(scratchParent, `${targetName}-tmp-`))
  const backup = resolve(scratchParent, `${targetName}-backup-${process.pid}`)
  assertSwapPath(scratchParent, temporary, `${targetName}-tmp-`)
  assertSwapPath(scratchParent, backup, `${targetName}-backup-`)
  if (existsSync(backup)) {
    throw new Error(`Generated directory backup already exists: ${backup}`)
  }

  writeGeneratedFiles(temporary, files)
  let movedExisting = false
  try {
    if (existsSync(target)) {
      renameSync(target, backup)
      movedExisting = true
    }
    hooks.beforeInstall?.()
    renameSync(temporary, target)
    if (movedExisting) {
      rmSync(backup, { recursive: true, force: true })
    }
  } catch (error) {
    if (existsSync(temporary)) {
      rmSync(temporary, { recursive: true, force: true })
    }
    if (movedExisting && !existsSync(target) && existsSync(backup)) {
      renameSync(backup, target)
    }
    throw error
  }
}

export function readGeneratedDirectory(directory: string): Map<string, Buffer> {
  if (!existsSync(directory)) {
    return new Map()
  }
  const result = new Map<string, Buffer>()
  const entries = readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => compareText(left.name, right.name))
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (!entry.isFile()) {
      throw new Error(`Generated directory must contain flat files only: ${path}`)
    }
    result.set(entry.name, readFileSync(path))
  }
  return result
}

export interface GeneratedDifference {
  missing: string[]
  extra: string[]
  changed: string[]
}

export function compareGeneratedFiles(
  expected: GeneratedFileMap,
  actual: GeneratedFileMap,
): GeneratedDifference {
  const expectedNames = [...expected.keys()].sort(compareText)
  const actualNames = [...actual.keys()].sort(compareText)
  return {
    missing: expectedNames.filter((name) => !actual.has(name)),
    extra: actualNames.filter((name) => !expected.has(name)),
    changed: expectedNames.filter((name) => {
      const actualBytes = actual.get(name)
      return actualBytes !== undefined && !expected.get(name)!.equals(actualBytes)
    }),
  }
}

export function hasGeneratedDifference(difference: GeneratedDifference): boolean {
  return (
    difference.missing.length > 0 ||
    difference.extra.length > 0 ||
    difference.changed.length > 0
  )
}
