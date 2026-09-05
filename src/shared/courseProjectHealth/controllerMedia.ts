import {
  getComponentPropValue,
  mergeComponentProps,
} from '../componentProps'
import type { ComponentManifest } from '../componentTypes'
import { composeCourseProjectLocation } from '../courseLayerComposition'
import type {
  CourseProjectDocument,
  CourseSurfaceDocument,
  FlowBlock,
  LayerItem,
  SlideSceneDocument,
} from '../courseProjectTypes'
import type { AssetKind } from '../contracts/media-v1'
import type { TeacherControllerAction } from '../contracts/native-v1'
import {
  hasCourseDeliveryVisibleTeacherController,
} from '../teacherControllerConsistency'
import {
  createCourseProjectHealthContext,
  courseProjectComposedLayerPath,
  effectiveLayerItem,
  finalizeCourseProjectHealthFindings,
  manifestFor,
  mergeCourseProjectHealthProps,
  slideScenes,
  visitCourseFlowBlocks,
  visitCourseLayerItems,
} from './internal'
import type {
  CourseProjectHealthArchiveFiles,
  CourseProjectHealthFinding,
  CourseProjectHealthFindingDraft,
} from './types'

interface AssetReferenceLocation {
  path: Array<string | number>
  surfaceId?: string
  layerItemId?: string
}

function addAssetCheck(
  project: CourseProjectDocument,
  drafts: CourseProjectHealthFindingDraft[],
  referenced: Set<string>,
  assetId: string | null | undefined,
  expectedKind: AssetKind | undefined,
  label: string,
  location: AssetReferenceLocation,
  allowMissing: boolean,
): void {
  if (!assetId) return
  referenced.add(assetId)
  const asset = project.assets[assetId]
  if (!asset) {
    if (!allowMissing) return
    drafts.push({
      severity: 'error',
      code: 'asset-reference-missing',
      message: `${label}引用了不存在的素材“${assetId}”。`,
      ...location,
    })
    return
  }
  if (expectedKind && asset.kind !== expectedKind) {
    drafts.push({
      severity: 'error',
      code: 'asset-kind-mismatch',
      message: `${label}需要 ${expectedKind} 素材，但“${assetId}”实际是 ${asset.kind}。`,
      ...location,
    })
  }
}

function addComponentPropAssets(
  project: CourseProjectDocument,
  drafts: CourseProjectHealthFindingDraft[],
  referenced: Set<string>,
  manifest: ComponentManifest | undefined,
  props: Record<string, unknown>,
  location: AssetReferenceLocation,
): void {
  if (!manifest) return
  const effective = mergeComponentProps(manifest, props)
  for (const property of manifest.editor?.properties ?? []) {
    if (property.type !== 'image') continue
    const assetId = getComponentPropValue(effective, property.key)
    if (typeof assetId !== 'string' || !assetId) continue
    const explicit = getComponentPropValue(props, property.key) !== undefined
    addAssetCheck(
      project,
      drafts,
      referenced,
      assetId,
      'image',
      `组件图片属性“${property.label}”`,
      explicit
        ? { ...location, path: [...location.path, ...property.key.split('.')] }
        : {
            path: [
              'componentPackages',
              manifest.id,
              'manifest',
              'defaultProps',
              ...property.key.split('.'),
            ],
          },
      true,
    )
  }
}

