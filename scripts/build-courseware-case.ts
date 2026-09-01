import '../src/renderer/export/bundledFontEmbedSourceNode'
import { componentPackagesFromArchive } from '../src/renderer/components/componentPackageStore'
import {
  COURSEWARE_CASE_BUILDER_API_VERSION,
  createCoursewareCaseBuilderApi,
  type CoursewareCaseBuildOutput,
  type CoursewareCaseBuilder,
  type CoursewareCaseBuilderContext,
} from '../src/renderer/course/coursewareCaseBuilderApi'
import { buildPublishedCourseStandaloneHtml } from '../src/renderer/export/course/buildCoursePackages'
import { buildPublishedCourseV2Payload } from '../src/renderer/export/course/buildPublishedCourse'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '../src/renderer/project/courseProjectArchive'
import {
  courseProjectValidationExitCode,
  validateCourseProjectArchiveBytes,
} from './validate-project'
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export interface CoursewareCaseBuildOptions {
  caseDir: string
  builder: string
  teachingPlan: string
  presentationScript: string
  project: string
  html: string
  force: boolean
}

export interface CoursewareCaseBuildDependencies {
  editorRoot?: string
  playerBundle?: string
  importBuilder?: (filename: string) => Promise<unknown>
}

export interface CoursewareCaseBuildSummary {
  status: 'built'
  projectId: string
  title: string
  revision: number
  locations: number
  surfaces: number
  project: string
  html: string
  validation: { error: number, warning: number, info: number }
}

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const usage = [
  '用法：npm run --silent build:courseware-case -- --case-dir <目录> --project <相对路径.h5lesson> --html <相对路径.html> [选项]',
  '  --builder <相对路径>  课例构建模块，默认 implementation/build.ts',
  '  --plan <相对路径>     已确认教学策划，默认 01-teaching-plan.md',
  '  --script <相对路径>   已确认呈现脚本，默认 02-presentation-script.md',
  '  --force               原子替换已存在的两个交付文件',
].join('\n')

function parseArgs(argv: readonly string[]): CoursewareCaseBuildOptions {
  const values = new Map<string, string>()
  let force = false
  const valueFlags = new Set([
    '--case-dir', '--builder', '--plan', '--script', '--project', '--html',
  ])
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--force') {
      force = true
      continue
    }
    if (!flag || !valueFlags.has(flag)) throw new Error(`未知参数：${flag ?? ''}\n${usage}`)
    const value = argv[++index]
    if (!value || value.startsWith('--')) throw new Error(`${flag} 缺少参数值\n${usage}`)
    values.set(flag, value)
  }
  const caseDir = values.get('--case-dir')
  const project = values.get('--project')
  const html = values.get('--html')
  if (!caseDir || !project || !html) throw new Error(`--case-dir、--project 和 --html 均为必填项\n${usage}`)
  return {
    caseDir,
    builder: values.get('--builder') ?? 'implementation/build.ts',
    teachingPlan: values.get('--plan') ?? '01-teaching-plan.md',
    presentationScript: values.get('--script') ?? '02-presentation-script.md',
    project,
    html,
    force,
  }
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (
    !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
  )
}

function requireRelative(value: string, label: string): void {
  if (path.isAbsolute(value) || value.trim().length === 0) {
    throw new Error(`${label} 必须是课例目录内的相对路径：${value}`)
  }
}

