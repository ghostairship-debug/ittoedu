import {
  Box,
  Globe2,
  SlidersHorizontal,
} from 'lucide-react'
import { nanoid } from 'nanoid'
import { useEffect, useState } from 'react'
import type {
  TeacherControllerAction,
  TeacherControllerNode,
} from '../../../shared/contracts/native-v1'
import type { ProjectPlaybackSettings } from '../../../shared/contracts/playback-v1'
import type { ProjectDesignTokens } from '../../../shared/contracts/design-v1/types'
import type { RuntimeLayer } from '../../../shared/runtimeTypes'
import type { LocationVisibility } from '../../../shared/courseProjectTypes'
import {
  opacityToTransparencyPercent,
  transparencyPercentToOpacity,
} from '../../../shared/opacity'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { ComponentManifest } from '../../../shared/componentTypes'
import type { EffectiveBackground } from '../../../shared/effectiveBackground'
import { ColorInput } from '../ColorInput'
import { ComponentPropertiesEditor } from '../ComponentPropertiesEditor'
import { DesignTokensEditor } from '../DesignTokensEditor'
import {
  InteractionEditor,
  type InteractionEditorProps,
} from '../InteractionEditor'
import { PresenterSettingsEditor } from '../PresenterSettingsEditor'
import { RuntimePropertiesPanel, type RuntimePropertiesContext } from './RuntimePropertiesPanel'
import {
  SharedBackgroundProperties,
  type SharedBackgroundImportFile,
} from './SharedBackgroundProperties'
import {
  BufferedInput,
  PropertyDraftBoundary,
  RangeField,
  SelectField,
  ToggleRow,
} from './PropertyControls'
import {
  CommonNodeProperties,
  SlideNativeNotices,
  SlideNativeTypeFields,
  type EditorModeView,
  type PropertiesItemView,
  type PropertiesPatch,
  type SlideNativeNoticesView,
  type SlideNativeTextCommands,
} from './SlideNativePropertiesPanel'
import { FlowSpatialInteractionUnavailableSection } from './FlowSpatialInteractionUnavailableSection'

export interface CourseGlobalLocationView {
  readonly id: string
  readonly label: string
}

export interface CourseGlobalLayerView {
  readonly nodeId: string
  readonly visibleHere: boolean
  readonly visibility: LocationVisibility
  readonly scenePlane: RuntimeLayer
  readonly isController: boolean
  readonly locationKind: string | undefined
  readonly locations: readonly CourseGlobalLocationView[]
}

export interface CourseGlobalEmptyView {
  readonly globalLayerCount: number
  readonly underlayCount: number
  readonly overlayCount: number
  readonly runtimeAvailable: boolean
  readonly playback: ProjectPlaybackSettings | undefined
  readonly hasTeacherController: boolean
  readonly designTokens: ProjectDesignTokens | null
  readonly background: {
    readonly color: string | undefined
    readonly assetId: string | null | undefined
    readonly effective: EffectiveBackground
    readonly assets: Readonly<Record<string, AssetMeta>>
  }
}

export interface TeacherControllerLayoutPreviewView {
  readonly width: number
  readonly height: number
  readonly buttons: readonly { readonly label: string }[]
}

export interface TeacherControllerSceneView {
  readonly id: string
  readonly name: string
  readonly presentation?: {
    readonly states?: ReadonlyArray<{ readonly id: string; readonly name: string }>
  }
}