function addLayerAssetChecks(
  project: CourseProjectDocument,
  drafts: CourseProjectHealthFindingDraft[],
  referenced: Set<string>,
  item: LayerItem,
  path: Array<string | number>,
  surfaceId: string | undefined,
  manifest: ComponentManifest | undefined,
): boolean {
  const common = {
    path,
    layerItemId: item.layerItemId,
    ...(surfaceId ? { surfaceId } : {}),
  }
  if (item.kind === 'native') {
    if (item.content.nativeType === 'image') {
      addAssetCheck(
        project,
        drafts,
        referenced,
        item.content.data.assetId,
        'image',
        '图片图层',
        { ...common, path: [...path, 'content', 'data', 'assetId'] },
        false,
      )
    } else if (item.content.nativeType === 'video') {
      addAssetCheck(
        project,
        drafts,
        referenced,
        item.content.data.assetId,
        'video',
        '视频图层',
        { ...common, path: [...path, 'content', 'data', 'assetId'] },
        false,
      )
      if (item.content.data.poster.mode === 'image') {
        addAssetCheck(
          project,
          drafts,
          referenced,
          item.content.data.poster.assetId,
          'image',
          '视频封面',
          { ...common, path: [...path, 'content', 'data', 'poster', 'assetId'] },
          false,
        )
      }
    }
    return false
  }
  if (item.kind === 'component') {
    if (!manifest) {
      drafts.push({
        severity: 'warning',
        code: 'asset-reference-analysis-incomplete',
        message: `组件“${item.component.packageId}@${item.component.version}”缺少可执行包上下文；素材引用分析已保守降级，删除不会因此放行。`,
        ...common,
        path: [...path, 'component'],
      })
    }
    addAssetCheck(
      project,
      drafts,
      referenced,
      item.staticFallbackAssetId,
      'image',
      '组件静态兜底',
      { ...common, path: [...path, 'staticFallbackAssetId'] },
      false,
    )
    addComponentPropAssets(project, drafts, referenced, manifest, item.props, {
      ...common,
      path: [...path, 'props'],
    })
    return true
  }
  Object.entries(item.runtime.assets).forEach(([key, binding]) => addAssetCheck(
    project,
    drafts,
    referenced,
    binding.assetId,
    undefined,
    '运行时素材绑定',
    { ...common, path: [...path, 'runtime', 'assets', key, 'assetId'] },
    false,
  ))
  addAssetCheck(
    project,
    drafts,
    referenced,
    item.runtime.staticFallback?.assetId,
    'image',
    '运行时静态兜底',
    { ...common, path: [...path, 'runtime', 'staticFallback', 'assetId'] },
    false,
  )
  return false
}

function mixedControllerTarget(
  project: CourseProjectDocument,
  action: Extract<TeacherControllerAction, { type: 'scene.go' }>,
): CourseProjectDocument['locations'][number] | undefined {
  return project.locations.find((location) => (
    location.id === action.sceneId
    || (location.kind === 'slide-scene' && location.sceneId === action.sceneId)
    || (location.kind === 'flow-block' && location.blockId === action.sceneId)
    || (location.kind === 'spatial-camera' && location.cameraFrameId === action.sceneId)
  ))
}

function addControllerChecks(
  project: CourseProjectDocument,
  drafts: CourseProjectHealthFindingDraft[],
  item: LayerItem,
  path: Array<string | number>,
  surfaceId: string | undefined,
  dataPath: Array<string | number> = [...path, 'content', 'data'],
): void {
  if (item.kind !== 'native' || item.content.nativeType !== 'teacher-controller') return
  item.content.data.buttons.forEach((button, index) => {
    if (button.action.type !== 'scene.go') return
    const action = button.action
    const target = mixedControllerTarget(project, action)
    const location = {
      path: [...dataPath, 'buttons', index, 'action'],
      layerItemId: item.layerItemId,
      ...(surfaceId ? { surfaceId } : {}),
    }
    if (!target) {
      drafts.push({
        severity: 'error',
        code: 'controller-scene-target-missing',
        message: `控制器按钮“${button.label}”指向了不存在的课程位置或内容“${button.action.sceneId}”。`,
        ...location,
      })
      return
    }
    if (!action.targetStateId || target.kind !== 'slide-scene') return
    const surface = project.surfaces.find((candidate) => candidate.id === target.surfaceId)
    const scene = surface?.type === 'slide'
      ? surface.scenes.find((candidate) => candidate.id === target.sceneId)
      : undefined
    if (scene?.presentation?.states.some((state) => state.id === action.targetStateId)) {
      return
    }
    drafts.push({
      severity: 'error',
      code: 'controller-state-target-missing',
      message: `控制器按钮“${button.label}”指向了 Slide 场景中不存在的状态“${action.targetStateId}”。`,
      ...location,
    })
  })
}

