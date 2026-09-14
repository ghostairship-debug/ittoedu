import { readFile, mkdir, copyFile, realpath, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { GenerationRequest } from '../src/shared/generationContract'

/** Source identity comes from the frozen descriptor, never from the edited files. */
export async function prepareComponentPatch(request: GenerationRequest, root: string, args: {
  target: string; directory: string; initialize: boolean; summary?: string; observe?: string; deleteFiles: string[];
}) {
  const match = /^d([1-9][0-9]*)$/.exec(args.target)
  const destination = match ? request.destinations[Number(match[1]) - 1] : undefined
  if (destination?.kind !== 'update') throw new Error('组件补丁需要本轮精确 update 目标别名')
  const sources = (request.context as any)?.componentSources as any[] | undefined
  const sameTarget = (target: any) => target && target.authoringAddress === destination.target.authoringAddress
  const source = sources?.find(source => sameTarget(source.editTargets?.shared?.target)
    || source.editTargets?.instance?.some((entry: any) => sameTarget(entry.target) && entry.sourcePatch.status === 'available'))
  if (!source?.files || !source.baseContentIdentity) throw new Error('当前目标没有可用的冻结组件源码描述')
  const mode = sameTarget(source.editTargets?.shared?.target) ? 'shared' : 'instance'
  const work = path.resolve(args.directory)
  await mkdir(work, { recursive: true })
  const workRoot = await realpath(work)
  const inside = (base: string, file: string) => { const relative = path.relative(base, file); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative) }
  if (!inside(root, workRoot) || inside(path.join(root, 'resources'), workRoot)) throw new Error('工作副本须放本轮暂存区中、resources 冻结目录之外，例如 <candidateRoot>/component-work')
  const changedFiles: Record<string, string | { encoding: 'utf8'; text: string }> = {}
  for (const [name, descriptor] of Object.entries(source.files) as [string, any][]) {
    const baseline = await realpath(path.resolve(root, descriptor.path))
    if (!inside(root, baseline)) throw new Error('冻结源码路径超出本轮目录')
    const working = path.resolve(workRoot, name)
    if (!inside(workRoot, working)) throw new Error('组件文件路径超出工作副本')
    if (args.initialize) {
      await mkdir(path.dirname(working), { recursive: true })
      await copyFile(baseline, working, 1) // COPYFILE_EXCL: never overwrite an existing draft.
    } else if (!args.deleteFiles.includes(name)) {
      const current = await realpath(working)
      if (!inside(workRoot, current)) throw new Error('工作文件不能重定向到副本之外')
      const [before, after] = await Promise.all([readFile(baseline), readFile(current)])
      if (!before.equals(after)) changedFiles[name] = descriptor.encoding === 'utf8' ? { encoding: 'utf8', text: after.toString('utf8') } : after.toString('base64')
    }
  }
  if (args.initialize) return null
  const collectNew = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name), actual = await realpath(filename)
      if (!inside(workRoot, actual)) throw new Error('新增文件不能重定向到副本之外')
      if (entry.isDirectory()) { await collectNew(filename); continue }
      const name = path.relative(workRoot, filename).split(path.sep).join('/')
      if (Object.hasOwn(source.files, name)) continue
      const bytes = await readFile(filename)
      changedFiles[name] = /\.(js|json|css|txt|svg)$/i.test(name) ? { encoding: 'utf8', text: bytes.toString('utf8') } : bytes.toString('base64')
    }
  }
  await collectNew(workRoot)
  if (args.deleteFiles.some(name => !Object.hasOwn(source.files, name)) || new Set(args.deleteFiles).size !== args.deleteFiles.length) throw new Error('删除列表必须是基线中不重复的文件名')
  if (!Object.keys(changedFiles).length && !args.deleteFiles.length) throw new Error('工作副本没有源码变化，无需提交组件补丁')
  if (!args.summary?.trim()) throw new Error('请用 --summary 给出本次修改摘要')
  return { version: 1, requestId: request.requestId, summary: args.summary,
    afterCommit: args.observe ? { version: 1, action: 'observe', reason: args.observe } : { version: 1, action: 'finish' },
    steps: [{ id: 'component-patch', tool: 'component.package', carrier: 'generated-component', destination,
      input: { operation: 'patch', mode, basePackageId: source.packageId, baseVersion: source.baseVersion,
        baseContentIdentity: source.baseContentIdentity, changedFiles, deleteFiles: args.deleteFiles } }] }
}
