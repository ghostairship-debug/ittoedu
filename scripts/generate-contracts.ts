import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { componentDefinitionSchema, courseProjectV10Schema } from '../src/shared/contracts/component-platform/schema'
import { publishedCourseV3Schema } from '../src/shared/contracts/component-platform/published'
import { componentCatalogSchema } from '../src/shared/componentCatalog'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultProjectRoot = path.resolve(scriptDirectory, '..')

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export interface ContractGenerationOptions {
  projectRoot?: string
  outputRoot?: string
}

export interface ContractGenerationResult {
  files: ReadonlyMap<string, string>
}

export function generateContractArtifacts(
  options: ContractGenerationOptions = {},
): ContractGenerationResult {
  const files = new Map<string, string>()

  const courseProjectSchemaJson = z.toJSONSchema(courseProjectV10Schema, {
    unrepresentable: 'any',
  })
  const publishedCourseSchemaJson = z.toJSONSchema(publishedCourseV3Schema, {
    unrepresentable: 'any',
  })
  const componentDefinitionSchemaJson = z.toJSONSchema(componentDefinitionSchema, {
    unrepresentable: 'any',
  })

  const courseProjectFormatted = `${JSON.stringify(courseProjectSchemaJson, null, 2)}\n`
  const publishedCourseFormatted = `${JSON.stringify(publishedCourseSchemaJson, null, 2)}\n`
  const componentDefinitionFormatted = `${JSON.stringify(componentDefinitionSchemaJson, null, 2)}\n`
  const componentCatalogFormatted = `${JSON.stringify(z.toJSONSchema(componentCatalogSchema, { unrepresentable: 'any' }), null, 2)}\n`

  files.set('course-project-v10.schema.json', courseProjectFormatted)
  files.set('published-course-v3.schema.json', publishedCourseFormatted)
  files.set('component-definition.schema.json', componentDefinitionFormatted)
  files.set('component-catalog.schema.json', componentCatalogFormatted)

  const manifest = {
    manifestVersion: 1,
    generator: 'scripts/generate-contracts.ts',
    generationCommand: 'npm run generate:contracts',
    protocols: { project: 10, publishedCourse: 3, componentRuntime: 5 },
    // JSON Schema describes wire structure. Source refinements and runtime behavior
    // remain authoritative in the production parsers and ComponentRuntimeImplementation.
    runtimeSourceOfTruth: 'src/shared/contracts/component-platform/runtime.ts',
    contracts: [
      {
        name: 'courseProjectV10Schema',
        file: 'course-project-v10.schema.json',
        sourceOfTruth: 'src/shared/contracts/component-platform/schema.ts',
        sha256: sha256(courseProjectFormatted),
      },
      {
        name: 'publishedCourseV3Schema',
        file: 'published-course-v3.schema.json',
        sourceOfTruth: 'src/shared/contracts/component-platform/published.ts',
        sha256: sha256(publishedCourseFormatted),
      },
      {
        name: 'componentDefinitionSchema',
        file: 'component-definition.schema.json',
        sourceOfTruth: 'src/shared/contracts/component-platform/schema.ts',
        sha256: sha256(componentDefinitionFormatted),
      },
      {
        name: 'componentCatalogSchema',
        file: 'component-catalog.schema.json',
        sourceOfTruth: 'src/shared/componentCatalog.ts',
        sha256: sha256(componentCatalogFormatted),
      },
    ],
  }

  const manifestFormatted = `${JSON.stringify(manifest, null, 2)}\n`
  files.set('contract-manifest.json', manifestFormatted)

  return { files }
}

async function listJsonFiles(rootPath: string): Promise<string[]> {
  const output: string[] = []
  const visit = async (directory: string): Promise<void> => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile() && entry.name.endsWith('.json')) {
        output.push(path.relative(rootPath, absolute).replaceAll('\\', '/'))
      }
    }
  }
  await visit(rootPath)
  return output.sort((left, right) => left.localeCompare(right, 'en'))
}

export async function writeContractArtifacts(
  outputRoot: string,
  generated: ContractGenerationResult,
): Promise<void> {
  for (const [relativePath, content] of generated.files) {
    const absolute = path.join(outputRoot, ...relativePath.split('/'))
    await fs.mkdir(path.dirname(absolute), { recursive: true })
    await fs.writeFile(absolute, content, 'utf8')
  }
  const expectedPaths = new Set(generated.files.keys())
  for (const relativePath of await listJsonFiles(outputRoot)) {
    if (expectedPaths.has(relativePath)) continue
    await fs.rm(path.join(outputRoot, ...relativePath.split('/')), { force: true })
  }
}

export async function checkContractArtifacts(
  outputRoot: string,
  generated: ContractGenerationResult,
): Promise<void> {
  const failures: string[] = []
  const stalePaths: string[] = []
  for (const [relativePath, expected] of generated.files) {
    const absolute = path.join(outputRoot, ...relativePath.split('/'))
    let actual: string
    try {
      actual = await fs.readFile(absolute, 'utf8')
    } catch {
      failures.push(`缺失 ${relativePath}`)
      continue
    }
    if (actual !== expected) stalePaths.push(relativePath)
  }
  if (stalePaths.length > 0) {
    failures.push(...stalePaths.map((relativePath) => `合同生成物过期 ${relativePath}`))
  }
  const expectedPaths = new Set(generated.files.keys())
  for (const relativePath of await listJsonFiles(outputRoot)) {
    if (!expectedPaths.has(relativePath)) failures.push(`多余 ${relativePath}`)
  }
  if (failures.length > 0) {
    throw new Error(
      `合同清单生成检查失败：\n${failures.map((item) => `- ${item}`).join('\n')}\n` +
      '请运行 npm run generate:contracts 后重试。',
    )
  }
}

interface CliOptions {
  check: boolean
  projectRoot: string
  outputRoot: string
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  let check = false
  let projectRoot = defaultProjectRoot
  let outputRoot: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--check') {
      check = true
      continue
    }
    if (argument === '--project-root' || argument === '--output-root') {
      const value = argv[index + 1]
      if (!value) throw new Error(`${argument} 缺少路径参数。`)
      index += 1
      if (argument === '--project-root') projectRoot = path.resolve(value)
      else if (argument === '--output-root') outputRoot = path.resolve(value)
      continue
    }
    throw new Error(`未知参数：${argument}`)
  }
  return {
    check,
    projectRoot,
    outputRoot: outputRoot ?? path.join(projectRoot, 'artifacts', 'contracts'),
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2))
  const generated = generateContractArtifacts({
    projectRoot: options.projectRoot,
    outputRoot: options.outputRoot,
  })
  if (options.check) {
    await checkContractArtifacts(options.outputRoot, generated)
    console.log(
      `合同 JSON 快照已是最新状态；共 ${generated.files.size} 个合同产物文件通过校验。`,
    )
    return
  }
  await writeContractArtifacts(options.outputRoot, generated)
  console.log(
    `已生成 ${generated.files.size} 个合同产物文件到 ${options.outputRoot}。`,
  )
}

const invokedPath = process.argv[1]
if (invokedPath && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