function presenterChecks(
  project: CourseProjectDocument,
  drafts: CourseProjectHealthFindingDraft[],
): void {
  const presenter = project.playback.presenter
  const presenterRules = [
    ...project.globalInteractions,
    ...slideScenes(project).flatMap(({ scene }) => scene.interactions),
  ].filter((rule) => rule.enabled && rule.trigger.type === 'presenter.command')
  const commandRules = new Set(presenterRules.map((rule) => (
    rule.trigger.type === 'presenter.command' ? rule.trigger.command : null
  )))
  if (!presenter.enabled && presenterRules.length > 0) {
    drafts.push({
      severity: 'warning',
      code: 'presenter-rules-disabled',
      message: `工程含有 ${presenterRules.length} 条演示命令规则，但翻页笔输入已关闭，这些规则不会由演示按键触发。`,
      path: ['playback', 'presenter', 'enabled'],
    })
  }
  if (presenter.enabled && presenter.strategy === 'authored-command') {
    ;(['next', 'previous'] as const).forEach((command) => {
      if (commandRules.has(command)) return
      drafts.push({
        severity: 'warning',
        code: 'presenter-command-unhandled',
        message: `翻页笔使用“作者命令”模式，但没有启用的“${command === 'next' ? '下一步' : '上一步'}”规则。`,
        path: ['playback', 'presenter', 'strategy'],
      })
    })
  }
  if (presenter.enabled && presenter.strategy === 'scene-navigation' && presenterRules.length > 0) {
    drafts.push({
      severity: 'info',
      code: 'presenter-rules-bypassed',
      message: '翻页笔当前使用“直接切换场景”模式，presenter.command 规则不会由翻页笔触发。',
      path: ['playback', 'presenter', 'strategy'],
    })
  }
  presenter.additionalBindings.forEach((binding, index) => {
    if (binding.key !== 'F5') return
    drafts.push({
      severity: 'warning',
      code: 'presenter-f5-browser-reserved',
      message: 'F5 通常由浏览器或系统用于刷新，发布环境可能先截获该按键。',
      path: ['playback', 'presenter', 'additionalBindings', index, 'key'],
    })
  })
}

function ruleAppliesInState(
  rule: SlideSceneDocument['interactions'][number],
  sceneId: string,
  stateId: string | undefined,
): boolean {
  return rule.enabled && rule.conditions.every((condition) => (
    condition.type === 'scene.in'
      ? condition.sceneIds.includes(sceneId)
      : condition.type === 'presentation.in'
        ? stateId !== undefined && condition.stateIds.includes(stateId)
        : true
  ))
}

function hasExecutableRuntimeAssetConsumer(project: CourseProjectDocument): boolean {
  for (const location of project.locations) {
    const surface = project.surfaces.find((candidate) => candidate.id === location.surfaceId)
    if (!surface) continue
    let stateIds: Array<string | null> = [null]
    if (surface.type === 'slide' && location.kind === 'slide-scene') {
      const scene = surface.scenes.find((candidate) => candidate.id === location.sceneId)
      if (scene?.presentation) {
        stateIds = scene.presentation.states.map((state) => state.id)
      }
    }
    for (const stateId of stateIds) {
      const composition = composeCourseProjectLocation({
        project,
        locationId: location.id,
        stateId,
      })
      if (composition.entries.some(({ item, mounted }) => (
        mounted && item.kind === 'runtime' && item.runtime.enabled
      ))) return true
    }
  }
  return false
}