async function existingParent(filename: string): Promise<string> {
  let current = filename
  while (true) {
    try {
      await lstat(current)
      return current
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const parent = path.dirname(current)
    if (parent === current) throw new Error(`找不到输出路径的已有父目录：${filename}`)
    current = parent
  }
}

async function resolveCasePath(
  caseRoot: string,
  value: string,
  label: string,
  options: { exists: boolean, extensions: readonly string[] },
): Promise<string> {
  requireRelative(value, label)
  const resolved = path.resolve(caseRoot, value)
  if (!isWithin(caseRoot, resolved)) throw new Error(`${label} 逃逸课例目录：${value}`)
  if (!options.extensions.includes(path.extname(resolved).toLowerCase())) {
    throw new Error(`${label} 必须使用 ${options.extensions.join(' 或 ')} 扩展名：${value}`)
  }
  const anchor = options.exists ? resolved : await existingParent(resolved)
  let metadata
  try {
    metadata = await lstat(anchor)
  } catch (error) {
    if (options.exists && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${label} 不存在：${value}`)
    }
    throw error
  }
  if (metadata.isSymbolicLink()) throw new Error(`${label} 不得经过符号链接：${value}`)
  const realAnchor = await realpath(anchor)
  if (!isWithin(caseRoot, realAnchor)) throw new Error(`${label} 经链接逃逸课例目录：${value}`)
  if (options.exists && !metadata.isFile()) throw new Error(`${label} 不是文件：${value}`)
  return resolved
}

async function exists(filename: string): Promise<boolean> {
  try {
    await stat(filename)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

function pathIdentity(filename: string): string {
  const resolved = path.resolve(filename)
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved
}

async function defaultImportBuilder(filename: string): Promise<unknown> {
  return import(pathToFileURL(filename).href)
}

function resolveBuilder(value: unknown, filename: string): CoursewareCaseBuilder {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`课例构建模块没有导出函数：${filename}`)
  }
  const module = value as Record<string, unknown>
  const candidate = module.default ?? module.buildCoursewareCase
  if (typeof candidate !== 'function') {
    throw new Error(`课例构建模块必须 default export 或导出 buildCoursewareCase 函数：${filename}`)
  }
  return candidate as CoursewareCaseBuilder
}

function normalizeBuildOutput(value: unknown): CoursewareCaseBuildOutput {
  if (typeof value !== 'object' || value === null) {
    throw new Error('课例构建函数必须返回 CoursewareCaseBuildOutput。')
  }
  const output = value as Partial<CoursewareCaseBuildOutput>
  if (typeof output.project !== 'object' || output.project === null) {
    throw new Error('课例构建结果缺少 project。')
  }
  return {
    project: output.project,
    assetFiles: output.assetFiles ?? {},
    componentFiles: output.componentFiles ?? {},
  }
}

async function writeDeliveries(
  caseRoot: string,
  deliveries: ReadonlyArray<{ target: string, bytes: Uint8Array | string }>,
  force: boolean,
): Promise<void> {
  for (const { target } of deliveries) {
    if (await exists(target)) {
      const metadata = await lstat(target)
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error(`交付目标不是普通文件：${target}`)
      }
      if (!force) throw new Error(`交付文件已存在；确认替换时使用 --force：${target}`)
    }
  }

  const transactionRoot = await mkdtemp(path.join(caseRoot, '.courseware-case-build-'))
  const states: Array<{
    target: string
    staged: string
    backup: string | null
    installed: boolean
  }> = []
  try {
    for (const [index, delivery] of deliveries.entries()) {
      const staged = path.join(transactionRoot, `staged-${index}`)
      await writeFile(staged, delivery.bytes)
      states.push({ target: delivery.target, staged, backup: null, installed: false })
    }
    for (const [index, state] of states.entries()) {
      await mkdir(path.dirname(state.target), { recursive: true })
      if (await exists(state.target)) {
        state.backup = path.join(transactionRoot, `backup-${index}`)
        await rename(state.target, state.backup)
      }
      await rename(state.staged, state.target)
      state.installed = true
    }
  } catch (error) {
    for (const state of [...states].reverse()) {
      if (state.installed && await exists(state.target)) await rm(state.target, { force: true })
      if (state.backup && await exists(state.backup)) await rename(state.backup, state.target)
    }
    throw error
  } finally {
    const resolvedTransaction = path.resolve(transactionRoot)
    if (!isWithin(caseRoot, resolvedTransaction) || resolvedTransaction === caseRoot) {
      throw new Error(`拒绝清理未验证的构建事务目录：${resolvedTransaction}`)
    }
    await rm(resolvedTransaction, { recursive: true, force: true })
  }
}

async function assertDeliveryTargets(targets: readonly string[], force: boolean): Promise<void> {
  for (const target of targets) {
    if (!await exists(target)) continue
    const metadata = await lstat(target)
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error(`交付目标不是普通文件：${target}`)
    }
    if (!force) throw new Error(`交付文件已存在；确认替换时使用 --force：${target}`)
  }
}

function validationFailureMessage(
  report: ReturnType<typeof validateCourseProjectArchiveBytes>,
): string {
  if (report.fatal) return `${report.fatal.title}：${report.fatal.message}`
  const finding = report.projectHealth?.items.find((item) => item.severity === 'error')
    ?? Object.values(report.exportPreflight ?? {})
      .flatMap((item) => item.items)
      .find((item) => item.severity === 'error')
  return finding?.message ?? '课程工程未通过当前产品校验。'
}

export async function buildCoursewareCase(
  options: CoursewareCaseBuildOptions,
  dependencies: CoursewareCaseBuildDependencies = {},
): Promise<CoursewareCaseBuildSummary> {
  const caseMetadata = await lstat(options.caseDir)
  if (!caseMetadata.isDirectory() || caseMetadata.isSymbolicLink()) {
    throw new Error(`--case-dir 必须是普通目录：${options.caseDir}`)
  }
  const caseRoot = await realpath(options.caseDir)
  const builderPath = await resolveCasePath(caseRoot, options.builder, '--builder', {
    exists: true,
    extensions: ['.ts', '.mts', '.js', '.mjs', '.cjs'],
  })
  const teachingPlanPath = await resolveCasePath(caseRoot, options.teachingPlan, '--plan', {
    exists: true,
    extensions: ['.md'],
  })
  const presentationScriptPath = await resolveCasePath(
    caseRoot,
    options.presentationScript,
    '--script',
    { exists: true, extensions: ['.md'] },
  )
  const projectPath = await resolveCasePath(caseRoot, options.project, '--project', {
    exists: false,
    extensions: ['.h5lesson'],
  })
  const htmlPath = await resolveCasePath(caseRoot, options.html, '--html', {
    exists: false,
    extensions: ['.html'],
  })
  const identities = [builderPath, teachingPlanPath, presentationScriptPath, projectPath, htmlPath]
    .map(pathIdentity)
  if (new Set(identities).size !== identities.length) {
    throw new Error('构建输入与交付路径不能互相别名或覆盖。')
  }
  await assertDeliveryTargets([projectPath, htmlPath], options.force)

  const editorRoot = await realpath(dependencies.editorRoot ?? scriptRoot)
  const capabilityIndexPath = path.join(editorRoot, 'artifacts', 'ai-capabilities', 'index.json')
  const capabilityIndex = JSON.parse(await readFile(capabilityIndexPath, 'utf8')) as unknown
  const [teachingPlan, presentationScript] = await Promise.all([
    readFile(teachingPlanPath, 'utf8'),
    readFile(presentationScriptPath, 'utf8'),
  ])
  if (!teachingPlan.trim() || !presentationScript.trim()) {
    throw new Error('两份已确认教学文件均不得为空。')
  }

  const imported = await (dependencies.importBuilder ?? defaultImportBuilder)(builderPath)
  const builder = resolveBuilder(imported, builderPath)
  const context: CoursewareCaseBuilderContext = Object.freeze({
    apiVersion: COURSEWARE_CASE_BUILDER_API_VERSION,
    caseDir: caseRoot,
    documents: Object.freeze({
      teachingPlan: Object.freeze({ path: teachingPlanPath, content: teachingPlan }),
      presentationScript: Object.freeze({ path: presentationScriptPath, content: presentationScript }),
    }),
    capabilityIndex,
    api: createCoursewareCaseBuilderApi(),
  })
  const output = normalizeBuildOutput(await builder(context))
  const archive = createCourseProjectArchive({
    project: output.project,
    assetFiles: output.assetFiles ?? {},
    componentFiles: output.componentFiles ?? {},
  })
  const validation = validateCourseProjectArchiveBytes(archive, projectPath)
  if (courseProjectValidationExitCode(validation) !== 0) {
    throw new Error(validationFailureMessage(validation))
  }
  const reopened = openCourseProjectArchive(archive)
  const sources = {
    project: reopened.project,
    assetFiles: reopened.assetFiles,
    components: componentPackagesFromArchive(reopened.project, reopened.componentFiles),
  }
  buildPublishedCourseV2Payload(sources)
  const playerBundle = dependencies.playerBundle
    ?? await readFile(path.join(editorRoot, 'dist-player', 'player.iife.js'), 'utf8')
  if (!playerBundle.trim()) throw new Error('编辑器 Player 构建产物为空。')
  const html = buildPublishedCourseStandaloneHtml(sources, { playerBundle, lang: 'zh-CN' })
  await writeDeliveries(caseRoot, [
    { target: projectPath, bytes: archive },
    { target: htmlPath, bytes: html },
  ], options.force)

  return {
    status: 'built',
    projectId: reopened.project.id,
    title: reopened.project.title,
    revision: reopened.project.revision,
    locations: reopened.project.locations.length,
    surfaces: reopened.project.surfaces.length,
    project: projectPath,
    html: htmlPath,
    validation: {
      error: validation.summary.error,
      warning: validation.summary.warning,
      info: validation.summary.info,
    },
  }
}

export async function runBuildCoursewareCaseCli(argv: readonly string[]): Promise<0 | 1 | 2> {
  try {
    const summary = await buildCoursewareCase(parseArgs(argv))
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`课例构建失败：${error instanceof Error ? error.message : String(error)}\n`)
    return error instanceof SyntaxError ? 2 : 1
  }
}

const invoked = process.argv[1]
if (invoked && import.meta.url === pathToFileURL(path.resolve(invoked)).href) {
  void runBuildCoursewareCaseCli(process.argv.slice(2)).then((code) => { process.exitCode = code })
}