export interface CourseGlobalPropertiesContext {
  readonly kind: 'course-global'
  readonly draftBindingKey: string | null
  readonly mode: 'empty' | 'selected'
  readonly editorMode: EditorModeView
  readonly disabledReason: string | null
  readonly empty: CourseGlobalEmptyView | null
  readonly layer: CourseGlobalLayerView | null
  readonly selected: {
    readonly view: PropertiesItemView
    readonly notices: SlideNativeNoticesView
    readonly contentEditingEnabled: boolean
    readonly spatialMode: boolean
    readonly videoDiagnostics: readonly string[]
    readonly controller: TeacherControllerNode | null
    readonly controllerPreview: TeacherControllerLayoutPreviewView | null
    readonly controllerScenes: readonly TeacherControllerSceneView[]
    readonly component: {
      readonly manifest: ComponentManifest
      readonly assets: Readonly<Record<string, AssetMeta>>
    } | null
  } | null
  readonly runtime: RuntimePropertiesContext | null
  readonly interaction: InteractionEditorProps | null
  readonly flowOrSpatial: boolean
  readonly editingScopeGlobal: boolean
  readonly commands: {
    readonly patch: (patch: PropertiesPatch) => void
    readonly replaceImage: () => void
    readonly clearPresentationOverride: () => void
    readonly updateCourseBackground: (patch: { backgroundColor?: string; backgroundAssetId?: string | null }) => void
    readonly previewCourseBackground?: (patch: { backgroundColor?: string | null }) => void
    readonly updatePlayback: (patch: Partial<ProjectPlaybackSettings>) => void
    readonly ensureTeacherController: () => void
    readonly updateDesignTokens: (tokens: ProjectDesignTokens) => void
    readonly setVisibleAtLocation: (nodeId: string, visible: boolean) => void
    readonly setLocationVisibility: (nodeId: string, visibility: LocationVisibility) => void
    readonly updateLayerSettings: (nodeId: string, patch: { layer: RuntimeLayer }) => void
    readonly openProfessionalAutomation: () => void
    readonly text: SlideNativeTextCommands
  }
  readonly onFeedback: (feedback: { kind: 'error' | 'status'; message: string }) => void
}

function candidateGlobalVisibilityCopy(kind: string | undefined) {
  if (kind === 'slide-scene') {
    return {
      rangeLabel: '场景可见范围',
      all: '全部场景',
      include: '仅所选场景',
      exclude: '除所选场景外',
      pendingHint: '选择至少一个场景后，可见范围才会生效。',
    }
  }
  return {
    rangeLabel: '页面可见范围',
    all: '全部页面',
    include: '仅所选页面',
    exclude: '除所选页面外',
    pendingHint: '选择至少一个页面后，可见范围才会生效。',
  }
}

function GlobalLayerSettings({
  view,
  commands,
}: {
  view: CourseGlobalLayerView
  commands: CourseGlobalPropertiesContext['commands']
}) {
  const [pendingVisibilityMode, setPendingVisibilityMode] = useState<
    Exclude<LocationVisibility['mode'], 'all'> | null
  >(null)
  useEffect(() => {
    setPendingVisibilityMode(null)
  }, [view.nodeId, view.visibility.mode])

  const setVisibility = (visibility: LocationVisibility) => {
    commands.setLocationVisibility(view.nodeId, visibility)
  }
  const effectiveVisibilityMode = pendingVisibilityMode ?? view.visibility.mode
  const selected = new Set(
    pendingVisibilityMode === null ? view.visibility.locationIds : [],
  )
  const visibilityCopy = candidateGlobalVisibilityCopy(view.locationKind)

  return (
    <section
      className="property-section global-component-settings"
      data-testid="global-layer-settings"
    >
      <h3 className="property-title"><Globe2 size={14} />全局挂载</h3>
      <ToggleRow
        label="当前页显示"
        checked={view.visibleHere}
        onChange={(visible) => commands.setVisibleAtLocation(view.nodeId, visible)}
      />
      <SelectField<RuntimeLayer>
        label="图层位置"
        value={view.scenePlane}
        options={view.isController
          ? [{ value: 'overlay', label: 'Overlay · 固定在内容上方' }]
          : [
              { value: 'underlay', label: 'Underlay · 场景内容下方' },
              { value: 'overlay', label: 'Overlay · 场景内容上方' },
            ]}
        disabled={view.isController}
        onChange={(layer) => commands.updateLayerSettings(view.nodeId, { layer })}
      />
      <SelectField<LocationVisibility['mode']>
        label={visibilityCopy.rangeLabel}
        value={effectiveVisibilityMode}
        options={[
          { value: 'all', label: visibilityCopy.all },
          { value: 'include', label: visibilityCopy.include },
          { value: 'exclude', label: visibilityCopy.exclude },
        ]}
        onChange={(mode) => {
          if (mode === 'all') {
            setPendingVisibilityMode(null)
            setVisibility({ mode, locationIds: [] })
            return
          }
          const startsEmpty = view.visibility.mode === 'all' ||
            view.visibility.locationIds.length === 0
          if (startsEmpty) {
            setPendingVisibilityMode(mode)
            return
          }
          setPendingVisibilityMode(null)
          setVisibility({ mode, locationIds: view.visibility.locationIds })
        }}
      />
      {effectiveVisibilityMode !== 'all' && (
        <fieldset className="visibility-scene-list">
          <legend>
            {effectiveVisibilityMode === 'include' ? '显示于' : '隐藏于'}
          </legend>
          {view.locations.map((location) => (
            <label key={location.id}>
              <input
                type="checkbox"
                data-testid={`location-visibility-${location.id}`}
                checked={selected.has(location.id)}
                onChange={(event) => {
                  const locationIds = new Set(
                    pendingVisibilityMode === null
                      ? view.visibility.locationIds
                      : [],
                  )
                  if (event.currentTarget.checked) locationIds.add(location.id)
                  else locationIds.delete(location.id)
                  if (locationIds.size === 0) {
                    if (effectiveVisibilityMode === 'exclude') {
                      setPendingVisibilityMode(null)
                      setVisibility({ mode: 'all', locationIds: [] })
                    } else {
                      event.currentTarget.checked = true
                    }
                    return
                  }
                  setPendingVisibilityMode(null)
                  setVisibility({
                    mode: effectiveVisibilityMode,
                    locationIds: [...locationIds],
                  })
                }}
              />
              <span>{location.label}</span>
            </label>
          ))}
        </fieldset>
      )}
      {pendingVisibilityMode !== null && (
        <p className="property-hint" role="status">
          {visibilityCopy.pendingHint}
        </p>
      )}
      <p className="property-hint">
        全局元素只创建一次并跨页面持续存在；切换页面只更新显隐，不会改课程顺序或当前页。
      </p>
    </section>
  )
}