function videoChecks(
  project: CourseProjectDocument,
  drafts: CourseProjectHealthFindingDraft[],
): void {
  const diagnostics = new Map<string, {
    code: 'video-click-interaction-conflict' | 'looping-video-ended-unreachable'
    item: LayerItem
    path: Array<string | number>
    ruleRefs: Set<SlideSceneDocument['interactions'][number]>
    contexts: Set<string>
  }>()
  slideScenes(project).forEach(({ surface, surfaceIndex, scene, sceneIndex }) => {
    const locations = project.locations.filter((location) => (
      location.kind === 'slide-scene'
      && location.surfaceId === surface.id
      && location.sceneId === scene.id
    ))
    const states = scene.presentation?.states.map((state) => ({
      id: state.id as string | undefined,
    })) ?? [{ id: undefined }]
    const rules = [...project.globalInteractions, ...scene.interactions]
    states.forEach((state) => {
      locations.forEach((location) => {
        const composition = composeCourseProjectLocation({
          project,
          locationId: location.id,
          stateId: state.id ?? null,
        })
        const items = new Map(composition.entries.map((entry) => [
          entry.item.layerItemId,
          entry,
        ]))
        rules.forEach((rule) => {
          if (!ruleAppliesInState(rule, scene.id, state.id)) return
          const trigger = rule.trigger
          if (trigger.type !== 'node.click' && trigger.type !== 'video.ended') return
          const entry = items.get(trigger.nodeId)
          const item = entry?.item
          if (
            !entry?.mounted
            || item?.kind !== 'native'
            || item.content.nativeType !== 'video'
          ) return
          const code = trigger.type === 'node.click'
            && (item.content.data.clickToToggle || item.content.data.showControls)
            ? 'video-click-interaction-conflict'
            : trigger.type === 'video.ended' && item.content.data.loop
              ? 'looping-video-ended-unreachable'
              : undefined
          if (!code) return
          const itemPath = courseProjectComposedLayerPath(
            project,
            surfaceIndex,
            sceneIndex,
            entry.source,
            item.layerItemId,
          )
          const key = JSON.stringify([code, itemPath])
          const current = diagnostics.get(key) ?? {
            code,
            item,
            path: itemPath,
            ruleRefs: new Set<SlideSceneDocument['interactions'][number]>(),
            contexts: new Set<string>(),
          }
          current.ruleRefs.add(rule)
          current.contexts.add(`${surface.id}:${scene.id}:${state.id ?? 'base'}:${location.id}`)
          diagnostics.set(key, current)
        })
      })
    })
  })
  diagnostics.forEach((diagnostic) => {
    drafts.push({
      severity: 'warning',
      code: diagnostic.code,
      message: diagnostic.code === 'video-click-interaction-conflict'
        ? `视频“${diagnostic.item.label}”在 ${diagnostic.contexts.size} 个位置/状态组合中启用了内置播放点击区，会覆盖该视频的 ${diagnostic.ruleRefs.size} 条元素单击规则。`
        : `视频“${diagnostic.item.label}”在 ${diagnostic.contexts.size} 个位置/状态组合中循环播放，因此其 ${diagnostic.ruleRefs.size} 条“视频播放结束”规则无法由自然播放到达。`,
      path: diagnostic.path,
      layerItemId: diagnostic.item.layerItemId,
    })
  })
}

function addFlowAssetChecks(
  project: CourseProjectDocument,
  drafts: CourseProjectHealthFindingDraft[],
  referenced: Set<string>,
  block: FlowBlock,
  path: Array<string | number>,
  surfaceId: string,
  manifest: ComponentManifest | undefined,
): boolean {
  if (block.type === 'media') {
    addAssetCheck(
      project,
      drafts,
      referenced,
      block.assetId,
      block.mediaKind,
      'Flow 媒体块',
      { path: [...path, 'assetId'], surfaceId },
      false,
    )
  } else if (block.type === 'component') {
    if (!manifest) {
      drafts.push({
        severity: 'warning',
        code: 'asset-reference-analysis-incomplete',
        message: `组件“${block.component.packageId}@${block.component.version}”缺少可执行包上下文；素材引用分析已保守降级，删除不会因此放行。`,
        path: [...path, 'component'],
        surfaceId,
      })
    }
    addAssetCheck(
      project,
      drafts,
      referenced,
      block.staticFallbackAssetId,
      'image',
      'Flow 组件静态兜底',
      { path: [...path, 'staticFallbackAssetId'], surfaceId },
      false,
    )
    addComponentPropAssets(project, drafts, referenced, manifest, block.props, {
      path: [...path, 'props'],
      surfaceId,
    })
    return true
  }
  return false
}

