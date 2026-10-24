import type { ComponentLibraryEntry } from '../../../shared/contracts/component-platform/library'
import type { ComponentDefinition, ComponentImplementation, CourseProjectV10 } from '../../../shared/contracts/component-platform/project'
import type { DocumentResources } from '../../../shared/workbench/document'
import { equalComponentValue } from '../../../shared/componentValue'

export interface ComponentLibrarySourceDifference {
  path: string
  baseline?: string
  current?: string
  incoming?: string
}

/** Source material shown before an explicit update, never a second executable source. */
export interface ComponentLibraryUpdateReview {
  baselineAvailable: boolean
  localSourceModified: boolean
  privateInstanceCount: number
  differences: ComponentLibrarySourceDifference[]
  summary: string
  sourceDiff: string
}

export type ComponentLibraryUpdateOptions = { replaceLocalSource?: boolean }

export function componentImplementationSourceFiles(implementation: ComponentImplementation,
  components: DocumentResources['components']): Record<string, string> {
  if (implementation.kind !== 'source') return {}
  if (!implementation.workspace) return { '[inline source]': implementation.source }
  const files = components[implementation.workspace.ownerId] ?? {}
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const source: Record<string, string> = {}
  for (const [name, bytes] of Object.entries(files)) {
    try { source[name] = decoder.decode(bytes) } catch { /* Binary dependencies stay in the ordinary resource closure. */ }
  }
  return source
}

function sourceDiff(label: string, before: string | undefined, after: string | undefined): string {
  if (before === after) return ''
  const oldLines = before?.split(/\r?\n/) ?? [], newLines = after?.split(/\r?\n/) ?? []
  let start = 0
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++
  let oldEnd = oldLines.length, newEnd = newLines.length
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) { oldEnd--; newEnd-- }
  return [`--- ${label}（原）`, `+++ ${label}（新）`, `@@ 第 ${start + 1} 行 @@`,
    ...oldLines.slice(start, oldEnd).map(line => `- ${line}`), ...newLines.slice(start, newEnd).map(line => `+ ${line}`)].join('\n')
}

export function componentDefinitionHasLocalSourceChanges(definition: ComponentDefinition,
  components?: DocumentResources['components']): boolean {
  const baseline = definition.library?.baseline
  if (!baseline) return false
  if (!equalComponentValue(definition.implementation, baseline.implementation)
    || !equalComponentValue(definition.dataSchema, baseline.dataSchema)) return true
  if (baseline.sourceFiles && components) return !equalComponentValue(
    componentImplementationSourceFiles(definition.implementation, components), baseline.sourceFiles)
  return false
}

export function inspectComponentLibraryUpdate(project: CourseProjectV10, definitionId: string, entry: ComponentLibraryEntry,
  resources: DocumentResources): ComponentLibraryUpdateReview {
  const current = project.definitions[definitionId]
  if (!current) throw new Error('待更新组件已不存在。')
  const root = entry.example.instances[entry.example.rootIds[0]]
  const incoming = root && entry.definitions[root.definitionId]
  if (!incoming) throw new Error('更新条目没有可用的组件定义。')
  const baseline = current.library?.baseline
  const baselineAvailable = Boolean(baseline && (baseline.implementation.kind !== 'source'
    || !baseline.implementation.workspace || Object.hasOwn(baseline.sourceFiles ?? {}, baseline.implementation.workspace.entry)))
  const currentFiles = componentImplementationSourceFiles(current.implementation, resources.components)
  const incomingFiles = componentImplementationSourceFiles(incoming.implementation, entry.resources.components)
  const baselineFiles: Record<string, string> = baseline?.sourceFiles
    ?? (baseline?.implementation.kind === 'source' && !baseline.implementation.workspace
      ? { '[inline source]': baseline.implementation.source } : {})
  const differences = [...new Set([...Object.keys(baselineFiles), ...Object.keys(currentFiles), ...Object.keys(incomingFiles)])]
    .sort().map(path => ({ path, ...(Object.hasOwn(baselineFiles, path) ? { baseline: baselineFiles[path] } : {}),
      ...(Object.hasOwn(currentFiles, path) ? { current: currentFiles[path] } : {}),
      ...(Object.hasOwn(incomingFiles, path) ? { incoming: incomingFiles[path] } : {}) }))
    .filter(file => file.current !== file.incoming || baseline && file.baseline !== file.current)
  const localSourceModified = componentDefinitionHasLocalSourceChanges(current, resources.components)
  const privateInstanceCount = Object.values(project.instances)
    .filter(instance => instance.definitionId === definitionId && instance.implementationOverride?.kind === 'source').length
  const summary = [localSourceModified ? '当前共享源码含本地修改。' : baselineAvailable ? '当前共享源码与来源基线一致。'
    : '此历史组件未保留可取得的来源基线，无法判定共享源码是否有本地修改。',
  privateInstanceCount ? `${privateInstanceCount} 个实例保留独立源码，更新不会移除其覆盖。` : '',
  localSourceModified ? '取消可保留当前版本；明确更新会替换共享源码，实例正文、位置和独立源码覆盖保留。' : '更新保留实例正文、位置和独立源码覆盖。']
    .filter(Boolean).join('\n')
  const sourceChanges = differences.flatMap(file => [
    ...(baseline && file.baseline !== file.current ? [sourceDiff(`${file.path}：来源基线 → 当前`, file.baseline, file.current)] : []),
    ...(file.current !== file.incoming ? [sourceDiff(`${file.path}：当前 → 更新`, file.current, file.incoming)] : []),
  ]).filter(Boolean)
  if (!equalComponentValue(current.dataSchema, incoming.dataSchema)) sourceChanges.push(
    sourceDiff('公开参数 schema', JSON.stringify(current.dataSchema, null, 2), JSON.stringify(incoming.dataSchema, null, 2)))
  return { baselineAvailable, localSourceModified, privateInstanceCount, differences, summary,
    sourceDiff: sourceChanges.join('\n\n') || '无可显示的源码差异。' }
}
