import type { ContentApplyResult } from '../../contentApply/planning/types'
import { equalComponentValue } from '../../../shared/componentValue'
import type { ComponentProjectSnapshot } from './coordinator'
import { componentProjectFiles, componentProjectScopeFiles, type ComponentProjectFile, type ComponentProjectFileScope } from './projection'
import { hasBuiltinComponentSource } from '../../components/source/builtinSources'

function bindingIdentity(file: ComponentProjectFile): unknown {
  const binding = file.binding
  return binding?.kind === 'flow' ? { kind: binding.kind, surfaceId: binding.surfaceId, format: binding.format }
    : binding?.kind === 'spatial' ? { kind: binding.kind, surfaceId: binding.surfaceId } : binding
}

/** Natural names can change; only the existing canonical binding identifies an observed file. */
export const sameComponentProjectFile = (left: ComponentProjectFile, right: ComponentProjectFile): boolean => left.kind === right.kind
  && (left.binding ? equalComponentValue(bindingIdentity(left), bindingIdentity(right))
    : !right.binding && (left.target ? equalComponentValue(left.target, right.target) : !right.target && left.path === right.path))
  && left.sourceFile?.path === right.sourceFile?.path
  && (left.builtinSource && right.builtinSource
    ? left.builtinSource.key === right.builtinSource.key && left.builtinSource.part === right.builtinSource.part
    : (left.builtinSource?.part !== 'implementation' || hasBuiltinComponentSource(left.builtinSource.key))
      && (right.builtinSource?.part !== 'implementation' || hasBuiltinComponentSource(right.builtinSource.key))
      && left.authorSource?.dependencyId === right.authorSource?.dependencyId)

/** Select actual result paths; returning metadata does not advance any observed content baseline. */
export function componentProjectApplyReceiptFiles(baseline: ComponentProjectSnapshot, original: ComponentProjectFile,
  result: ContentApplyResult, after: ComponentProjectSnapshot, scope: ComponentProjectFileScope = { kind: 'document' },
  currentFiles?: ComponentProjectFile[]) {
  if (result.commit !== 'committed' && result.commit !== 'unchanged') return { files: [] as ComponentProjectFile[] }
  if (after.documentId !== baseline.documentId || after.epoch !== baseline.epoch)
    throw new Error('工程身份已变化，无法取得本次提交的当前文件路径。')
  const project = after.model.project, instanceIds = new Set<string>()
  const visit = (id: string) => {
    if (instanceIds.has(id)) return
    const instance = project.instances[id]
    if (!instance) return
    instanceIds.add(id)
    instance.childIds?.forEach(visit)
  }
  result.insertedIds.forEach(visit)
  if (original.target?.kind === 'instance') instanceIds.add(original.target.instanceId)
  const binding = original.binding
  if (binding?.kind === 'instance-source' || binding?.kind === 'instance-authoring') instanceIds.add(binding.instanceId)
  const definitionId = binding?.kind === 'definition' || binding?.kind === 'definition-source' ? binding.definitionId : undefined
  if (definitionId && binding?.kind === 'definition')
    Object.values(project.instances).filter(instance => instance.definitionId === definitionId).forEach(instance => visit(instance.id))
  const current = componentProjectScopeFiles(project, currentFiles ?? componentProjectFiles(project, after.model.resources), scope)
  const files = current.filter(file => {
    if (file.target?.kind === 'instance' && instanceIds.has(file.target.instanceId)) return true
    if (definitionId && (file.binding?.kind === 'definition' || file.binding?.kind === 'definition-source')) return file.binding.definitionId === definitionId
    return !result.insertedIds.length && sameComponentProjectFile(original, file)
  })
  const insertedChildren = new Set(result.insertedIds.flatMap(id => project.instances[id]?.childIds ?? []))
  const firstInserted = result.insertedIds.find(id => project.instances[id] && !insertedChildren.has(id))
  const contentFile = (id: string | undefined) => id && files.find(file => file.target?.kind === 'instance'
    && file.target.instanceId === id && !file.binding && (file.kind === 'html' || file.kind === 'data'))
  const primary = (result.input.intent === 'insert' || result.input.intent === 'redo') && contentFile(firstInserted)
    || files.find(file => sameComponentProjectFile(original, file))
    || contentFile(original.target?.kind === 'instance' ? original.target.instanceId : undefined)
  return { files, ...(primary ? { primary } : {}) }
}