const TEACHER_CONTROLLER_ACTION_OPTIONS: Array<{
  value: TeacherControllerAction['type']
  label: string
}> = [
  { value: 'scene.previous', label: '上一场景' },
  { value: 'scene.next', label: '下一场景' },
  { value: 'scene.replay', label: '重播当前场景' },
  { value: 'course.restart', label: '重新开始课程' },
  { value: 'scene.open-picker', label: '打开场景目录' },
  { value: 'scene.go', label: '跳转到指定场景（高级）' },
  { value: 'audio.toggle-mute', label: '切换静音' },
  { value: 'player.fullscreen.toggle', label: '切换全屏' },
]

function defaultTeacherControllerAction(
  type: TeacherControllerAction['type'],
  scenes: ReadonlyArray<{ id: string; name: string }>,
): TeacherControllerAction {
  return type === 'scene.go'
    ? { type, sceneId: scenes[0]?.id ?? '' }
    : { type } as TeacherControllerAction
}

function TeacherControllerProperties({
  node,
  scenes,
  layoutPreview,
  update,
}: {
  node: TeacherControllerNode
  scenes: readonly TeacherControllerSceneView[]
  layoutPreview: TeacherControllerLayoutPreviewView | null
  update(patch: PropertiesPatch): void
}) {
  const replaceButton = (
    index: number,
    patch: Partial<TeacherControllerNode['buttons'][number]>,
  ) => update({
    buttons: node.buttons.map((button, buttonIndex) => (
      buttonIndex === index ? { ...button, ...patch } : button
    )),
  })
  const moveButton = (index: number, offset: -1 | 1) => {
    const target = index + offset
    if (target < 0 || target >= node.buttons.length) return
    const buttons = [...node.buttons]
    ;[buttons[index], buttons[target]] = [buttons[target]!, buttons[index]!]
    update({ buttons })
  }
  return (
    <section className="property-section">
      <h3 className="property-title"><SlidersHorizontal size={14} />教师控制器</h3>
      {layoutPreview ? (
        <div
          className="controller-layout-preview"
          data-testid="teacher-controller-layout-preview"
        >
          <div className="readonly-value">
            {layoutPreview.width} × {layoutPreview.height}
          </div>
          <p className="property-hint">
            {layoutPreview.buttons.map((button) => button.label).join(' · ')}
          </p>
        </div>
      ) : null}
      <BufferedInput label="控制器标题" value={node.title} onCommit={(title) => update({ title })} />
      <ToggleRow label="显示场景与状态进度" checked={node.showSceneProgress} onChange={(showSceneProgress) => update({ showSceneProgress })} />
      <ToggleRow label="紧凑布局" checked={node.compact} onChange={(compact) => update({ compact })} />
      <ToggleRow label="允许折叠" checked={node.collapsible} onChange={(collapsible) => update({
        collapsible,
        ...(!collapsible ? { defaultCollapsed: false } : {}),
      })} />
      <ToggleRow
        label="打开课件时默认折叠"
        checked={node.defaultCollapsed}
        disabled={!node.collapsible}
        onChange={(defaultCollapsed) => update({ defaultCollapsed })}
      />
      <ColorInput id="controller-background" label="背景色" value={node.style.backgroundColor} onChange={(backgroundColor) => update({ style: { backgroundColor } })} />
      <RangeField
        label="背景透明度"
        value={opacityToTransparencyPercent(node.style.backgroundOpacity)}
        min={0}
        max={100}
        suffix="%"
        onChange={(value) => update({
          style: { backgroundOpacity: transparencyPercentToOpacity(value) },
        })}
      />
      <ColorInput id="controller-accent" label="强调色" value={node.style.accentColor} onChange={(accentColor) => update({ style: { accentColor } })} />
      <ColorInput id="controller-text" label="文字色" value={node.style.textColor} onChange={(textColor) => update({ style: { textColor } })} />
      <RangeField label="圆角" value={node.style.cornerRadius} min={0} max={40} suffix="px" onChange={(cornerRadius) => update({ style: { cornerRadius } })} />
      <div className="form-field">
        <label>控制按钮</label>
        <div className="controller-button-editor">
          {node.buttons.map((button, index) => {
            const sceneAction = button.action.type === 'scene.go'
              ? button.action
              : undefined
            const targetScene = sceneAction
              ? scenes.find((scene) => scene.id === sceneAction.sceneId)
              : undefined
            return (
            <fieldset
              className="controller-button-row"
              key={button.id}
              style={{ display: 'grid', gap: 8, padding: 8, margin: '0 0 8px' }}
            >
              <legend>{`按钮 ${index + 1}`}</legend>
              <input
                aria-label={`${button.label}显示`}
                type="checkbox"
                checked={button.visible}
                onChange={(event) => replaceButton(index, {
                  visible: event.currentTarget.checked,
                })}
              />
              <BufferedInput
                label="按钮文字"
                value={button.label}
                onCommit={(label) => replaceButton(index, { label: String(label) })}
              />
              <SelectField<TeacherControllerAction['type']>
                label="点击动作"
                value={button.action.type}
                options={TEACHER_CONTROLLER_ACTION_OPTIONS}
                onChange={(type) => replaceButton(index, {
                  action: defaultTeacherControllerAction(type, scenes),
                })}
              />
              {button.action.type === 'scene.open-picker' ? (
                <p className="property-hint">
                  播放时展开全部场景；选择后进入该场景的初始状态，无需绑定目标场景或状态。
                </p>
              ) : null}
              {sceneAction ? (
                <>
                  <SelectField<string>
                    label="目标场景"
                    value={sceneAction.sceneId}
                    options={scenes.map((scene) => ({
                      value: scene.id,
                      label: scene.name,
                    }))}
                    onChange={(sceneId) => replaceButton(index, {
                      action: { type: 'scene.go', sceneId },
                    })}
                  />
                  <SelectField<string>
                    label="进入状态"
                    value={sceneAction.targetStateId ?? ''}
                    options={[
                      { value: '', label: '场景初始状态' },
                      ...(targetScene?.presentation?.states ?? []).map((state) => ({
                        value: state.id,
                        label: state.name,
                      })),
                    ]}
                    onChange={(targetStateId) => replaceButton(index, {
                      action: targetStateId
                        ? { ...sceneAction, targetStateId }
                        : { type: 'scene.go', sceneId: sceneAction.sceneId },
                    })}
                  />
                </>
              ) : null}
              <div className="button-row">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={index === 0}
                  onClick={() => moveButton(index, -1)}
                >上移</button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={index === node.buttons.length - 1}
                  onClick={() => moveButton(index, 1)}
                >下移</button>
                <button
                  type="button"
                  className="secondary-button secondary-button--danger"
                  disabled={node.buttons.length <= 1}
                  onClick={() => update({
                    buttons: node.buttons.filter((_, buttonIndex) => buttonIndex !== index),
                  })}
                >删除</button>
              </div>
            </fieldset>
          )})}
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={node.buttons.length >= 12}
          onClick={() => update({
            buttons: [
              ...node.buttons,
              {
                id: `teacher_button_${nanoid()}`,
                label: '场景目录',
                visible: true,
                action: defaultTeacherControllerAction('scene.open-picker', scenes),
              },
            ],
          })}
        >添加按钮（{node.buttons.length}/12）</button>
      </div>
      <ToggleRow label="包含在 PDF/PPTX" checked={node.includeInStaticExports} onChange={(includeInStaticExports) => update({ includeInStaticExports })} />
      <p className="property-hint">该元素属于画布全局层。开启折叠后，可直接点击画布中的“收/展”按钮临时预览，该临时状态不写入工程。</p>
    </section>
  )
}