export function collectCourseProjectControllerMediaHealth(
  project: CourseProjectDocument,
  archiveFiles: CourseProjectHealthArchiveFiles,
): CourseProjectHealthFinding[] {
  const drafts: CourseProjectHealthFindingDraft[] = []
  const referenced = new Set<string>()
  const context = createCourseProjectHealthContext(project, archiveFiles)
  let hasExecutableAssetConsumer = false

  visitCourseLayerItems(project, ({ item, path, owner }) => {
    const surfaceId = 'surfaceId' in owner ? owner.surfaceId : undefined
    const manifest = item.kind === 'component'
      ? manifestFor(context, item.component.packageId, item.component.version)
      : undefined
    hasExecutableAssetConsumer = addLayerAssetChecks(
      project,
      drafts,
      referenced,
      item,
      path,
      surfaceId,
      manifest,
    ) || hasExecutableAssetConsumer
    addControllerChecks(project, drafts, item, path, surfaceId)
  })

  visitCourseFlowBlocks(project, ({ block, path, surfaceId }) => {
    const manifest = block.type === 'component'
      ? manifestFor(context, block.component.packageId, block.component.version)
      : undefined
    hasExecutableAssetConsumer = addFlowAssetChecks(
      project,
      drafts,
      referenced,
      block,
      path,
      surfaceId,
      manifest,
    ) || hasExecutableAssetConsumer
  })

  hasExecutableAssetConsumer = hasExecutableRuntimeAssetConsumer(project)
    || hasExecutableAssetConsumer

  addAssetCheck(
    project,
    drafts,
    referenced,
    project.backgroundAssetId,
    'image',
    '课程背景',
    { path: ['backgroundAssetId'] },
    false,
  )
  const surfaceBackgroundLabel: Record<CourseSurfaceDocument['type'], string> = {
    slide: '演示页容器背景',
    flow: 'Flow 背景',
    'spatial-2d': 'Spatial 背景',
  }
  project.surfaces.forEach((surface, surfaceIndex) => {
    addAssetCheck(
      project,
      drafts,
      referenced,
      surface.backgroundAssetId,
      'image',
      surfaceBackgroundLabel[surface.type],
      { path: ['surfaces', surfaceIndex, 'backgroundAssetId'], surfaceId: surface.id },
      false,
    )
  })

  slideScenes(project).forEach(({ scene, path, surface }) => {
    addAssetCheck(
      project,
      drafts,
      referenced,
      scene.backgroundAssetId,
      'image',
      'Slide 场景背景',
      { path: [...path, 'backgroundAssetId'], surfaceId: surface.id },
      false,
    )
    scene.presentation?.states.forEach((state, stateIndex) => {
      const statePath = [...path, 'presentation', 'states', stateIndex]
      addAssetCheck(
        project,
        drafts,
        referenced,
        state.backgroundAssetId,
        'image',
        'Slide 状态背景',
        { path: [...statePath, 'backgroundAssetId'], surfaceId: surface.id },
        false,
      )
      Object.entries(state.layerItemOverrides).forEach(([layerItemId, override]) => {
        const item = scene.layerItems.find((candidate) => candidate.layerItemId === layerItemId)
        if (!item) return
        const location = {
          path: [...statePath, 'layerItemOverrides', layerItemId],
          surfaceId: surface.id,
          layerItemId,
        }
        if (item.kind === 'native' && override.nativeData) {
          const effective = effectiveLayerItem(item, override)
          if (
            effective.kind === 'native'
            && effective.content.nativeType === 'teacher-controller'
            && Array.isArray(override.nativeData.buttons)
          ) {
            addControllerChecks(
              project,
              drafts,
              effective,
              location.path,
              surface.id,
              [...location.path, 'nativeData'],
            )
          }
          if (effective.kind === 'native' && effective.content.nativeType === 'image') {
            addAssetCheck(
              project,
              drafts,
              referenced,
              effective.content.data.assetId,
              'image',
              'Slide 状态图片覆盖',
              { ...location, path: [...location.path, 'nativeData', 'assetId'] },
              true,
            )
          } else if (effective.kind === 'native' && effective.content.nativeType === 'video') {
            addAssetCheck(
              project,
              drafts,
              referenced,
              effective.content.data.assetId,
              'video',
              'Slide 状态视频覆盖',
              { ...location, path: [...location.path, 'nativeData', 'assetId'] },
              true,
            )
            if (effective.content.data.poster.mode === 'image') {
              addAssetCheck(
                project,
                drafts,
                referenced,
                effective.content.data.poster.assetId,
                'image',
                'Slide 状态视频封面覆盖',
                { ...location, path: [...location.path, 'nativeData', 'poster', 'assetId'] },
                true,
              )
            }
          }
        } else if (item.kind === 'component' && override.componentProps) {
          const manifest = manifestFor(
            context,
            item.component.packageId,
            item.component.version,
          )
          if (!manifest) {
            drafts.push({
              severity: 'warning',
              code: 'asset-reference-analysis-incomplete',
              message: `组件“${item.component.packageId}@${item.component.version}”缺少可执行包上下文；素材引用分析已保守降级，删除不会因此放行。`,
              ...location,
              path: [...location.path, 'componentProps'],
            })
          }
          addComponentPropAssets(
            project,
            drafts,
            referenced,
            manifest,
            mergeCourseProjectHealthProps(item.props, override.componentProps),
            { ...location, path: [...location.path, 'componentProps'] },
          )
        }
      })
    })
  })

  Object.entries(project.media.audio.sounds).forEach(([soundKey, sound]) => {
    if (sound.id !== soundKey) {
      drafts.push({
        severity: 'error',
        code: 'sound-id-mismatch',
        message: `声音记录键“${soundKey}”与内部 ID“${sound.id}”不一致。`,
        path: ['media', 'audio', 'sounds', soundKey, 'id'],
      })
    }
    addAssetCheck(
      project,
      drafts,
      referenced,
      sound.assetId,
      'audio',
      `声音“${sound.name}”`,
      { path: ['media', 'audio', 'sounds', soundKey, 'assetId'] },
      false,
    )
  })

  if (!hasExecutableAssetConsumer) {
    Object.entries(project.assets).forEach(([assetKey, asset]) => {
      if (referenced.has(asset.id)) return
      drafts.push({
        severity: 'info',
        code: 'asset-unused',
        message: `素材“${asset.filename}”当前没有任何可枚举的 V9 工程引用（${asset.byteLength} 字节）。`,
        path: ['assets', assetKey],
      })
    })
  }

  const hasVisibleController = hasCourseDeliveryVisibleTeacherController(project)
  if (project.playback.controls === 'canvas' && !hasVisibleController) {
    drafts.push({
      severity: 'error',
      code: 'controller-required-for-canvas',
      message: '成品已启用画布控制，但没有任何交付时可见的全局教师控制器。',
      path: ['playback', 'controls'],
    })
  }
  if (project.playback.controls === 'none' && hasVisibleController) {
    drafts.push({
      severity: 'error',
      code: 'controller-visible-while-disabled',
      message: '成品设置为不显示控制器，但全局层仍有交付时可见的教师控制器。',
      path: ['playback', 'controls'],
    })
  }
  presenterChecks(project, drafts)
  videoChecks(project, drafts)
  return finalizeCourseProjectHealthFindings(project, drafts)
}
