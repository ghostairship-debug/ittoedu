import { componentSurfaces } from '../../shared/contracts/component-platform/project'
import type { ComponentBackground, ComponentImplementation, CourseProjectV10 } from '../../shared/contracts/component-platform/project'
import { componentDefinitionBuiltinKey } from '../../shared/contracts/component-platform/project'
import { courseProjectV10Schema } from '../../shared/contracts/component-platform/schema'
import { componentBackgroundAssetIds } from '../../shared/componentBackgroundPaint'
import type { ComponentProjectDiagnosticTarget, ComponentProjectHealthFinding } from '../../shared/componentProjectHealth'
import type { DocumentResources } from '../../shared/workbench/document'
import { imageAssetReferences, imageDataSchema } from '../../components/image/data'
import { audioDataSchema, mediaAssetReferences, videoDataSchema } from '../../components/media/data'
import { liveSourceOwners } from './compilation/liveSourceReferences'

/** Collect current ownership, professional resources and actual Source import references. */
export function collectComponentProjectHealth(project: CourseProjectV10, resources: DocumentResources): ComponentProjectHealthFinding[] {
  const findings: ComponentProjectHealthFinding[] = []
  const add = (code: string, message: string, path: Array<string | number>, target: ComponentProjectDiagnosticTarget,
    severity: ComponentProjectHealthFinding['severity'] = 'error') => findings.push({ code, message, path, target, severity })
  const result = courseProjectV10Schema.safeParse(project)
  if (!result.success) for (const issue of result.error.issues) {
    const path = issue.path.filter(value => typeof value === 'string' || typeof value === 'number') as Array<string | number>
    const target: ComponentProjectDiagnosticTarget = path[0] === 'instances' && typeof path[1] === 'string'
      ? { projectId: project.id, kind: 'instance', instanceId: path[1] }
      : { projectId: project.id, kind: 'project' }
    add('project-structure-invalid', issue.message, path, target)
  }
  for (const [id] of Object.entries(project.assets)) if (!resources.assets[id])
    add('asset-bytes-missing', `素材 ${id} 缺少工程字节；可用内容与引用保留`, ['assets', id], { projectId: project.id, kind: 'asset', assetId: id })
  const background = (value: ComponentBackground | null | undefined, path: Array<string | number>, target: ComponentProjectDiagnosticTarget) => {
    for (const id of componentBackgroundAssetIds(value)) if (!project.assets[id])
      add('background-asset-reference-missing', `背景引用的素材 ${id} 已不存在`, [...path, value?.assetId === id ? 'assetId' : 'paint'], target)
  }
  background(project.background, ['background'], { projectId: project.id, kind: 'project' })
  componentSurfaces(project).forEach((surface, index) => {
    const target: ComponentProjectDiagnosticTarget = { projectId: project.id, kind: 'surface', surfaceId: surface.id }
    background(surface.background, ['surfaces', index, 'background'], target)
    surface.presentation?.states.forEach((state, stateIndex) => background(state.background,
      ['surfaces', index, 'presentation', 'states', stateIndex, 'background'], target))
  })
  // The capture fixes both project and workspace bytes. Shared instances reuse one
  // traversal; a later capture naturally observes changed source or bindings.
  const sourceOwners = new Map<ComponentImplementation, ReturnType<typeof liveSourceOwners>>()
  const importsCache = new Map<string, string[] | undefined>()
  for (const instance of Object.values(project.instances)) {
    const definition = project.definitions[instance.definitionId]
    const implementation = instance.implementationOverride ?? definition?.implementation
    const target: ComponentProjectDiagnosticTarget = { projectId: project.id, kind: 'instance', instanceId: instance.id }
    for (const [alias, key] of Object.entries(instance.stateBindings ?? {})) if (!project.logic?.courseState.some(state => state.key === key))
      add('state-binding-source-missing', `状态别名 ${alias} 的声明 ${key} 已不存在；内容和连接保留，可修正来源。`,
        ['instances', instance.id, 'stateBindings', alias], target, 'warning')
    if (implementation?.kind === 'source') {
      let owners = sourceOwners.get(implementation)
      if (!owners) { owners = liveSourceOwners(project, implementation, resources, importsCache); sourceOwners.set(implementation, owners) }
      for (const [owner, dependencies] of owners.modules) for (const id of dependencies) {
        const dependency = Object.hasOwn(project.definitions, id) ? project.definitions[id] : undefined
        if (!dependency || dependency.implementation.kind !== 'source') {
          const ownerDefinition = Object.values(project.definitions).find(value => value.implementation === owner)
          const path = owner === instance.implementationOverride
            ? ['instances', instance.id, 'implementationOverride'] : ['definitions', ownerDefinition?.id ?? instance.definitionId, 'implementation']
          add('source-dependency-missing', `源码实际引用的模块 ${id} 未提供实际模块源码；当前实例源码保留`, path, target)
        }
      }
    }
    const key = componentDefinitionBuiltinKey(definition)
    if (key === 'guoling.image') {
      const data = imageDataSchema.safeParse(instance.data)
      if (data.success) for (const id of imageAssetReferences(data.data)) if (!project.assets[id])
        add('image-asset-reference-missing', `图片引用的素材 ${id} 已不存在`,
          ['instances', instance.id, 'data', data.data.assetId === id ? 'assetId' : 'originalAssetId'], target)
    }
    if (key === 'guoling.audio' || key === 'guoling.video') {
      const data = (key === 'guoling.audio' ? audioDataSchema : videoDataSchema).safeParse(instance.data)
      if (data.success) for (const id of mediaAssetReferences(data.data)) if (!project.assets[id])
        add('media-asset-reference-missing', `媒体引用的素材 ${id} 已不存在`,
          ['instances', instance.id, 'data', ...(data.data.assetId === id ? ['assetId'] : ['poster', 'assetId'])], target)
    }
  }
  return findings
}