function CourseGlobalEmptyPanel({
  context,
}: {
  context: CourseGlobalPropertiesContext
}) {
  const empty = context.empty
  if (!empty) return null
  const { commands, editorMode, runtime } = context
  return (
    <>
      <section className="property-section global-layer-summary">
        <h3 className="property-title"><Globe2 size={14} />全局层</h3>
        <div className="runtime-summary-grid" aria-label="全局层摘要">
          <span><small>全局元素</small>{empty.globalLayerCount}</span>
          <span><small>Underlay</small>{empty.underlayCount}</span>
          <span><small>Overlay</small>{empty.overlayCount}</span>
          <span><small>运行时</small>{empty.runtimeAvailable ? '已配置' : '无'}</span>
        </div>
        <p className="property-hint">
          全局层类似课件母版：文字、图片、图形和组件都可统一布置，并可设置场景可见范围。
        </p>
      </section>
      <SharedBackgroundProperties
        ownerLabel="课程"
        color={empty.background.color}
        assetId={empty.background.assetId}
        assets={empty.background.assets}
        effective={empty.background.effective}
        onColorChange={(backgroundColor) => commands.updateCourseBackground({ backgroundColor })}
        onPreviewColorChange={commands.previewCourseBackground ? (backgroundColor) => commands.previewCourseBackground!({ backgroundColor }) : undefined}
        onAssetChange={(backgroundAssetId) => commands.updateCourseBackground({ backgroundAssetId })}
        testId="course-background-properties"
      />
      <section className="property-section">
        <h3 className="property-title"><SlidersHorizontal size={14} />成品控制</h3>
        <SelectField<ProjectPlaybackSettings['controls']>
          label="导航控制方式"
          value={empty.playback?.controls ?? 'none'}
          options={[
            { value: 'canvas', label: '画布内全局控制器（推荐）' },
            { value: 'none', label: '不显示控制器' },
          ]}
          onChange={(controls) => {
            if (controls === 'canvas') commands.ensureTeacherController()
            else commands.updatePlayback({ controls })
          }}
        />
        <p className="property-hint">
          选择“不显示控制器”会保留可编辑节点，但在交付播放时将其初始隐藏。
        </p>
        {empty.playback?.controls === 'none' && empty.hasTeacherController && (
          <div
            className="property-hint"
            data-testid="controller-consistency-notice"
            role="status"
          >
            画布教师控制器已从成品中隐藏。如果需要恢复，请使用下方按钮一键修复其可见性与控制模式。
          </div>
        )}
        <ToggleRow
          label="键盘左右键翻页"
          checked={empty.playback?.keyboardNavigation ?? true}
          onChange={(keyboardNavigation) => commands.updatePlayback({ keyboardNavigation })}
        />
        {empty.playback ? (
          <PresenterSettingsEditor
            value={empty.playback.presenter}
            onChange={(presenter) => commands.updatePlayback({ presenter })}
          />
        ) : null}
        <button type="button" className="secondary-button" onClick={commands.ensureTeacherController}>
          <SlidersHorizontal size={14} />{empty.playback?.controls === 'none'
            ? '恢复并显示教师控制器'
            : '添加或定位教师控制器'}
        </button>
      </section>
      {editorMode === 'professional' && empty.designTokens && (
        <DesignTokensEditor
          value={empty.designTokens}
          onChange={commands.updateDesignTokens}
        />
      )}
      {editorMode === 'professional' && runtime && (
        <RuntimePropertiesPanel context={runtime} />
      )}
    </>
  )
}

