import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type {
  LayerItem,
  SpatialCameraFrame,
  SpatialCameraPose,
  SpatialPathDocument,
  SpatialSemanticZoomRule,
} from '../../shared/courseProjectTypes'
import { BufferedInput, PropertyDraftBoundary } from './properties/PropertyControls'

const EMPTY_DRAFT_BINDINGS: ReadonlyMap<string, string> = new Map()

export interface SpatialCameraPanelProps {
  readonly surfaceTitle: string
  readonly frames: readonly SpatialCameraFrame[]
  readonly home: SpatialCameraPose
  readonly sessionCamera: SpatialCameraPose | null
  readonly activeCameraFrameId: string | null
  readonly showCameraFrames: boolean
  readonly worldLayerItems: readonly LayerItem[]
  readonly paths?: readonly SpatialPathDocument[]
  readonly playbackPathId?: string | null
  readonly semanticZoomRules: readonly SpatialSemanticZoomRule[]
  readonly disabled?: boolean
  readonly sessionCameraLabel?: string
  readonly disabledReason?: string
  readonly draftBindingKey?: string
  readonly frameDraftBindings?: ReadonlyMap<string, string>
  readonly semanticRuleDraftBindings?: ReadonlyMap<string, string>
  readonly onDraftStale?: () => void
  readonly onShowCameraFramesChange: (show: boolean) => void
  readonly onAddFrame: () => void
  readonly onRenameFrame: (frameId: string, name: string) => void
  readonly onReorderFrame: (frameId: string, toIndex: number) => void
  readonly onDeleteFrame: (frameId: string) => void
  readonly onSetHome: () => void
  readonly onUpdateActiveFromSession?: () => void
  readonly onActivateFrame: (frameId: string) => void
  readonly onFitWorldContent?: () => void
  readonly onPlaybackPathIdChange?: (pathId: string | null) => void
  readonly onAddSemanticZoomRule: (rule: {
    layerItemIds: string[]
    minZoom: number
    maxZoom: number
    visible: boolean
  }) => void
  readonly onUpdateSemanticZoomRule: (
    ruleId: string,
    patch: Partial<Omit<SpatialSemanticZoomRule, 'id'>>,
  ) => void
  readonly onDeleteSemanticZoomRule: (ruleId: string) => void
}

/**
 * Lightweight camera / semantic-zoom section. R5-Z must mount this *inside*
 * Properties as a page-level segment. Do not import into App / RightSidebar
 * as a replacement for element Properties.
 */
