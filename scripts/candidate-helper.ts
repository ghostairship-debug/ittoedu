import { readFile, writeFile, realpath, rename } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { prepareComponentPatch } from './candidate-component-patch'
import { generationRequestSchema } from '../src/shared/generationContract'
import { parseGenerationCandidate, MAX_GENERATION_RESULT_BYTES, generationStagedCandidateMarker } from '../src/shared/generationResult'
import { checkAuthoringOperationConditions, type AuthoringOperationCondition } from '../src/shared/authoringOperationConditions'
import { checkGenerationStaticPrecheck } from '../src/shared/generationStaticPrecheck'

/** Bundled with its formal parsers into the versioned capability workspace.
 * No repository, node_modules, service, live document or provider is needed. */
async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && ['--help', '-h'].includes(args[0]!)) { console.log('node candidate-helper.mjs --request <request.json> --input <draft.json> [--check]\nNormal delivery: call once without --check; the helper validates and writes candidate.json in that call. Use --check only for a no-write precheck. Component: --request <request.json> --component-target d1 --work-dir <candidateRoot>/component-work --init\nThen edit work files; repeat without --init and add --summary <text> [--observe <remaining check>] [--delete <file>] [--check]. Frozen baseline is preserved. Precheck is not host commit.'); return }
  const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
  const requestPath = option('--request'), inputPath = option('--input')
  for (let index = 0; index < args.length; index++) {
    if (['--check', '--init'].includes(args[index]!)) continue
    if (!['--request', '--input', '--component-target', '--work-dir', '--summary', '--observe', '--delete'].includes(args[index]!) || !args[++index]) throw new Error('未知或缺值参数；运行 --help 查看用法')
  }
  if (!requestPath || (!inputPath && !option('--component-target')) || (inputPath && option('--component-target'))) throw new Error('需要 --request 与 --input，或 --component-target / --work-dir；运行 --help 查看用法')
  const requestFile = await realpath(requestPath), root = path.dirname(requestFile)
  const rawRequest = JSON.parse(await readFile(requestFile, 'utf8'))
  const request = generationRequestSchema.parse(Object.fromEntries(Object.keys(generationRequestSchema.shape).filter(key => Object.hasOwn(rawRequest, key)).map(key => [key, rawRequest[key]])))
  const prepared = option('--component-target') ? await prepareComponentPatch(request, root, {
    target: option('--component-target')!, directory: option('--work-dir') ?? path.join(root, 'component-work'), initialize: args.includes('--init'),
    summary: option('--summary'), observe: option('--observe'), deleteFiles: args.flatMap((value, index) => value === '--delete' ? [args[index + 1]!] : []),
  }) : undefined
  if (prepared === null) { console.log(JSON.stringify({ status: 'working-copy-created', message: '工作副本已准备；修改文件后去掉 --init 并提供 --summary 生成候选。' })); return }
  const text = prepared ? JSON.stringify({ ...prepared, candidateId: randomUUID() }) : await readFile(inputPath!, 'utf8')
  if (Buffer.byteLength(text) > MAX_GENERATION_RESULT_BYTES) throw new Error('候选文件超过容量')
  const draft = JSON.parse(text)
  const candidate = parseGenerationCandidate(draft.version === undefined ? { version: 2, requestId: request.requestId, afterCommit: { version: 1, action: 'finish' }, ...draft } : draft, request, { candidateId: randomUUID() })
  const data = JSON.parse(await readFile(new URL('./discovery-data.json', import.meta.url), 'utf8'))
  const diagnostics: unknown[] = [], deferred: unknown[] = []
  for (const step of candidate.steps) {
    const entry = data.entries.find((entry: { id: string }) => entry.id === step.tool)
    if (!entry) { diagnostics.push({ stepId: step.id, code: 'unknown-tool', path: ['tool'], message: '请查询当前能力目录；未覆盖需求可使用 project.document。' }); continue }
    if (!data.resourcePaths.includes(entry.path)) throw new Error('能力卡不在当前只读资源目录')
    const card = JSON.parse(await readFile(new URL(entry.path, import.meta.url), 'utf8')) as { conditions?: AuthoringOperationCondition[]; inputSchema: any }
    const references: (string | number)[][] = []
    const visit = (value: any, at: (string | number)[] = []) => {
      if (!value || typeof value !== 'object') return
      if ('$result' in value || '$candidateFile' in value) { references.push(at); return }
      Object.entries(value).forEach(([key, child]) => visit(child, [...at, Array.isArray(value) ? Number(key) : key]))
    }
    visit(step.input)
    const checked = z.fromJSONSchema(card.inputSchema).safeParse(step.input)
    const remaining = (issues: readonly z.core.$ZodIssue[]): any[] => issues.flatMap(issue => {
      if (references.some(at => at.every((part, i) => issue.path[i] === part))) return []
      if (issue.code === 'invalid_union') return issue.errors.map(remaining).sort((a, b) => a.length - b.length)[0] ?? []
      return [{ stepId: step.id, code: 'invalid-input', path: ['input', ...issue.path], message: issue.message }]
    })
    if (!checked.success) diagnostics.push(...remaining(checked.error.issues))
    if (references.length) deferred.push({ stepId: step.id, check: 'host-result-or-file', paths: references, message: '引用格式由候选合同校验，实际值由宿主展开后复核' })
    if (step.destination.kind === 'create' || step.destination.kind === 'update') diagnostics.push(...checkAuthoringOperationConditions(card.conditions ?? [], step.destination, step.input).map(error => ({ stepId: step.id, ...error })))
    else deferred.push({ stepId: step.id, check: 'created-target', message: '需要宿主前序创建回执' })
  }
  diagnostics.push(...checkGenerationStaticPrecheck(candidate, request))
  if (diagnostics.length) { console.error(JSON.stringify({ status: 'rejected', diagnostics })); process.exitCode = 1; return }
  if (!args.includes('--check')) {
    const destination = path.join(root, 'candidate.json')
    try { if (await realpath(destination) !== destination) throw new Error('候选输出不能重定向') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    const temporary = path.join(root, `.candidate-${randomUUID()}.tmp`)
    await writeFile(temporary, JSON.stringify(candidate), { flag: 'wx', mode: 0o600 })
    await rename(temporary, destination)
  }
  const checkOnly = args.includes('--check')
  console.log(JSON.stringify(checkOnly
    ? { status: 'prechecked', requestId: request.requestId, candidateFile: null, delivery: 'not-delivered', deferred,
      message: '仅预检通过，未生成交付文件，不能声明已交付；交付须去掉 --check 再运行。候选结构、工具字段及静态目标条件通过；素材、运行期细化约束、当前版本与动态行为仍需宿主检查，尚未提交。' }
    : { status: 'ready-for-host', requestId: request.requestId, candidateFile: 'candidate.json', delivery: 'ready-for-host', deferred,
      declaration: generationStagedCandidateMarker(request.requestId),
      message: '候选已写入当前请求的 candidate.json，这还不是工程提交；只有宿主回执 committed/unchanged 才可声称已应用。声明交付：文件通道在最终答复原样附上 declaration；结构化输出通道在其 candidate 字段声明 candidateFile。候选结构、工具字段及静态目标条件通过；素材、运行期细化约束、当前版本与动态行为仍需宿主检查，尚未提交。' }))
}
main().catch(error => { console.error(JSON.stringify({ status: 'rejected', diagnostics: error.issues ?? [{ code: 'candidate-precheck', path: [], message: error.message }] })); process.exitCode = 1 })