export function CourseGlobalPropertiesPanel({
  context,
}: {
  context: CourseGlobalPropertiesContext
}) {
  if (context.mode === 'empty') {
    return (
      <div className="properties-scroll" data-testid="properties-tab">
        <CourseGlobalEmptyPanel context={context} />
      </div>
    )
  }
  const selected = context.selected
  const layer = context.layer
  if (!selected) {
    return (
      <div className="properties-scroll" data-testid="properties-tab">
        <p className="property-empty">{context.disabledReason ?? '所选全局元素已失效，请重新选择。'}</p>
      </div>
    )
  }
  const node = selected.view
  const update = context.commands.patch
  return (
    <PropertyDraftBoundary
      bindingKey={context.draftBindingKey ?? 'global-property-target-unavailable'}
      onStale={() => context.onFeedback({
        kind: 'error',
        message: '属性草稿对应的编辑目标已经改变，请按 Esc 放弃草稿后重试。',
      })}
    >
      <div className="properties-scroll" data-testid="properties-tab">
      <SlideNativeNotices
        notices={selected.notices}
        onClearPresentationOverride={context.commands.clearPresentationOverride}
      />
      <CommonNodeProperties
        node={node}
        editorMode={context.editorMode}
        update={update}
      />
      {layer && (
        <GlobalLayerSettings view={layer} commands={context.commands} />
      )}
      <SlideNativeTypeFields
        node={node}
        update={update}
        contentEditingEnabled={selected.contentEditingEnabled}
        spatialMode={selected.spatialMode}
        videoDiagnostics={selected.videoDiagnostics}
        onReplaceImage={context.commands.replaceImage}
        textCommands={context.commands.text}
        draftBindingKey={context.draftBindingKey ?? 'global-property-target-unavailable'}
        tableCommands={null}
        chartCommands={null}
      />
      {context.editorMode === 'professional' &&
        context.flowOrSpatial &&
        node.type !== 'teacher-controller' && (
        <FlowSpatialInteractionUnavailableSection
          editingScopeGlobal={context.editingScopeGlobal}
          onOpenAutomation={context.commands.openProfessionalAutomation}
        />
      )}
      {context.interaction && node.type !== 'teacher-controller' && (
        <InteractionEditor {...context.interaction} />
      )}
      {node.type === 'external-component' && (
        <>
          <section className="property-section">
            <h3 className="property-title"><Box size={14} />外部组件</h3>
            <div className="form-field"><label>组件名称</label><div className="readonly-value">{selected.component?.manifest.name ?? node.name}</div></div>
            <div className="form-field"><label>组件 ID</label><div className="readonly-value">{node.component.packageId}</div></div>
            <div className="form-field"><label>版本</label><div className="readonly-value">{node.component.version}</div></div>
          </section>
          {selected.component && (
            <ComponentPropertiesEditor
              manifest={selected.component.manifest}
              node={node}
              assets={selected.component.assets}
              onChange={(props) => update({ props })}
            />
          )}
        </>
      )}
      {selected.controller && (
        <TeacherControllerProperties
          node={selected.controller}
          scenes={selected.controllerScenes}
          layoutPreview={selected.controllerPreview}
          update={update}
        />
      )}
      </div>
    </PropertyDraftBoundary>
  )
}
