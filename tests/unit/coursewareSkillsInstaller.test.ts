// @vitest-environment node

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const root = path.resolve(__dirname, '..', '..')
const installerPath = path.join(root, 'scripts', 'install-courseware-skills.ps1')
const manifestName = '.ittoedu-courseware-editor-managed-skills.json'
const retiredV8BuilderSkill = ['build-project-v8', '-courseware'].join('')

type InstallerManifest = {
  schemaVersion: number
  source: string
  skills: Record<string, { installedTreeSignature: string }>
  retiredSkills: Record<string, {
    status: string
    observedTreeSignature?: string
    lastManagedTreeSignature?: string
  }>
  lastTransactionId: string
}

type InstallerFailure = Error & { stdout?: string; stderr?: string; code?: number }

const windowsDescribe = process.platform === 'win32' ? describe : describe.skip

let temporaryRoot = ''
let sourceRoot = ''
let destinationRoot = ''

async function exists(filename: string): Promise<boolean> {
  try {
    await access(filename)
    return true
  } catch {
    return false
  }
}

async function createSkill(
  parent: string,
  name: string,
  body = `# ${name}\n`,
): Promise<string> {
  const directory = path.join(parent, name)
  await mkdir(path.join(directory, 'agents'), { recursive: true })
  await writeFile(
    path.join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Test ${name}.\n---\n\n${body}`,
    'utf8',
  )
  await writeFile(
    path.join(directory, 'agents', 'openai.yaml'),
    `interface:\n  display_name: "${name}"\n`,
    'utf8',
  )
  return directory
}

async function createCurrentSources(): Promise<void> {
  await createSkill(sourceRoot, 'orchestrate-courseware', '# Orchestrate current\n')
  await createSkill(sourceRoot, 'build-courseware-project', '# Build current\n')
}

async function listFiles(directory: string, prefix = ''): Promise<string[]> {
  const names = await readdir(directory, { withFileTypes: true })
  const files: string[] = []
  for (const entry of names) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), relative))
    } else if (entry.isFile()) {
      files.push(relative)
    } else {
      throw new Error(`Unexpected fixture entry: ${relative}`)
    }
  }
  return files.sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
}

async function treeSignature(directory: string): Promise<string> {
  const entries: string[] = []
  for (const relative of await listFiles(directory)) {
    if (
      relative.split('/').includes('__pycache__')
      || /\.py[co]$/i.test(relative)
    ) continue
    const bytes = await readFile(path.join(directory, ...relative.split('/')))
    const fileHash = createHash('sha256').update(bytes).digest('hex')
    entries.push(`${relative}\t${bytes.byteLength}\t${fileHash}`)
  }
  return createHash('sha256').update(entries.join('\n'), 'utf8').digest('hex')
}

async function writeJson(filename: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filename), { recursive: true })
  await writeFile(filename, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function readManifest(): Promise<InstallerManifest> {
  return JSON.parse(
    await readFile(path.join(destinationRoot, manifestName), 'utf8'),
  ) as InstallerManifest
}

async function runInstaller(options: {
  env?: Record<string, string>
  expectFailure?: boolean
} = {}): Promise<{ stdout: string; stderr: string; failure?: InstallerFailure }> {
  try {
    const result = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        installerPath,
        '-SourceRoot',
        sourceRoot,
        '-DestinationRoot',
        destinationRoot,
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, ...options.env },
        maxBuffer: 4 * 1024 * 1024,
      },
    )
    if (options.expectFailure) {
      throw new Error('Expected installer failure, but it succeeded.')
    }
    return { stdout: result.stdout, stderr: result.stderr }
  } catch (error) {
    const failure = error as InstallerFailure
    if (!options.expectFailure) throw error
    return {
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
      failure,
    }
  }
}

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'ittoedu-skill-installer-'))
  sourceRoot = path.join(temporaryRoot, 'repository-skills')
  destinationRoot = path.join(temporaryRoot, 'user-scope', 'skills')
  await mkdir(sourceRoot, { recursive: true })
  await createCurrentSources()
})

afterEach(async () => {
  if (temporaryRoot) {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

windowsDescribe('courseware Skill installer', { timeout: 20_000 }, () => {
  it('installs the current Skills with manifest v2 signatures and is idempotent', async () => {
    const first = await runInstaller()
    expect(first.stdout).toContain('Installed/updated: orchestrate-courseware, build-courseware-project')

    const manifestPath = path.join(destinationRoot, manifestName)
    const firstManifestText = await readFile(manifestPath, 'utf8')
    const firstManifestStat = await stat(manifestPath)
    const manifest = JSON.parse(firstManifestText) as InstallerManifest
    expect(manifest.schemaVersion).toBe(2)
    expect(manifest.source).toBe('ittoedu-courseware-editor')
    expect(Object.keys(manifest.skills)).toEqual([
      'orchestrate-courseware',
      'build-courseware-project',
    ])
    expect(manifest.skills['orchestrate-courseware']?.installedTreeSignature)
      .toBe(await treeSignature(path.join(sourceRoot, 'orchestrate-courseware')))
    expect(manifest.skills['build-courseware-project']?.installedTreeSignature)
      .toBe(await treeSignature(path.join(sourceRoot, 'build-courseware-project')))
    expect(manifest.retiredSkills['build-project-v7-courseware']?.status).toBe('not-present')
    expect(manifest.retiredSkills[retiredV8BuilderSkill]?.status).toBe('not-present')
    expect(manifest.lastTransactionId).toMatch(/^[0-9a-f]{32}$/)

    await new Promise((resolve) => setTimeout(resolve, 50))
    const second = await runInstaller()
    expect(second.stdout).toContain('Already current: orchestrate-courseware, build-courseware-project')
    expect(await readFile(manifestPath, 'utf8')).toBe(firstManifestText)
    expect((await stat(manifestPath)).mtimeMs).toBe(firstManifestStat.mtimeMs)
  })

  it('excludes transient Python caches from signatures and installed Skill trees', async () => {
    const sourceSkill = path.join(sourceRoot, 'orchestrate-courseware')
    await mkdir(path.join(sourceSkill, 'scripts', '__pycache__'), { recursive: true })
    await writeFile(
      path.join(sourceSkill, 'scripts', '__pycache__', 'helper.cpython-313.pyc'),
      Buffer.from([0x42, 0x0d, 0x0d, 0x0a]),
    )
    await writeFile(
      path.join(sourceSkill, 'scripts', 'helper.pyo'),
      Buffer.from([0x01, 0x02, 0x03]),
    )

    await runInstaller()
    const installedSkill = path.join(destinationRoot, 'orchestrate-courseware')
    expect(await exists(path.join(
      installedSkill,
      'scripts',
      '__pycache__',
      'helper.cpython-313.pyc',
    ))).toBe(false)
    expect(await exists(path.join(installedSkill, 'scripts', 'helper.pyo')))
      .toBe(false)
    expect((await readManifest()).skills['orchestrate-courseware']?.installedTreeSignature)
      .toBe(await treeSignature(sourceSkill))

    await mkdir(path.join(installedSkill, 'scripts', '__pycache__'), { recursive: true })
    await writeFile(
      path.join(installedSkill, 'scripts', '__pycache__', 'runtime.cpython-313.pyc'),
      Buffer.from([0x99]),
    )
    const rerun = await runInstaller()
    expect(rerun.stdout).toContain('Already current: orchestrate-courseware')
    expect((await readManifest()).skills).toHaveProperty('orchestrate-courseware')
  })

  it('updates a v2 managed Skill only while its installed bytes still match', async () => {
    await runInstaller()
    await writeFile(
      path.join(sourceRoot, 'orchestrate-courseware', 'SKILL.md'),
      '---\nname: orchestrate-courseware\ndescription: Updated source.\n---\n\n# Updated\n',
      'utf8',
    )

    const result = await runInstaller()
    expect(result.stdout).toContain('Installed/updated: orchestrate-courseware')
    expect(await readFile(
      path.join(destinationRoot, 'orchestrate-courseware', 'SKILL.md'),
      'utf8',
    )).toContain('# Updated')
    expect((await readManifest()).skills['orchestrate-courseware']?.installedTreeSignature)
      .toBe(await treeSignature(path.join(sourceRoot, 'orchestrate-courseware')))

    await writeFile(
      path.join(destinationRoot, 'orchestrate-courseware', 'user-note.md'),
      '# Preserve my change\n',
      'utf8',
    )
    await writeFile(
      path.join(sourceRoot, 'orchestrate-courseware', 'SKILL.md'),
      '---\nname: orchestrate-courseware\ndescription: Newer source.\n---\n\n# Newer\n',
      'utf8',
    )
    const preserved = await runInstaller()
    expect(`${preserved.stdout}\n${preserved.stderr}`).toContain('modified managed copy')
    expect(await exists(path.join(
      destinationRoot,
      'orchestrate-courseware',
      'user-note.md',
    ))).toBe(true)
    expect((await readManifest()).skills).not.toHaveProperty('orchestrate-courseware')
  })

  it('replaces an unmanaged same-name current Skill with the repository copy', async () => {
    await createSkill(destinationRoot, 'orchestrate-courseware', '# User custom copy\n')

    const result = await runInstaller()
    expect(result.stdout).toContain('Installed/updated: orchestrate-courseware')
    expect(await readFile(
      path.join(destinationRoot, 'orchestrate-courseware', 'SKILL.md'),
      'utf8',
    )).toContain('# Orchestrate current')
    expect(await exists(path.join(destinationRoot, 'build-courseware-project', 'SKILL.md'))).toBe(true)
    expect((await readManifest()).skills).toHaveProperty('orchestrate-courseware')
  })

  it('retires an unmodified v1-managed V7 copy whose bytes match a known signature', async () => {
    const legacyPath = await createSkill(
      destinationRoot,
      'build-project-v7-courseware',
      '# Archived V7 official copy\n',
    )
    const legacySignature = await treeSignature(legacyPath)
    await writeJson(path.join(destinationRoot, manifestName), {
      schemaVersion: 1,
      source: 'ittoedu-courseware-editor',
      skills: ['build-project-v7-courseware'],
    })

    const result = await runInstaller({
      env: {
        COURSEWARE_SKILLS_TEST_MODE: '1',
        COURSEWARE_SKILLS_TEST_V7_SIGNATURE: legacySignature,
      },
    })
    expect(result.stdout).toContain('Retired managed legacy Skill: build-project-v7-courseware')
    expect(await exists(legacyPath)).toBe(false)
    expect((await readManifest()).retiredSkills['build-project-v7-courseware']).toEqual({
      status: 'removed',
      lastManagedTreeSignature: legacySignature,
    })
  })

  it('retires a v2-managed V7 copy only when it still matches the recorded installed signature', async () => {
    const legacyPath = await createSkill(
      destinationRoot,
      'build-project-v7-courseware',
      '# V2 managed V7\n',
    )
    const legacySignature = await treeSignature(legacyPath)
    await writeJson(path.join(destinationRoot, manifestName), {
      schemaVersion: 2,
      source: 'ittoedu-courseware-editor',
      skills: {
        'build-project-v7-courseware': {
          installedTreeSignature: legacySignature,
        },
      },
      retiredSkills: {},
      lastTransactionId: '00000000000000000000000000000000',
    })

    await runInstaller()
    expect(await exists(legacyPath)).toBe(false)
    expect((await readManifest()).retiredSkills['build-project-v7-courseware']?.status)
      .toBe('removed')
  })

  it('retires a v2-managed V8 Builder copy only when it still matches the recorded installed signature', async () => {
    const legacyPath = await createSkill(
      destinationRoot,
      retiredV8BuilderSkill,
      '# V2 managed V8\n',
    )
    const legacySignature = await treeSignature(legacyPath)
    await writeJson(path.join(destinationRoot, manifestName), {
      schemaVersion: 2,
      source: 'ittoedu-courseware-editor',
      skills: {
        [retiredV8BuilderSkill]: {
          installedTreeSignature: legacySignature,
        },
      },
      retiredSkills: {},
      lastTransactionId: '00000000000000000000000000000000',
    })

    const result = await runInstaller()
    expect(result.stdout).toContain(`Retired managed legacy Skill: ${retiredV8BuilderSkill}`)
    expect(await exists(legacyPath)).toBe(false)
    expect(await exists(path.join(destinationRoot, 'build-courseware-project', 'SKILL.md'))).toBe(true)
    expect((await readManifest()).retiredSkills[retiredV8BuilderSkill]?.status)
      .toBe('removed')
    expect((await readManifest()).skills).toHaveProperty('build-courseware-project')
    expect((await readManifest()).skills).not.toHaveProperty(retiredV8BuilderSkill)
  })

  it('preserves modified and unmanaged V7 copies and removes them from management', async () => {
    const legacyPath = await createSkill(
      destinationRoot,
      'build-project-v7-courseware',
      '# Archived V7 official copy\n',
    )
    const officialSignature = await treeSignature(legacyPath)
    await writeFile(
      path.join(legacyPath, 'user-note.md'),
      '# My V7 customization\n',
      'utf8',
    )
    await writeJson(path.join(destinationRoot, manifestName), {
      schemaVersion: 1,
      source: 'ittoedu-courseware-editor',
      skills: ['build-project-v7-courseware'],
    })

    const modified = await runInstaller({
      env: {
        COURSEWARE_SKILLS_TEST_MODE: '1',
        COURSEWARE_SKILLS_TEST_V7_SIGNATURE: officialSignature,
      },
    })
    expect(`${modified.stdout}\n${modified.stderr}`).toContain('preserved-modified')
    expect(await exists(path.join(legacyPath, 'user-note.md'))).toBe(true)
    let manifest = await readManifest()
    expect(manifest.skills).not.toHaveProperty('build-project-v7-courseware')
    expect(manifest.retiredSkills['build-project-v7-courseware']?.status)
      .toBe('preserved-modified')

    await rm(path.join(destinationRoot, manifestName))
    const unmanaged = await runInstaller()
    expect(`${unmanaged.stdout}\n${unmanaged.stderr}`).toContain('preserved-unmanaged')
    expect(await exists(path.join(legacyPath, 'user-note.md'))).toBe(true)
    manifest = await readManifest()
    expect(manifest.retiredSkills['build-project-v7-courseware']?.status)
      .toBe('preserved-unmanaged')
  })

  it('rejects a corrupt manifest before changing any Skill target', async () => {
    await mkdir(destinationRoot, { recursive: true })
    const manifestPath = path.join(destinationRoot, manifestName)
    await writeFile(manifestPath, '{ definitely-not-json', 'utf8')

    const result = await runInstaller({ expectFailure: true })
    expect(`${result.stdout}\n${result.stderr}`).toContain('Managed Skill manifest is invalid')
    expect(await readFile(manifestPath, 'utf8')).toBe('{ definitely-not-json')
    expect(await exists(path.join(destinationRoot, 'orchestrate-courseware'))).toBe(false)
    expect(await exists(path.join(destinationRoot, 'build-courseware-project'))).toBe(false)
  })

  it('rolls back an interrupted directory commit before retrying the installation', async () => {
    const interrupted = await runInstaller({
      expectFailure: true,
      env: {
        COURSEWARE_SKILLS_TEST_MODE: '1',
        COURSEWARE_SKILLS_TEST_INTERRUPT_AFTER_DIRECTORIES: '1',
      },
    })
    expect(`${interrupted.stdout}\n${interrupted.stderr}`)
      .toContain('Simulated installer interruption')
    expect(await exists(path.join(destinationRoot, manifestName))).toBe(false)
    expect(await exists(path.join(destinationRoot, 'orchestrate-courseware'))).toBe(true)

    const recovered = await runInstaller()
    expect(recovered.stdout).toContain('Rolled back an interrupted installer transaction')
    expect(recovered.stdout).toContain('Installed/updated: orchestrate-courseware, build-courseware-project')
    const manifest = await readManifest()
    expect(manifest.schemaVersion).toBe(2)
    expect(await treeSignature(path.join(destinationRoot, 'orchestrate-courseware')))
      .toBe(manifest.skills['orchestrate-courseware']?.installedTreeSignature)

    const transactionEntries = await readdir(path.join(temporaryRoot, 'user-scope'))
    const transactionRootName = transactionEntries.find((name) => (
      name.startsWith('.ittoedu-courseware-editor-skill-transaction-')
    ))
    expect(transactionRootName).toBeDefined()
    expect(await exists(path.join(
      temporaryRoot,
      'user-scope',
      transactionRootName!,
      'journal.json',
    ))).toBe(false)
  })
})