export function SpatialCameraPanel({
  surfaceTitle,
  frames,
  home,
  sessionCamera,
  activeCameraFrameId,
  showCameraFrames,
  worldLayerItems,
  paths = [],
  playbackPathId = null,
  semanticZoomRules,
  disabled = false,
  sessionCameraLabel,
  disabledReason,
  draftBindingKey = 'spatial-camera-unbound',
  frameDraftBindings = EMPTY_DRAFT_BINDINGS,
  semanticRuleDraftBindings = EMPTY_DRAFT_BINDINGS,
  onDraftStale = () => undefined,
  onShowCameraFramesChange,
  onAddFrame,
  onRenameFrame,
  onReorderFrame,
  onDeleteFrame,
  onSetHome,
  onUpdateActiveFromSession,
  onActivateFrame,
  onFitWorldContent,
  onPlaybackPathIdChange,
  onAddSemanticZoomRule,
  onUpdateSemanticZoomRule,
  onDeleteSemanticZoomRule,
}: SpatialCameraPanelProps) {
  const [editingFrameId, setEditingFrameId] = useState<string | null>(null)
  const [ruleLayerItemIds, setRuleLayerItemIds] = useState<string[]>([])
  const [ruleMinZoom, setRuleMinZoom] = useState('0')
  const [ruleMaxZoom, setRuleMaxZoom] = useState('1')
  const [ruleVisible, setRuleVisible] = useState(true)

  useEffect(() => {
    setRuleLayerItemIds([])
    setRuleMinZoom('0')
    setRuleMaxZoom('1')
    setRuleVisible(true)
  }, [draftBindingKey])

  const layerLabel = (layerItemId: string): string => (
    worldLayerItems.find((candidate) => candidate.layerItemId === layerItemId)?.label || layerItemId
  )

  const parsedRuleMinZoom = Number(ruleMinZoom)
  const parsedRuleMaxZoom = Number(ruleMaxZoom)
  const canAddRule = ruleLayerItemIds.length > 0
    && Number.isFinite(parsedRuleMinZoom)
    && Number.isFinite(parsedRuleMaxZoom)
    && parsedRuleMinZoom >= 0
    && parsedRuleMaxZoom > 0
    && parsedRuleMinZoom < parsedRuleMaxZoom

  const moveFrameToward = (frameId: string, direction: -1 | 1) => {
    const orderedIds = frames.map((frame) => frame.id)
    const fromIndex = orderedIds.indexOf(frameId)
    const neighborId = fromIndex >= 0 ? orderedIds[fromIndex + direction] : undefined
    if (fromIndex < 0 || !neighborId) return
    const toIndex = orderedIds.indexOf(neighborId)
    if (toIndex < 0) return
    onReorderFrame(frameId, toIndex)
  }

  return (
    <section className="property-section" aria-label="镜头调度">
      <h3 className="property-title">镜头调度</h3>
      <p className="property-hint">
        「{surfaceTitle}」的工程镜头会随课程保存；画面平移和缩放只在本次编辑中生效，不会写入课程。
      </p>
      {sessionCameraLabel && (
        <p className="property-hint">当前会话画面：{sessionCameraLabel}</p>
      )}
      {disabled && disabledReason && (
        <p className="property-hint" role="status">{disabledReason}</p>
      )}

      <label className="property-hint">
        <input
          type="checkbox"
          aria-label="显示镜头框"
          disabled={disabled}
          checked={showCameraFrames}
          onChange={(event) => onShowCameraFramesChange(event.currentTarget.checked)}
        />
        显示镜头框（仅本次编辑，不写入课程）
      </label>

      <div className="form-field">
        <label htmlFor="spatial-playback-path">播放路径</label>
        <select
          id="spatial-playback-path"
          className="form-input"
          aria-label="播放路径"
          disabled={disabled || !onPlaybackPathIdChange}
          value={playbackPathId ?? ''}
          onChange={(event) => onPlaybackPathIdChange?.(event.currentTarget.value || null)}
        >
          <option value="">按镜头顺序</option>
          {paths.map((path) => (
            <option value={path.id} key={path.id}>{path.name}</option>
          ))}
        </select>
      </div>

      <button
        type="button"
        className="secondary-button"
        disabled={disabled || !sessionCamera}
        onClick={onAddFrame}
      >
        <Plus size={14} />从当前画面添加镜头
      </button>
      {onUpdateActiveFromSession && (
        <button
          type="button"
          className="secondary-button"
          disabled={disabled || !sessionCamera || !activeCameraFrameId}
          onClick={onUpdateActiveFromSession}
        >
          从当前画面更新此镜头
        </button>
      )}
      {onFitWorldContent && (
        <button
          type="button"
          className="secondary-button"
          disabled={disabled}
          onClick={onFitWorldContent}
        >
          适配全部内容
        </button>
      )}

      {frames.map((frame) => (
        <div className="form-field" key={frame.id} data-frame-id={frame.id}>
          {editingFrameId === frame.id ? (
            <PropertyDraftBoundary
              bindingKey={frameDraftBindings.get(frame.id) ?? draftBindingKey}
              onStale={onDraftStale}
            >
              <BufferedInput
                label={`重命名镜头 ${frame.name}`}
                disabled={disabled}
                value={frame.name}
                onCommit={(name) => {
                  onRenameFrame(frame.id, name)
                  setEditingFrameId(null)
                }}
              />
            </PropertyDraftBoundary>
          ) : (
            <button
              type="button"
              className="secondary-button"
              disabled={disabled}
              onClick={() => onActivateFrame(frame.id)}
            >
              {activeCameraFrameId === frame.id ? '当前 · ' : ''}{frame.name}
            </button>
          )}
          <p className="property-hint">
            x {Math.round(frame.x)} y {Math.round(frame.y)} · {Math.round(frame.zoom * 100)}%
          </p>
          <button
            type="button"
            className="secondary-button"
            disabled={disabled}
            aria-label={`重命名镜头 ${frame.name}`}
            onClick={() => setEditingFrameId(frame.id)}
          >
            重命名
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={disabled || frame.id === frames[0]?.id}
            aria-label={`上移镜头 ${frame.name}`}
            onClick={() => moveFrameToward(frame.id, -1)}
          >
            上移
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={disabled || frame.id === frames[frames.length - 1]?.id}
            aria-label={`下移镜头 ${frame.name}`}
            onClick={() => moveFrameToward(frame.id, 1)}
          >
            下移
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={disabled || !sessionCamera}
            onClick={onSetHome}
          >
            设为首页镜头
          </button>
          <button
            type="button"
            className="secondary-button secondary-button--danger"
            disabled={disabled || frames.length <= 1}
            aria-label={`删除镜头 ${frame.name}`}
            onClick={() => onDeleteFrame(frame.id)}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      <p className="property-hint">
        首页镜头：x {Math.round(home.x)} y {Math.round(home.y)} · {Math.round(home.zoom * 100)}%。
      </p>

      <details className="simple-advanced-properties">
        <summary>语义缩放</summary>
        <p className="property-hint">
          只改变当前缩放下的可见/细节策略，不会删除图层，也不会改动选区。
        </p>
        {worldLayerItems.length === 0 ? (
          <p className="property-hint">当前空间表面还没有可参与语义缩放的世界图层。</p>
        ) : worldLayerItems.map((item) => (
          <label className="property-hint" key={item.layerItemId} data-layer-item-id={item.layerItemId}>
            <input
              type="checkbox"
              disabled={disabled}
              checked={ruleLayerItemIds.includes(item.layerItemId)}
              onChange={() => setRuleLayerItemIds((current) => (
                current.includes(item.layerItemId)
                  ? current.filter((id) => id !== item.layerItemId)
                  : [...current, item.layerItemId]
              ))}
            />
            {layerLabel(item.layerItemId)}
          </label>
        ))}
        <div className="form-field">
          <label htmlFor="spatial-camera-rule-min-zoom">最小缩放</label>
          <input
            id="spatial-camera-rule-min-zoom"
            className="form-input"
            type="number"
            aria-label="最小缩放"
            disabled={disabled}
            value={ruleMinZoom}
            onChange={(event) => setRuleMinZoom(event.currentTarget.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor="spatial-camera-rule-max-zoom">最大缩放</label>
          <input
            id="spatial-camera-rule-max-zoom"
            className="form-input"
            type="number"
            aria-label="最大缩放"
            disabled={disabled}
            value={ruleMaxZoom}
            onChange={(event) => setRuleMaxZoom(event.currentTarget.value)}
          />
        </div>
        <label className="property-hint">
          <input
            type="checkbox"
            disabled={disabled}
            checked={ruleVisible}
            onChange={(event) => setRuleVisible(event.currentTarget.checked)}
          />
          范围内可见
        </label>
        <button
          type="button"
          className="secondary-button"
          disabled={disabled || !canAddRule}
          onClick={() => {
            onAddSemanticZoomRule({
              layerItemIds: ruleLayerItemIds,
              minZoom: parsedRuleMinZoom,
              maxZoom: parsedRuleMaxZoom,
              visible: ruleVisible,
            })
            setRuleLayerItemIds([])
          }}
        >
          <Plus size={14} />添加语义缩放规则
        </button>
        {semanticZoomRules.map((rule) => (
          <div className="form-field" key={rule.id} data-semantic-zoom-rule-id={rule.id}>
            <p className="property-hint">
              {rule.layerItemIds.map((layerItemId) => layerLabel(layerItemId)).join('、') || '未选择图层'}
            </p>
            <PropertyDraftBoundary
              bindingKey={semanticRuleDraftBindings.get(rule.id) ?? draftBindingKey}
              onStale={onDraftStale}
            >
              <BufferedInput
                label={`规则最小缩放 ${rule.id}`}
                type="number"
                min={0}
                disabled={disabled}
                value={rule.minZoom}
                onCommit={(minZoom) => onUpdateSemanticZoomRule(rule.id, { minZoom: Number(minZoom) })}
              />
              <BufferedInput
                label={`规则最大缩放 ${rule.id}`}
                type="number"
                min={0.01}
                disabled={disabled}
                value={rule.maxZoom}
                onCommit={(maxZoom) => onUpdateSemanticZoomRule(rule.id, { maxZoom: Number(maxZoom) })}
              />
            </PropertyDraftBoundary>
            <label className="property-hint">
              <input
                type="checkbox"
                disabled={disabled}
                checked={rule.visible}
                onChange={(event) => onUpdateSemanticZoomRule(rule.id, {
                  visible: event.currentTarget.checked,
                })}
              />
              范围内可见
            </label>
            <button
              type="button"
              className="secondary-button secondary-button--danger"
              disabled={disabled}
              onClick={() => onDeleteSemanticZoomRule(rule.id)}
            >
              <Trash2 size={14} />删除规则
            </button>
          </div>
        ))}
      </details>
    </section>
  )
}
