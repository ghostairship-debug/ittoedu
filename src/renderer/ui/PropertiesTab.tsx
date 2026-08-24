import {
  AlignCenter,
  AlignHorizontalDistributeCenter,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignLeft,
  AlignRight,
  AlignVerticalDistributeCenter,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Bold,
  Box,
  Check,
  ChevronDown,
  Copy,
  Code2,
  Eye,
  EyeOff,
  FlipHorizontal2,
  FlipVertical2,
  Highlighter,
  ImageIcon,
  Italic,
  Layers3,
  Lock,
  Palette,
  Play,
  Globe2,
  Shapes,
  SlidersHorizontal,
  Sigma,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  Unlock,
  Video,
  Workflow,
} from 'lucide-react'
import { nanoid } from 'nanoid'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  findPresentationState,
  isNodeOverriddenInState,
  materializeScene,
} from '../../shared/presentation'
import type {
  ArrowHead,
  DeepPartial,
  FeatherMode,
  FormulaNode,
  GlobalLayerVisibility,
  ImageFit,
  ImageNode,
  ProjectDocument,
  SceneDocument,
  SceneNode,
  ShapeLineStyle,
  ShapeNode,
  ShapeType,
  TextAlign,
  TextNode,
  TeacherControllerAction,
  TeacherControllerNode,
  VideoNode,
  TextOverflowMode,
  VerticalAlign,
  WritingMode,
} from '../../shared/projectTypes'
import { formulaAstToAccessibleText } from '../../shared/formulaLinear'
import type { RuntimeLayer } from '../../shared/runtimeTypes'
import { isStrokeOnlyShapeType, SHAPE_TYPES } from '../../shared/projectTypes'
import {
  isVerticalWritingMode,
  renderTextNodeCanvas,
} from '../../shared/textLayout'
import { remapTextRuns } from '../../shared/textRuns'
import {
  opacityToTransparencyPercent,
  transparencyPercentToOpacity,
} from '../../shared/opacity'
import { collectProjectDiagnostics } from '../../shared/projectDiagnostics'
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '../../shared/constants'
import { isCourseLayerVisibleAtLocation } from '../../shared/courseProjectModel'
import type {
  CourseLocation,
  CourseProjectDocument,
  FlowBlock,
  FlowMediaBlock,
  LocationVisibility,
} from '../../shared/courseProjectTypes'
import {
  collectAllCourseLayerOrders,
  collectSlideSurfaceSceneOrders,
  readGlobalLayerScenePlane,
} from '../course/globalLayerCommands'
import {
  selectActiveCourseProjectDocument,
  selectActiveCourseLocationId,
  selectActiveScene,
  selectCandidateGlobalLayerItems,
  selectEditingNodes,
  selectSelectedNode,
  selectSlideAuthoringSnapshot,
  selectSlideAuthoringBackend,
  selectSlideAuthoringDocument,
  type AlignmentMode,
  useEditorStore,
} from '../store/editorStore'
import {
  selectRuntimeInspectorAuthoringView,
  type RuntimeInspectorAuthoringView,
} from '../runtime/runtimeInspectorAuthoringView'
import { updateCourseAuthoringSessionRevision } from '../authoring/courseAuthoringSession'
import {
  createImageAssetImport,
  createMediaAssetImport,
} from '../project/assetManager'
import { freezeCourseAssetSidecar } from '../project/v9AssetAdapter'
import {
  findGlobalTeacherController,
  teacherControllerPropertiesPreview,
} from '../authoring/v9TeacherControllerAuthoring'
import { ColorInput } from './ColorInput'
import { ComponentPropertiesEditor } from './ComponentPropertiesEditor'
import { RuntimeContentEditor } from './RuntimeContentEditor'
import { InteractionEditor } from './InteractionEditor'
import { PresenterSettingsEditor } from './PresenterSettingsEditor'
import { DesignTokensEditor } from './DesignTokensEditor'
import { SimpleEntranceAnimationEditor } from './SimpleEntranceAnimationEditor'
import { FormulaAuthoringEditor } from './FormulaAuthoringEditor'
import { FlowFormulaBlockProperties } from './FlowFormulaBlockProperties'
import { SpatialCameraPanel } from './SpatialCameraPanel'
import { SpatialPathEditor } from './SpatialPathEditor'
import type { SpatialAuthoringSession } from '../course/spatialEditorCommands'
import { updateSpatialSurfaceBackgroundColor } from '../course/spatialEditorCommands'
import {
  executeFlowEditorCommand,
  importAndReplaceFlowMediaBlock,
  replaceFlowMediaBlockAsset,
  updateFlowEditorBlock,
  updateFlowSurfaceBackgroundColor,
} from '../course/flowEditorCommands'
import { flowBlockTargetFromSelection } from '../course/flowEditorSlice'
import { resolveCourseSurfaceBackgroundColor } from '../../shared/courseProjectModel'
import { buildSpatialEditorView } from '../course/spatialEditorView'
import {
  addSpatialCameraFrameFromSession,
  deleteSpatialCameraFrameInSession,
  fitSpatialSessionToWorldContent,
  renameSpatialCameraFrameInSession,
  reorderSpatialCameraFramesInSession,
  setSpatialCameraHomeFromSession,
  updateActiveSpatialCameraFrameFromSession,
} from '../course/spatialCameraCommands'
import {
  addSpatialPathInSession,
  deleteSpatialPathInSession,
  reorderSpatialPathWaypointsInSession,
  setSpatialShowCameraFrames,
  updateSpatialPathInSession,
} from '../course/spatialPathCommands'
import {
  addSpatialRelationInSession,
  deleteSpatialRelationInSession,
  updateSpatialRelationInSession,
} from '../course/spatialRelationCommands'
import {
  addSpatialSemanticZoomRuleInSession,
  deleteSpatialSemanticZoomRuleInSession,
  updateSpatialSemanticZoomRuleInSession,
} from '../course/spatialSemanticZoom'
import type { SpatialGraphSelection } from '../store/editorStore'
import type { FlowAuthoringSession } from '../project/createFlowCourseProject'
import { findFlowBlockRecursive, flowSurfaceIn } from '../course/flowDocumentModel'
import {
  deriveFlowSelectionFormat,
  FLOW_PAPER_TEXT_COLOR,
  type FlowSelectionFormatField,
} from '../authoring/flowTextEdit'
import { locateCourseLayer } from '../course/effectiveLayerCommands'
import {
  commitFlowOverlayFormulaAst,
  convertFlowComponentBlockToOverlay,
  convertFlowMediaBlockToOverlay,
  convertFlowOverlayComponentToDocument,
  convertFlowOverlayMediaToDocument,
  patchFlowOverlayPaperSpace,
} from '../course/flowSharedAuthoringAdapters'

interface BufferedInputProps {
  label: string
  value: string | number
  type?: 'text' | 'number'
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  title?: string
  placeholder?: string
  onCommit(value: string): void
}

function BufferedInput({
  label,
  value,
  type = 'text',
  min,
  max,
  step,
  disabled,
  title,
  placeholder,
  onCommit,
}: BufferedInputProps) {
  const [draft, setDraft] = useState(String(value))
  useLayoutEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    if (draft === String(value)) return
    if (type === 'number') {
      const parsed = Number(draft)
      if (!Number.isFinite(parsed)) {
        setDraft(String(value))
        return
      }
      const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed))
      onCommit(String(clamped))
      setDraft(String(clamped))
      return
    }
    if (draft.trim()) onCommit(draft.trim())
    else setDraft(String(value))
  }
  return (
    <div className="form-field">
      <label>{label}</label>
      <input
        className="form-input"
        aria-label={label}
        type={type}
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        title={title}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(String(value))
            event.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}

function SelectField<T extends string>({
  label,
  value,
  options,
  disabled = false,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  disabled?: boolean
  onChange(value: T): void
}) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <select
        className="form-input"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option value={option.value} key={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  )
}

function RangeField({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange(value: number): void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = (next: number) => {
    const clamped = Math.min(max, Math.max(min, next))
    setDraft(clamped)
    if (clamped !== value) onChange(clamped)
  }
  return (
    <div className="form-field range-field">
      <label><span>{label}</span><span>{Number(draft.toFixed(2))}{suffix}</span></label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-label={label}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={(event) => commit(Number(event.currentTarget.value))}
        onPointerCancel={(event) => commit(Number(event.currentTarget.value))}
        onKeyUp={(event) => commit(Number(event.currentTarget.value))}
        onBlur={(event) => commit(Number(event.currentTarget.value))}
      />
    </div>
  )
}

function ToggleRow({ label, checked, disabled = false, onChange }: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange(checked: boolean): void
}) {
  return (
    <div className="toggle-row">
      <span>{label}</span>
      <label className="toggle">
        <input
          type="checkbox"
          aria-label={label}
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="toggle-track" />
      </label>
    </div>
  )
}

function TextContentTextarea({ label, value, onBegin, onChange, onCommit, onCancel }: {
  label: string
  value: string
  onBegin(): void
  onChange(value: string): void
  onCommit(): void
  onCancel(): void
}) {
  const composingRef = useRef(false)
  return (
    <div className="form-field">
      <label>{label}</label>
      <textarea
        className="form-textarea"
        aria-label={label}
        value={value}
        onFocus={onBegin}
        onChange={(event) => onChange(event.target.value)}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={() => { composingRef.current = false }}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (composingRef.current || event.nativeEvent.isComposing) return
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
            event.currentTarget.blur()
          }
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault()
            onCommit()
            event.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}

export const FONT_FAMILY_OPTIONS = [
  { label: '微软雅黑', family: 'Microsoft YaHei' },
  { label: '微软雅黑 UI', family: 'Microsoft YaHei UI' },
  { label: '微软正黑体', family: 'Microsoft JhengHei' },
  { label: '等线', family: 'DengXian' },
  { label: '宋体', family: 'SimSun' },
  { label: '黑体', family: 'SimHei' },
  { label: '楷体', family: 'KaiTi' },
  { label: '仿宋', family: 'FangSong' },
  { label: '华文黑体', family: 'STHeiti' },
  { label: '华文宋体', family: 'STSong' },
  { label: '华文楷体', family: 'STKaiti' },
  { label: '华文仿宋', family: 'STFangsong' },
  { label: '苹方', family: 'PingFang SC' },
  { label: '冬青黑体', family: 'Hiragino Sans GB' },
  { label: '思源黑体', family: 'Source Han Sans SC' },
  { label: '思源宋体', family: 'Source Han Serif SC' },
  { label: 'Noto 无衬线中文', family: 'Noto Sans SC' },
  { label: 'Noto 衬线中文', family: 'Noto Serif SC' },
  { label: 'Noto CJK 黑体', family: 'Noto Sans CJK SC' },
  { label: 'Noto CJK 宋体', family: 'Noto Serif CJK SC' },
  { label: 'Inter', family: 'Inter' },
  { label: 'Arial', family: 'Arial' },
  { label: 'Helvetica', family: 'Helvetica' },
  { label: 'Verdana', family: 'Verdana' },
  { label: 'Tahoma', family: 'Tahoma' },
  { label: 'Trebuchet MS', family: 'Trebuchet MS' },
  { label: 'Georgia', family: 'Georgia' },
  { label: 'Times New Roman', family: 'Times New Roman' },
  { label: 'Courier New', family: 'Courier New' },
  { label: '无衬线通用字体', family: 'sans-serif' },
  { label: '衬线通用字体', family: 'serif' },
  { label: '等宽通用字体', family: 'monospace' },
] as const

export const COMMON_FONT_FAMILIES = FONT_FAMILY_OPTIONS.map(
  (option) => option.family,
)

type FontAvailability = 'available' | 'unavailable' | 'unknown'

export function detectFontAvailability(fontFamily: string): FontAvailability {
  if (['sans-serif', 'serif', 'monospace'].includes(fontFamily)) {
    return 'available'
  }
  if (typeof document === 'undefined' || !document.fonts?.check) {
    return 'unknown'
  }
  const escapedFamily = fontFamily.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  try {
    return document.fonts.check(
      `16px "${escapedFamily}"`,
      '中文字体预览 Aa 123',
    )
      ? 'available'
      : 'unavailable'
  } catch {
    return 'unknown'
  }
}

export function FontFamilyPicker({ value, placeholder, onCommit }: {
  value: string
  placeholder?: string
  onCommit(value: string): void
}) {
  const [draft, setDraft] = useState(value)
  const [open, setOpen] = useState(false)
  const [queryDirty, setQueryDirty] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const focusedRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!focusedRef.current) setDraft(value)
  }, [value])

  const currentOption = FONT_FAMILY_OPTIONS.find(
    (option) => option.family === value,
  )
  const availableFonts = currentOption
    ? [...FONT_FAMILY_OPTIONS]
    : [
        ...(value
          ? [{ label: '自定义字体', family: value } as const]
          : []),
        ...FONT_FAMILY_OPTIONS,
      ]
  const normalizedQuery = draft.trim().toLocaleLowerCase()
  const visibleFonts = queryDirty && normalizedQuery
    ? availableFonts.filter((font) => (
      font.family.toLocaleLowerCase().includes(normalizedQuery) ||
      font.label.toLocaleLowerCase().includes(normalizedQuery)
    ))
    : availableFonts

  const commit = (candidate = draft) => {
    const next = candidate.trim()
    if (!next) {
      setDraft(value)
      return
    }
    setDraft(next)
    if (next !== value) onCommit(next)
  }

  const openAllFonts = () => {
    const selectedIndex = availableFonts.findIndex(
      (font) => font.family === draft,
    )
    setQueryDirty(false)
    setActiveIndex(Math.max(0, selectedIndex))
    setOpen(true)
  }

  const selectFont = (font: string) => {
    setDraft(font)
    setOpen(false)
    setQueryDirty(false)
    if (font !== value) onCommit(font)
    inputRef.current?.focus()
  }

  return (
    <div
      className="form-field font-family-field"
      onFocus={() => { focusedRef.current = true }}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget
        if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
          return
        }
        focusedRef.current = false
        setOpen(false)
        setQueryDirty(false)
        commit()
      }}
    >
      <label htmlFor="text-font-family">字体</label>
      <div className="font-family-combobox">
        <input
          ref={inputRef}
          id="text-font-family"
          className="form-input font-family-input"
          type="text"
          role="combobox"
          aria-label="字体"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="courseware-font-families"
          aria-activedescendant={
            open && visibleFonts[activeIndex]
              ? `courseware-font-option-${activeIndex}`
              : undefined
          }
          value={draft}
          placeholder={placeholder}
          spellCheck={false}
          onFocus={() => {
            if (!open) openAllFonts()
          }}
          onClick={() => {
            if (!open) openAllFonts()
          }}
          onChange={(event) => {
            const next = event.target.value
            setDraft(next)
            setQueryDirty(true)
            setActiveIndex(0)
            setOpen(true)
            if (COMMON_FONT_FAMILIES.some((font) => font === next)) commit(next)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              if (!open) {
                openAllFonts()
                return
              }
              const direction = event.key === 'ArrowDown' ? 1 : -1
              setActiveIndex((current) => {
                if (visibleFonts.length === 0) return 0
                return (current + direction + visibleFonts.length) % visibleFonts.length
              })
            } else if (event.key === 'Enter') {
              event.preventDefault()
              const activeFont = open ? visibleFonts[activeIndex] : undefined
              if (activeFont) selectFont(activeFont.family)
              else {
                commit()
                setOpen(false)
              }
            } else if (event.key === 'Escape') {
              event.preventDefault()
              setDraft(value)
              setOpen(false)
              setQueryDirty(false)
            }
          }}
          style={{ fontFamily: draft || value }}
        />
        <button
          type="button"
          className="font-family-toggle"
          aria-label={open ? '收起字体列表' : '展开字体列表'}
          aria-controls="courseware-font-families"
          aria-expanded={open}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            if (open) setOpen(false)
            else openAllFonts()
            inputRef.current?.focus()
          }}
        >
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {open ? (
          <div
            id="courseware-font-families"
            className="font-family-listbox"
            role="listbox"
            aria-label="常用字体"
          >
            {visibleFonts.length > 0 ? visibleFonts.map((font, index) => {
              const availability = detectFontAvailability(font.family)
              const availabilityLabel = availability === 'available'
                ? '可用'
                : availability === 'unavailable'
                  ? '未安装'
                  : '未检测'
              return (
              <button
                id={`courseware-font-option-${index}`}
                type="button"
                role="option"
                aria-selected={font.family === draft}
                aria-label={`${font.label}，${font.family}，${availabilityLabel}`}
                className={
                  `font-family-option${index === activeIndex ? ' is-active' : ''}`
                }
                key={font.family}
                onPointerDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectFont(font.family)}
                style={{ fontFamily: font.family }}
              >
                <span className="font-family-option__identity">
                  <strong>{font.label}</strong>
                  <small>{font.family}</small>
                </span>
                <span
                  className={`font-family-option__status font-family-option__status--${availability}`}
                >
                  {availabilityLabel}
                </span>
                {font.family === draft
                  ? <Check size={14} aria-hidden="true" />
                  : null}
              </button>
              )
            }) : (
              <div className="font-family-empty">
                按 Enter 使用“{draft.trim()}”
              </div>
            )}
          </div>
        ) : null}
      </div>
      <div
        className="font-family-preview"
        data-testid="font-family-preview"
        style={{ fontFamily: draft || value }}
      >
        中文字体预览 Aa 123
      </div>
      <small className="font-family-help">
        列表同时显示中文名、CSS 字体名和本机可用状态；仍可输入自定义字体或回退字体串。
      </small>
    </div>
  )
}

function CommonNodeProperties({ node, update }: {
  node: SceneNode
  update(patch: DeepPartial<SceneNode>): void
}) {
  const editorMode = useEditorStore((state) => state.editorMode)
  const autoSizedText = node.type === 'text' &&
    node.style.overflow === 'auto-height'
  const verticalAutoSizedText = autoSizedText &&
    isVerticalWritingMode(node.style.writingMode)
  return (
    <section className="property-section">
      <h3 className="property-title"><SlidersHorizontal size={14} />通用</h3>
      <BufferedInput label="名称" value={node.name} onCommit={(name) => update({ name })} />
      {editorMode === 'professional' && <div className="coordinate-grid">
        <BufferedInput label="X" type="number" step={0.1} value={Number(node.x.toFixed(1))} onCommit={(x) => update({ x: Number(x) })} />
        <BufferedInput label="Y" type="number" step={0.1} value={Number(node.y.toFixed(1))} onCommit={(y) => update({ y: Number(y) })} />
      </div>}
      <div className="coordinate-grid">
        <BufferedInput
          label="宽"
          type="number"
          min={16}
          step={0.1}
          value={Number(node.width.toFixed(1))}
          disabled={verticalAutoSizedText}
          title={verticalAutoSizedText
            ? '当前由竖排文字内容自动计算宽度'
            : undefined}
          onCommit={(width) => update({ width: Number(width) })}
        />
        <BufferedInput
          label="高"
          type="number"
          min={16}
          step={0.1}
          value={Number(node.height.toFixed(1))}
          disabled={autoSizedText && !verticalAutoSizedText}
          title={autoSizedText && !verticalAutoSizedText
            ? '当前由横排文字内容自动计算高度'
            : undefined}
          onCommit={(height) => update({ height: Number(height) })}
        />
      </div>
      {autoSizedText && (
        <p className="property-hint">
          {verticalAutoSizedText
            ? '竖排时宽度自动适应内容；高度可直接输入或拖动画布上下边缘调整。'
            : '横排时高度自动适应内容；宽度可直接输入或拖动画布左右边缘调整。'}
        </p>
      )}
      {editorMode === 'professional' ? <div className="coordinate-grid">
        <BufferedInput label="旋转角度" type="number" min={-36000} max={36000} step={1} value={Number(node.rotation.toFixed(1))} onCommit={(rotation) => update({ rotation: Number(rotation) })} />
        <BufferedInput
          label="透明度 %"
          type="number"
          min={0}
          max={100}
          step={1}
          value={opacityToTransparencyPercent(node.opacity)}
          onCommit={(transparency) => update({
            opacity: transparencyPercentToOpacity(Number(transparency)),
          })}
        />
      </div> : (
        <>
          <BufferedInput
            label="透明度 %"
            type="number"
            min={0}
            max={100}
            step={1}
            value={opacityToTransparencyPercent(node.opacity)}
            onCommit={(transparency) => update({
              opacity: transparencyPercentToOpacity(Number(transparency)),
            })}
          />
          <details className="simple-advanced-properties">
            <summary>更多布局设置</summary>
            <div className="coordinate-grid">
              <BufferedInput label="X" type="number" step={0.1} value={Number(node.x.toFixed(1))} onCommit={(x) => update({ x: Number(x) })} />
              <BufferedInput label="Y" type="number" step={0.1} value={Number(node.y.toFixed(1))} onCommit={(y) => update({ y: Number(y) })} />
              <BufferedInput label="旋转角度" type="number" min={-36000} max={36000} step={1} value={Number(node.rotation.toFixed(1))} onCommit={(rotation) => update({ rotation: Number(rotation) })} />
            </div>
          </details>
        </>
      )}
      <ToggleRow label="显示图层" checked={node.visible} onChange={(visible) => update({ visible })} />
      <button type="button" className="secondary-button" style={{ width: '100%' }} onClick={() => update({ locked: !node.locked })}>
        {node.locked ? <Unlock size={14} /> : <Lock size={14} />}
        {node.locked ? '解锁图层' : '锁定图层'}
      </button>
      {editorMode === 'professional' && <div className="form-field" style={{ marginTop: 12 }}>
        <label>互动播放初始状态</label>
        <SelectField<SceneNode['playbackInitialVisibility']>
          label="播放开始时"
          value={node.playbackInitialVisibility}
          options={[
            { value: 'inherit', label: '跟随作者可见性' },
            { value: 'hidden', label: '先隐藏，等待入场动作' },
          ]}
          onChange={(playbackInitialVisibility) => update({
            playbackInitialVisibility,
          })}
        />
        <p className="property-hint">
          “等待入场”只影响互动 Player；编辑画布、缩略图和 PDF/PPTX 仍显示作者设定的稳定画面。何时出现或退出请在规则的动作步骤中配置。
        </p>
      </div>}
    </section>
  )
}

function TextProperties({ node, update, contentEditingEnabled = true }: {
  node: TextNode
  update(patch: DeepPartial<SceneNode>): void
  contentEditingEnabled?: boolean
}) {
  const style = node.style
  const beginTextEdit = useEditorStore((state) => state.beginTextEdit)
  const commitTextEdit = useEditorStore((state) => state.commitTextEdit)
  const cancelTextEdit = useEditorStore((state) => state.cancelTextEdit)
  const selectionRef = useRef({ start: 0, end: 0 })
  const captureSelection = () => {
    const active = document.activeElement
    if (active instanceof HTMLTextAreaElement) {
      selectionRef.current = {
        start: active.selectionStart,
        end: active.selectionEnd,
      }
    }
  }
  const toggleStyle = (key: 'bold' | 'italic' | 'underline' | 'strike') => {
    const state = useEditorStore.getState()
    const start = selectionRef.current.start
    const end = selectionRef.current.end
    if (selectSlideAuthoringBackend(state) && end > start) {
      state.commitSlideCandidateTextRunStyle({
        layerItemId: node.id,
        selectionStart: start,
        selectionEnd: end,
        patch: { [key]: true },
        source: 'properties',
      })
      return
    }
    update({ style: { [key]: !style[key] } } as DeepPartial<SceneNode>)
  }
  const updateTextDraft = (text: string) => {
    let state = useEditorStore.getState()
    const candidate = selectSlideAuthoringBackend(state)
    if (candidate) {
      if (state.v9ContentEdit?.target.layerItemId !== node.id) {
        state.beginTextEdit(node.id, 'properties')
        state = useEditorStore.getState()
      }
    } else if (state.textEditSession?.nodeId !== node.id) {
      state.beginTextEdit(node.id, 'properties')
      state = useEditorStore.getState()
    }
    const current = selectEditingNodes(state).find(
      (item) => item.id === node.id,
    )
    if (current?.type !== 'text') return
    const original = state.v9ContentEdit?.kind === 'text'
      ? state.v9ContentEdit.original
      : state.textEditSession?.original
    const sourceText = original && 'text' in original ? original.text : current.text
    const sourceRuns = original && 'runs' in original ? original.runs : current.runs
    const runs = remapTextRuns(sourceText, text, sourceRuns)
    const draftNode = { ...current, text, runs }
    const rendered = current.style.overflow === 'auto-height'
      ? renderTextNodeCanvas(draftNode, draftNode.width)
      : null
    state.updateTextEditDraft(
      current.id,
      text,
      runs,
      rendered?.height ?? current.height,
      rendered?.width ?? current.width,
    )
  }
  return (
    <section className="property-section">
      <h3 className="property-title"><Type size={14} />文本</h3>
      {contentEditingEnabled ? (
        <>
          <TextContentTextarea
            label="文字内容"
            value={node.text}
            onBegin={() => beginTextEdit(node.id, 'properties')}
            onChange={updateTextDraft}
            onCommit={commitTextEdit}
            onCancel={cancelTextEdit}
          />
          <button
            type="button"
            className="secondary-button"
            style={{ width: '100%', marginBottom: 10 }}
            onClick={() => beginTextEdit(node.id, 'canvas')}
          >
            <Type size={14} />编辑局部文字格式
          </button>
          <p className="property-hint">也可以双击画布中的文字，选中部分内容后设置局部格式。</p>
        </>
      ) : (
        <p
          className="property-hint"
          data-testid="spatial-text-content-unavailable"
          role="status"
        >
          当前 Spatial 范围只支持整节点文字样式；文字内容与局部格式不会提供无法保存的控件。
        </p>
      )}
      <FontFamilyPicker value={style.fontFamily} onCommit={(fontFamily) => update({ style: { fontFamily } })} />
      <div className="coordinate-grid">
        <BufferedInput label="字号" type="number" min={8} max={400} value={style.fontSize} onCommit={(fontSize) => update({ style: { fontSize: Number(fontSize) } })} />
        <BufferedInput label="行距" type="number" min={0} max={200} value={style.lineSpacing} onCommit={(lineSpacing) => update({ style: { lineSpacing: Number(lineSpacing) } })} />
        <BufferedInput label="字距" type="number" min={-20} max={100} value={style.letterSpacing} onCommit={(letterSpacing) => update({ style: { letterSpacing: Number(letterSpacing) } })} />
        <BufferedInput label="内边距" type="number" min={0} max={200} value={style.padding} onCommit={(padding) => update({ style: { padding: Number(padding) } })} />
      </div>
      <ColorInput id="text-color" label="文字颜色" value={style.color} onChange={(color) => update({ style: { color } })} />
      <div className="form-field">
        <label>文字样式</label>
        <div className="segmented-control text-style-control">
          {[
            ['bold', '加粗', Bold], ['italic', '斜体', Italic], ['underline', '下划线', Underline], ['strike', '删除线', Strikethrough],
          ].map(([key, label, Icon]) => (
            <button type="button" key={String(key)} title={String(label)} aria-label={String(label)} className={`segment-button${style[key as 'bold'] ? ' segment-button--active' : ''}`} onMouseDown={captureSelection} onClick={() => toggleStyle(key as 'bold' | 'italic' | 'underline' | 'strike')}>
              <Icon size={15} />
            </button>
          ))}
        </div>
      </div>
      <div className="form-field">
        <label>高亮</label>
        <div className="inline-control">
          <button type="button" className={`secondary-button${style.highlightColor ? ' secondary-button--active' : ''}`} onClick={() => update({ style: { highlightColor: style.highlightColor ? null : '#fff3a3' } })}>
            <Highlighter size={14} />{style.highlightColor ? '取消高亮' : '启用高亮'}
          </button>
          {style.highlightColor && <ColorInput id="text-highlight" label="高亮颜色" value={style.highlightColor} onChange={(highlightColor) => update({ style: { highlightColor } })} />}
        </div>
      </div>
      <ToggleRow
        label="文字着重号"
        checked={style.emphasis}
        onChange={(emphasis) => update({ style: { emphasis } })}
      />
      <p className="property-hint">
        横排显示在字下，竖排显示在字右；局部内容可在画布文字编辑器中单独设置。
      </p>
      <div className="form-field">
        <label>水平对齐</label>
        <div className="segmented-control">
          {([
            ['left', '左对齐', AlignLeft], ['center', '居中', AlignCenter], ['right', '右对齐', AlignRight],
          ] as Array<[TextAlign, string, typeof AlignLeft]>).map(([value, label, Icon]) => (
            <button type="button" key={value} aria-label={label} title={label} className={`segment-button${style.align === value ? ' segment-button--active' : ''}`} onClick={() => update({ style: { align: value } })}><Icon size={15} /></button>
          ))}
        </div>
      </div>
      <SelectField<VerticalAlign> label="垂直对齐" value={style.verticalAlign} options={[{ value: 'top', label: '顶部' }, { value: 'middle', label: '居中' }, { value: 'bottom', label: '底部' }]} onChange={(verticalAlign) => update({ style: { verticalAlign } })} />
      <SelectField<WritingMode>
        label="文字方向"
        value={style.writingMode}
        options={[
          { value: 'horizontal', label: '横排' },
          { value: 'vertical-rl', label: '竖排（列从右向左）' },
          { value: 'vertical-lr', label: '竖排（列从左向右）' },
        ]}
        onChange={(writingMode) => update({ style: { writingMode } })}
      />
      <SelectField<TextOverflowMode>
        label="溢出策略"
        value={style.overflow}
        options={[
          {
            value: 'auto-height',
            label: isVerticalWritingMode(style.writingMode)
              ? '自动增宽'
              : '自动增高',
          },
          { value: 'fixed', label: '固定尺寸并裁切' },
          { value: 'shrink', label: '自动缩小字体' },
        ]}
        onChange={(overflow) => update({ style: { overflow } })}
      />
      <ColorInput id="text-background" label="文本框背景" value={style.backgroundColor} onChange={(backgroundColor) => update({ style: { backgroundColor } })} />
      <RangeField
        label="背景透明度"
        value={opacityToTransparencyPercent(style.backgroundOpacity)}
        min={0}
        max={100}
        suffix="%"
        onChange={(value) => update({
          style: { backgroundOpacity: transparencyPercentToOpacity(value) },
        })}
      />
      <RangeField label="文本框圆角" value={style.cornerRadius} min={0} max={Math.min(node.width, node.height) / 2} suffix="px" onChange={(cornerRadius) => update({ style: { cornerRadius } })} />
    </section>
  )
}

function FormulaProperties({ node, update }: {
  node: FormulaNode
  update(patch: DeepPartial<SceneNode>): void
}) {
  const generatedAccessibleText = formulaAstToAccessibleText(node.ast)
  const normalizeAccessibleText = (value: string) => value.replace(/\s+/gu, '')
  const accessibilityAutomatic = normalizeAccessibleText(node.accessibleText) ===
    normalizeAccessibleText(generatedAccessibleText)

  return (
    <section className="property-section" data-testid="formula-properties">
      <h3 className="property-title"><Sigma size={14} />公式</h3>
      <FormulaAuthoringEditor
        node={node}
        onCommit={(ast, accessibleText) => update({
          ast,
          accessibleText,
        } as DeepPartial<SceneNode>)}
      />
      <BufferedInput
        label="无障碍描述"
        value={node.accessibleText}
        onCommit={(accessibleText) => update({ accessibleText } as DeepPartial<SceneNode>)}
      />
      <div className="formula-accessibility-status">
        <span className={accessibilityAutomatic
          ? 'formula-accessibility-status__automatic'
          : 'formula-accessibility-status__custom'}>
          {accessibilityAutomatic ? '随公式自动更新' : '使用自定义描述'}
        </span>
        {!accessibilityAutomatic && (
          <button
            type="button"
            className="text-button"
            onClick={() => update({
              accessibleText: generatedAccessibleText,
            } as DeepPartial<SceneNode>)}
          >
            恢复自动描述
          </button>
        )}
      </div>
      <p className="property-hint">
        {accessibilityAutomatic
          ? '当公式结构改变时，读屏和检索描述会在同一次提交中更新。'
          : '自定义描述不会被覆盖；修改公式后请复核它是否仍然准确。'}
      </p>
      <BufferedInput
        label="公式字号"
        type="number"
        min={12}
        max={200}
        value={node.style.fontSize}
        onCommit={(fontSize) => update({
          style: { fontSize: Number(fontSize) },
        } as DeepPartial<SceneNode>)}
      />
      <ColorInput
        id="formula-color"
        label="公式颜色"
        value={node.style.color}
        onChange={(color) => update({ style: { color } } as DeepPartial<SceneNode>)}
      />
      <div className="form-field">
        <label>水平对齐</label>
        <div className="segmented-control">
          {([
            ['left', '左对齐', AlignLeft],
            ['center', '居中', AlignCenter],
            ['right', '右对齐', AlignRight],
          ] as Array<[TextAlign, string, typeof AlignLeft]>).map(([value, label, Icon]) => (
            <button
              type="button"
              key={value}
              aria-label={`公式${label}`}
              title={label}
              className={`segment-button${node.style.align === value ? ' segment-button--active' : ''}`}
              onClick={() => update({ style: { align: value } } as DeepPartial<SceneNode>)}
            >
              <Icon size={15} />
            </button>
          ))}
        </div>
      </div>
      <p className="property-hint">
        PPTX 会按当前共享渲染结果静态化，Formula ID 和无障碍描述仍会保留。
      </p>
    </section>
  )
}

function ImageProperties({ node, update, onReplaceImage }: {
  node: Extract<SceneNode, { type: 'image' }>
  update(patch: DeepPartial<SceneNode>): void
  onReplaceImage(): void
}) {
  const replaceSafeArea = (
    index: number,
    patch: Partial<ImageNode['safeAreas'][number]>,
  ) => update({
    safeAreas: node.safeAreas.map((area, areaIndex) => (
      areaIndex === index ? { ...area, ...patch } : area
    )),
  })
  return (
    <section className="property-section">
      <h3 className="property-title"><ImageIcon size={14} />图片</h3>
      <button type="button" className="secondary-button" style={{ width: '100%', marginBottom: 12 }} onClick={onReplaceImage}><ImageIcon size={14} />替换图片</button>
      <SelectField<ImageFit> label="显示方式" value={node.fit} options={[{ value: 'contain', label: '适应（完整显示）' }, { value: 'cover', label: '填充（允许裁剪）' }, { value: 'stretch', label: '拉伸' }]} onChange={(fit) => update({ fit })} />
      <ToggleRow label="保持宽高比" checked={node.preserveAspectRatio} onChange={(preserveAspectRatio) => update({ preserveAspectRatio })} />
      <div className="button-row">
        <button type="button" className={`secondary-button${node.flipX ? ' secondary-button--active' : ''}`} onClick={() => update({ flipX: !node.flipX })}><FlipHorizontal2 size={14} />水平翻转</button>
        <button type="button" className={`secondary-button${node.flipY ? ' secondary-button--active' : ''}`} onClick={() => update({ flipY: !node.flipY })}><FlipVertical2 size={14} />垂直翻转</button>
      </div>
      <p className="property-hint">源图裁剪（从对应边缘裁去）</p>
      <RangeField label="左裁剪" value={node.crop.left * 100} min={0} max={(0.98 - node.crop.right) * 100} suffix="%" onChange={(left) => update({ crop: { left: left / 100 } })} />
      <RangeField label="右裁剪" value={node.crop.right * 100} min={0} max={(0.98 - node.crop.left) * 100} suffix="%" onChange={(right) => update({ crop: { right: right / 100 } })} />
      <RangeField label="上裁剪" value={node.crop.top * 100} min={0} max={(0.98 - node.crop.bottom) * 100} suffix="%" onChange={(top) => update({ crop: { top: top / 100 } })} />
      <RangeField label="下裁剪" value={node.crop.bottom * 100} min={0} max={(0.98 - node.crop.top) * 100} suffix="%" onChange={(bottom) => update({ crop: { bottom: bottom / 100 } })} />
      <button
        type="button"
        className="secondary-button"
        style={{ width: '100%', marginBottom: 8 }}
        disabled={Object.values(node.crop).every((value) => value === 0)}
        onClick={() => update({ crop: { left: 0, top: 0, right: 0, bottom: 0 } })}
      >
        重置裁剪
      </button>
      {node.fit !== 'stretch' && (
        <>
          <RangeField label={node.fit === 'cover' ? '填充焦点 X' : '框内位置 X'} value={node.cropX * 100} min={0} max={100} suffix="%" onChange={(cropX) => update({ cropX: cropX / 100 })} />
          <RangeField label={node.fit === 'cover' ? '填充焦点 Y' : '框内位置 Y'} value={node.cropY * 100} min={0} max={100} suffix="%" onChange={(cropY) => update({ cropY: cropY / 100 })} />
        </>
      )}
      <RangeField label="圆角" value={node.cornerRadius} min={0} max={Math.min(node.width, node.height) / 2} suffix="px" onChange={(cornerRadius) => update({ cornerRadius })} />
      <SelectField<FeatherMode> label="羽化形状" value={node.feather.mode} options={[{ value: 'rectangle', label: '矩形边缘' }, { value: 'ellipse', label: '椭圆/径向' }]} onChange={(mode) => update({ feather: { mode } })} />
      <RangeField label="羽化强度" value={node.feather.amount} min={0} max={100} suffix="%" onChange={(amount) => update({ feather: { amount } })} />
      <div className="property-subsection-header">
        <div>
          <strong>图片安全区</strong>
          <small>只在编辑器中显示，不进入成品画面</small>
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={node.safeAreas.length >= 16}
          onClick={() => update({
            safeAreas: [...node.safeAreas, {
              id: `safe_area_${nanoid(10)}`,
              label: `安全区 ${node.safeAreas.length + 1}`,
              x: 0.1,
              y: 0.1,
              width: 0.8,
              height: 0.8,
            }],
          })}
        >
          添加安全区
        </button>
      </div>
      {node.safeAreas.map((area, index) => (
        <div className="safe-area-card" key={area.id}>
          <div className="safe-area-card__header">
            <BufferedInput
              label={`安全区 ${index + 1} 名称`}
              value={area.label}
              onCommit={(label) => replaceSafeArea(index, { label })}
            />
            <button
              type="button"
              className="icon-button"
              aria-label={`删除安全区 ${area.label}`}
              onClick={() => update({
                safeAreas: node.safeAreas.filter((_, areaIndex) => areaIndex !== index),
              })}
            >
              <Trash2 size={14} />
            </button>
          </div>
          <RangeField label="左侧位置" value={area.x * 100} min={0} max={(1 - area.width) * 100} suffix="%" onChange={(x) => replaceSafeArea(index, { x: x / 100 })} />
          <RangeField label="顶部位置" value={area.y * 100} min={0} max={(1 - area.height) * 100} suffix="%" onChange={(y) => replaceSafeArea(index, { y: y / 100 })} />
          <RangeField label="安全区宽度" value={area.width * 100} min={1} max={(1 - area.x) * 100} suffix="%" onChange={(width) => replaceSafeArea(index, { width: width / 100 })} />
          <RangeField label="安全区高度" value={area.height * 100} min={1} max={(1 - area.y) * 100} suffix="%" onChange={(height) => replaceSafeArea(index, { height: height / 100 })} />
        </div>
      ))}
    </section>
  )
}

function VideoProperties({
  node,
  update,
  diagnostics = [],
  onOpenAutomation,
}: {
  node: VideoNode
  update(patch: DeepPartial<SceneNode>): void
  diagnostics?: string[]
  onOpenAutomation?(): void
}) {
  return (
    <section className="property-section">
      <h3 className="property-title"><Video size={14} />视频</h3>
      <SelectField<ImageFit>
        label="显示方式"
        value={node.fit}
        options={[
          { value: 'contain', label: '适应（完整显示）' },
          { value: 'cover', label: '填充（允许裁剪）' },
          { value: 'stretch', label: '拉伸' },
        ]}
        onChange={(fit) => update({ fit })}
      />
      <ToggleRow label="进入时自动播放" checked={node.autoplay} onChange={(autoplay) => update({ autoplay })} />
      <ToggleRow label="循环播放" checked={node.loop} onChange={(loop) => update({ loop })} />
      <ToggleRow label="视频自身静音" checked={node.muted} onChange={(muted) => update({ muted })} />
      <ToggleRow label="点击切换播放/暂停" checked={node.clickToToggle} onChange={(clickToToggle) => update({ clickToToggle })} />
      <ToggleRow label="显示画布播放控件" checked={node.showControls} onChange={(showControls) => update({ showControls })} />
      <RangeField label="视频音量" value={node.volume * 100} min={0} max={100} suffix="%" onChange={(volume) => update({ volume: volume / 100 })} />
      <BufferedInput label="播放速度" type="number" min={0.25} max={4} step={0.25} value={node.playbackRate} onCommit={(playbackRate) => update({ playbackRate: Number(playbackRate) })} />
      <BufferedInput label="开始时间（秒）" type="number" min={0} step={0.1} value={node.startTime} onCommit={(startTime) => update({ startTime: Number(startTime) })} />
      <BufferedInput label="结束时间（秒，0 表示结尾）" type="number" min={0} step={0.1} value={node.endTime ?? 0} onCommit={(endTime) => update({ endTime: Number(endTime) > 0 ? Number(endTime) : null })} />
      <SelectField<VideoNode['backgroundAudioMode']>
        label="播放时背景音乐"
        value={node.backgroundAudioMode}
        options={[
          { value: 'none', label: '不处理' },
          { value: 'duck', label: '自动降低' },
          { value: 'pause', label: '暂停并恢复' },
          { value: 'stop', label: '停止' },
        ]}
        onChange={(backgroundAudioMode) => update({ backgroundAudioMode })}
      />
      {diagnostics.map((message) => (
        <p key={message} className="property-hint" role="alert">{message}</p>
      ))}
      {onOpenAutomation && (
        <button
          type="button"
          className="secondary-button"
          onClick={onOpenAutomation}
        >
          <Workflow size={14} />配置视频规则
        </button>
      )}
      <p className="property-hint">编辑画布只显示视频封面；真实播放请使用“当前位置试运行”或“整课预览”。PDF/PPTX 会静态化为封面。</p>
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
  scenes: readonly SceneDocument[],
): TeacherControllerAction {
  return type === 'scene.go'
    ? { type, sceneId: scenes[0]?.id ?? '' }
    : { type } as TeacherControllerAction
}

function TeacherControllerProperties({ node, scenes, update }: {
  node: TeacherControllerNode
  scenes: readonly SceneDocument[]
  update(patch: DeepPartial<SceneNode>): void
}) {
  const snapshotRevision = useEditorStore((state) => state.slideCandidateSnapshot?.revision ?? 0)
  const layoutPreview = useMemo(() => {
    const backend = selectSlideAuthoringBackend(useEditorStore.getState())
    if (!backend) return null
    const item = findGlobalTeacherController(
      backend.getSession().history.present,
      node.id,
    )
    if (!item || item.content.nativeType !== 'teacher-controller') return null
    return teacherControllerPropertiesPreview(item.content.data, {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    })
  }, [node.height, node.id, node.width, node.x, node.y, snapshotRevision])
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

const SHAPE_LABELS: Record<ShapeType, string> = {
  rectangle: '矩形', 'rounded-rectangle': '圆角矩形', ellipse: '圆形/椭圆', triangle: '三角形', diamond: '菱形', line: '直线',
  'arrow-left': '左箭头', 'arrow-right': '右箭头', 'arrow-up': '上箭头', 'arrow-down': '下箭头', 'arrow-left-right': '双向箭头', 'elbow-arrow': '折线箭头',
  'brace-left': '左大括号', 'brace-right': '右大括号', 'brace-top': '上大括号', 'brace-bottom': '下大括号', 'brace-pair-horizontal': '横向大括号对', 'brace-pair-vertical': '纵向大括号对',
  'bracket-left': '左方括号', 'bracket-right': '右方括号', 'emphasis-dot': '着重圆点', 'emphasis-triangle': '着重三角',
}

function ShapeProperties({ node, update }: { node: ShapeNode; update(patch: DeepPartial<SceneNode>): void }) {
  const style = node.style
  const strokeOnly = isStrokeOnlyShapeType(node.shapeType)
  const supportsArrowHeads = node.shapeType === 'line' || node.shapeType === 'elbow-arrow'
  return (
    <section className="property-section">
      <h3 className="property-title"><Shapes size={14} />图形</h3>
      <SelectField<ShapeType> label="图形类型" value={node.shapeType} options={SHAPE_TYPES.map((value) => ({ value, label: SHAPE_LABELS[value] }))} onChange={(shapeType) => update({ shapeType })} />
      {!strokeOnly && <>
        <ColorInput id="shape-fill" label="填充色" value={style.fillColor} onChange={(fillColor) => update({ style: { fillColor } })} />
        <RangeField
          label="填充透明度"
          value={opacityToTransparencyPercent(style.fillOpacity)}
          min={0}
          max={100}
          suffix="%"
          onChange={(value) => update({
            style: { fillOpacity: transparencyPercentToOpacity(value) },
          })}
        />
      </>}
      <ColorInput id="shape-border" label={strokeOnly ? '线条颜色' : '边框颜色'} value={style.borderColor} onChange={(borderColor) => update({ style: { borderColor } })} />
      <RangeField
        label={strokeOnly ? '线条透明度' : '边框透明度'}
        value={opacityToTransparencyPercent(style.borderOpacity)}
        min={0}
        max={100}
        suffix="%"
        onChange={(value) => update({
          style: { borderOpacity: transparencyPercentToOpacity(value) },
        })}
      />
      <BufferedInput label={strokeOnly ? '线条宽度' : '边框宽度'} type="number" min={0} max={100} value={style.borderWidth} onCommit={(borderWidth) => update({ style: { borderWidth: Number(borderWidth) } })} />
      <SelectField<ShapeLineStyle> label="线型" value={style.lineStyle} options={[{ value: 'solid', label: '实线' }, { value: 'dashed', label: '虚线' }, { value: 'dotted', label: '点线' }]} onChange={(lineStyle) => update({ style: { lineStyle } })} />
      {(node.shapeType === 'rounded-rectangle' || node.shapeType === 'rectangle') && <RangeField label="圆角" value={style.cornerRadius} min={0} max={Math.min(node.width, node.height) / 2} suffix="px" onChange={(cornerRadius) => update({ style: { cornerRadius }, shapeType: cornerRadius > 0 ? 'rounded-rectangle' : 'rectangle' })} />}
      {supportsArrowHeads && <div className="coordinate-grid">
        <SelectField<ArrowHead> label="起点箭头" value={style.startArrow} options={ARROW_OPTIONS} onChange={(startArrow) => update({ style: { startArrow } })} />
        <SelectField<ArrowHead> label="终点箭头" value={style.endArrow} options={ARROW_OPTIONS} onChange={(endArrow) => update({ style: { endArrow } })} />
      </div>}
    </section>
  )
}

const ARROW_OPTIONS: Array<{ value: ArrowHead; label: string }> = [
  { value: 'none', label: '无' }, { value: 'triangle', label: '三角' }, { value: 'stealth', label: '尖角' }, { value: 'circle', label: '圆点' }, { value: 'diamond', label: '菱形' },
]

const ALIGN_ACTIONS: Array<{
  mode: AlignmentMode
  label: string
  icon: typeof AlignHorizontalJustifyStart
}> = [
  { mode: 'left', label: '左对齐', icon: AlignHorizontalJustifyStart },
  { mode: 'center', label: '水平居中', icon: AlignHorizontalJustifyCenter },
  { mode: 'right', label: '右对齐', icon: AlignHorizontalJustifyEnd },
  { mode: 'top', label: '顶对齐', icon: AlignVerticalJustifyStart },
  { mode: 'middle', label: '垂直居中', icon: AlignVerticalJustifyCenter },
  { mode: 'bottom', label: '底对齐', icon: AlignVerticalJustifyEnd },
]

function MultiSelectionProperties({
  nodes,
  presentationContext,
  spatialMode = false,
}: {
  nodes: SceneNode[]
  presentationContext: {
    scene: SceneDocument
    stateId: string | null
  } | null
  spatialMode?: boolean
}) {
  const alignSelection = useEditorStore((state) => state.alignSelection)
  const distributeSelection = useEditorStore((state) => state.distributeSelection)
  const updateNodes = useEditorStore((state) => state.updateNodes)
  const duplicateSelectedNodes = useEditorStore((state) => state.duplicateSelectedNodes)
  const deleteSelectedNodes = useEditorStore((state) => state.deleteSelectedNodes)
  const unlockedCount = nodes.filter((node) => !node.locked).length
  const visibleCount = nodes.filter((node) => node.visible).length
  const applyToAll = (patch: DeepPartial<SceneNode>) => {
    updateNodes(nodes.map((node) => ({ nodeId: node.id, patch })))
  }
  const activeState = presentationContext?.stateId
    ? findPresentationState(
      presentationContext.scene,
      presentationContext.stateId,
    )
    : null
  const overriddenCount = activeState && presentationContext
    ? nodes.filter((node) => isNodeOverriddenInState(
      presentationContext.scene,
      activeState.id,
      node.id,
    )).length
    : 0

  return (
    <div className="properties-scroll" data-testid="properties-tab">
      {presentationContext && (
        <section className={`state-editing-notice${activeState ? ' state-editing-notice--override' : ''}`}>
          <Layers3 size={15} />
          <div>
            <strong>{activeState ? `状态：${activeState.name} · 多选` : '基础场景 · 多选'}</strong>
            <span>{activeState
              ? overriddenCount > 0
                ? `${overriddenCount}/${nodes.length} 个所选元素已有覆盖；批量修改只写入当前状态。`
                : `所选 ${nodes.length} 个元素当前继承基础；批量修改将创建状态覆盖。`
              : '批量修改基础元素会影响所有继承这些值的状态。'}</span>
          </div>
        </section>
      )}
      <section className="property-section multi-selection-summary" data-testid="multi-selection-properties">
        <div className="multi-selection-heading">
          <span className="selection-count">{nodes.length}</span>
          <span>
            <strong>已选择多个图层</strong>
            <small>{visibleCount} 个显示 · {nodes.length - unlockedCount} 个锁定</small>
          </span>
        </div>
        <div className="selection-stat-grid" aria-label="选区尺寸">
          <span><small>左</small>{Math.round(Math.min(...nodes.map((node) => node.x)))}</span>
          <span><small>顶</small>{Math.round(Math.min(...nodes.map((node) => node.y)))}</span>
          <span><small>右</small>{Math.round(Math.max(...nodes.map((node) => node.x + node.width)))}</span>
          <span><small>底</small>{Math.round(Math.max(...nodes.map((node) => node.y + node.height)))}</span>
        </div>
      </section>

      <section className="property-section">
        <h3 className="property-title"><SlidersHorizontal size={14} />对齐与分布</h3>
        <div className="property-action-grid property-action-grid--three">
          {ALIGN_ACTIONS.map(({ mode, label, icon: Icon }) => (
            <button
              type="button"
              className="property-action-button"
              key={mode}
              title={label}
              aria-label={label}
              disabled={unlockedCount < 2}
              onClick={() => alignSelection(mode)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="property-action-grid property-action-grid--two property-action-grid--spaced">
          <button type="button" className="property-action-button" disabled={unlockedCount < 3} onClick={() => distributeSelection('horizontal')}>
            <AlignHorizontalDistributeCenter size={16} /><span>水平等距</span>
          </button>
          <button type="button" className="property-action-button" disabled={unlockedCount < 3} onClick={() => distributeSelection('vertical')}>
            <AlignVerticalDistributeCenter size={16} /><span>垂直等距</span>
          </button>
        </div>
        {unlockedCount !== nodes.length && (
          <p className="property-hint">锁定图层不会参与对齐或分布。</p>
        )}
      </section>

      <section className="property-section">
        <h3 className="property-title"><Layers3 size={14} />批量图层操作</h3>
        <div className="property-action-grid property-action-grid--two">
          <button type="button" className="property-action-button" onClick={() => applyToAll({ visible: true })}><Eye size={16} /><span>全部显示</span></button>
          <button type="button" className="property-action-button" onClick={() => applyToAll({ visible: false })}><EyeOff size={16} /><span>全部隐藏</span></button>
          <button type="button" className="property-action-button" onClick={() => applyToAll({ locked: true })}><Lock size={16} /><span>全部锁定</span></button>
          <button type="button" className="property-action-button" onClick={() => applyToAll({ locked: false })}><Unlock size={16} /><span>全部解锁</span></button>
        </div>
        <div className="button-row property-action-footer">
          <button
            type="button"
            className="secondary-button"
            disabled={spatialMode}
            title={spatialMode ? 'Spatial 多选复制暂未接入原子历史' : undefined}
            onClick={duplicateSelectedNodes}
          ><Copy size={14} />复制所选</button>
          <button
            type="button"
            className="secondary-button secondary-button--danger"
            disabled={spatialMode}
            title={spatialMode ? 'Spatial 多选删除暂未接入原子历史' : undefined}
            onClick={deleteSelectedNodes}
          ><Trash2 size={14} />删除所选</button>
        </div>
        {spatialMode ? (
          <p className="property-hint" data-testid="spatial-multi-actions-unavailable">
            Spatial 多选复制与删除尚未接入一次提交，因此当前不会执行部分写入。
          </p>
        ) : null}
      </section>
    </div>
  )
}

function runtimeSourceSummary(source: string): string {
  const compact = source.replace(/\s+/g, ' ').trim()
  if (!compact) return '空源码'
  return compact.length > 96 ? `${compact.slice(0, 96)}…` : compact
}

type RuntimeInspectorCommitResult =
  | { readonly ok: true; readonly status: 'updated' | 'unchanged' }
  | { readonly ok: false; readonly reason: string }

function RuntimeInspector({
  view,
  scope,
}: {
  view: RuntimeInspectorAuthoringView | null
  scope: 'scene' | 'global'
}) {
  const updateRuntimePropertyAtTarget = useEditorStore(
    (state) => state.updateRuntimePropertyAtTarget,
  )
  const updateRuntimeContentTextAtTarget = useEditorStore(
    (state) => state.updateRuntimeContentTextAtTarget,
  )
  const setStatus = useEditorStore((state) => state.setStatus)
  const setError = useEditorStore((state) => state.setError)
  const [result, setResult] = useState<{
    kind: 'success' | 'error'
    message: string
  } | null>(null)
  const runtimeDocumentKey = view?.documentKey ?? null
  useEffect(() => setResult(null), [runtimeDocumentKey])

  const reportCommit = (
    commit: RuntimeInspectorCommitResult,
    updatedMessage: string,
    unchangedMessage: string,
  ) => {
    if (!commit.ok) {
      setResult({ kind: 'error', message: commit.reason })
      setError(commit.reason)
      setStatus(null)
      return commit
    }
    const message = commit.status === 'updated'
      ? updatedMessage
      : unchangedMessage
    setResult({ kind: 'success', message })
    setError(null)
    setStatus(message)
    return commit
  }

  const title = scope === 'global' ? '全局自定义运行时' : '场景自定义运行时'
  if (!view || view.availability !== 'available') {
    return (
      <section className="property-section" data-testid={`${scope}-runtime-empty`}>
        <h3 className="property-title"><Code2 size={14} />{title}</h3>
        <p className="property-empty">
          {view?.label ?? '当前 Runtime 作者会话不可用'}。运行时代码由 AI 或生成脚本写入工程，编辑器只负责管理和修改登记文案。
        </p>
      </section>
    )
  }

  const renderModeOptions: Array<{
    value: typeof view.renderMode
    label: string
  }> = view.runtimeApiVersion === 3
    ? [{ value: 'dom', label: 'HTML / DOM（API 3 固定）' }]
    : [
        { value: 'phaser', label: 'Phaser 画布' },
        { value: 'dom', label: 'HTML / DOM' },
        { value: 'hybrid', label: '混合渲染' },
      ]
  return (
    <section
      className="property-section runtime-inspector"
      data-testid={`${scope}-runtime-inspector`}
    >
      <h3 className="property-title"><Code2 size={14} />{title}</h3>
      <ToggleRow
        label="启用运行时"
        checked={view.enabled}
        disabled={view.effectiveLocked}
        onChange={(enabled) => reportCommit(
          updateRuntimePropertyAtTarget(
            view.enabledTarget,
            { field: 'enabled', value: enabled },
          ),
          enabled ? '运行时已启用' : '运行时已停用',
          '运行时启用状态没有变化',
        )}
      />
      <SelectField
        label="渲染能力声明"
        value={view.renderMode}
        options={renderModeOptions}
        disabled={view.effectiveLocked || view.runtimeApiVersion === 3}
        onChange={(renderMode) => reportCommit(
          updateRuntimePropertyAtTarget(
            view.renderModeTarget,
            { field: 'renderMode', value: renderMode },
          ),
          '运行时渲染能力声明已更新',
          '运行时渲染能力声明没有变化',
        )}
      />
      <p className="property-hint">
        {view.runtimeApiVersion === 3
          ? 'Surface Runtime / API 3 固定使用 HTML / DOM；编辑器会保留其真实协议与版本。'
          : 'Canvas Runtime / API 2 会按此字段只挂载并暴露声明的能力。修改字段不会转换源码，请确认源码支持新模式。'}
      </p>
      {view.effectiveLocked && (
        <p className="property-hint" role="status">
          当前 Runtime 已锁定，属性与登记文案均为只读。
        </p>
      )}
      {result && (
        <p
          className="property-hint"
          role={result.kind === 'error' ? 'alert' : 'status'}
          data-testid={`${scope}-runtime-result`}
        >
          {result.message}
        </p>
      )}
      <div className="runtime-summary-grid" aria-label="运行时摘要">
        <span><small>运行时协议</small>{view.protocol} · API {view.runtimeApiVersion}</span>
        <span><small>源码体积</small>{(view.sourceBytes / 1024).toFixed(view.sourceBytes >= 1024 ? 1 : 2)} KiB</span>
        <span><small>素材绑定</small>{view.assetCount}</span>
        <span><small>可编辑文案</small>{view.contentFields.length}</span>
        <span><small>静态后备</small>{view.fallback ? '已配置' : '未配置'}</span>
      </div>
      <div className="form-field">
        <label>源码摘要（只读）</label>
        <div className="readonly-value runtime-source-summary">
          {runtimeSourceSummary(view.runtime.source)}
        </div>
      </div>
      {view.fallback && (
        <p className="property-hint">
          静态后备：{view.fallback.coverage === 'scene' ? '整场景' : '整表面'} · {view.fallback.assetId}
        </p>
      )}
      <div className="runtime-content-heading">
        <strong>可编辑文字</strong>
        <span>修改这里只更新 content.values，不会改写源码。</span>
      </div>
      <RuntimeContentEditor
        fields={view.contentFields}
        disabled={view.effectiveLocked}
        onCommit={(target, value) => reportCommit(
          updateRuntimeContentTextAtTarget(target, value),
          `运行时文案“${target.contentKey}”已更新`,
          `运行时文案“${target.contentKey}”没有变化`,
        )}
      />
    </section>
  )
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

function candidateLocationVisibilityLabel(
  location: CourseLocation,
  surfaces: CourseProjectDocument['surfaces'],
): string {
  if (location.kind !== 'slide-scene') return location.label
  const surface = surfaces.find((item) => item.id === location.surfaceId)
  if (!surface || surface.type !== 'slide') return location.label
  const scene = surface.scenes.find((item) => item.id === location.sceneId)
  return scene?.name ?? location.label
}

function CandidateGlobalLayerSettings({ nodeId }: { nodeId: string }) {
  const document = useEditorStore(selectActiveCourseProjectDocument)
    ?? useEditorStore(selectSlideAuthoringDocument)
  const snapshot = useEditorStore(selectSlideAuthoringSnapshot)
  const spatialSession = useEditorStore((state) => state.spatialSession)
  const flowSession = useEditorStore((state) => state.flowSession)
  const locationId = flowSession?.selection.locationId
    ?? spatialSession?.selection.locationId
    ?? snapshot?.locationId
    ?? null
  const entry = document?.globalLayerItems.find(
    (item) => item.item.layerItemId === nodeId,
  )
  const setLocationVisibility = useEditorStore(
    (state) => state.setCandidateGlobalLayerLocationVisibility,
  )
  const setVisibleAtLocation = useEditorStore(
    (state) => state.setCandidateGlobalLayerVisibleAtLocation,
  )
  const updateSettings = useEditorStore(
    (state) => state.updateGlobalLayerSettings,
  )
  const [pendingVisibilityMode, setPendingVisibilityMode] = useState<
    Exclude<LocationVisibility['mode'], 'all'> | null
  >(null)
  useEffect(() => {
    setPendingVisibilityMode(null)
  }, [nodeId, entry?.visibility.mode])
  if (!document || !entry || !locationId) return null

  const setVisibility = (visibility: LocationVisibility) => {
    setLocationVisibility(nodeId, visibility)
  }
  const effectiveVisibilityMode = pendingVisibilityMode ?? entry.visibility.mode
  const selected = new Set(
    pendingVisibilityMode === null ? entry.visibility.locationIds : [],
  )
  const visibleHere = isCourseLayerVisibleAtLocation(entry, locationId)
  const locationKind = document.locations.find((location) => location.id === locationId)?.kind
  const visibilityCopy = candidateGlobalVisibilityCopy(locationKind)
  const scenePlane = readGlobalLayerScenePlane(
    entry.item.order,
    collectSlideSurfaceSceneOrders(document, locationId),
    collectAllCourseLayerOrders(document),
  )

  return (
    <section
      className="property-section global-component-settings"
      data-testid="global-layer-settings"
    >
      <h3 className="property-title"><Globe2 size={14} />全局挂载</h3>
      <ToggleRow
        label="当前页显示"
        checked={visibleHere}
        onChange={(visible) => setVisibleAtLocation(nodeId, visible)}
      />
      <SelectField<RuntimeLayer>
        label="图层位置"
        value={scenePlane}
        options={[
          { value: 'underlay', label: 'Underlay · 场景内容下方' },
          { value: 'overlay', label: 'Overlay · 场景内容上方' },
        ]}
        onChange={(layer) => updateSettings(nodeId, { layer })}
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
          const startsEmpty = entry.visibility.mode === 'all' ||
            entry.visibility.locationIds.length === 0
          if (startsEmpty) {
            setPendingVisibilityMode(mode)
            return
          }
          setPendingVisibilityMode(null)
          setVisibility({ mode, locationIds: entry.visibility.locationIds })
        }}
      />
      {effectiveVisibilityMode !== 'all' && (
        <fieldset className="visibility-scene-list">
          <legend>
            {effectiveVisibilityMode === 'include' ? '显示于' : '隐藏于'}
          </legend>
          {document.locations.map((location) => (
            <label key={location.id}>
              <input
                type="checkbox"
                data-testid={`location-visibility-${location.id}`}
                checked={selected.has(location.id)}
                onChange={(event) => {
                  const locationIds = new Set(
                    pendingVisibilityMode === null
                      ? entry.visibility.locationIds
                      : [],
                  )
                  if (event.target.checked) locationIds.add(location.id)
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
              <span>{candidateLocationVisibilityLabel(location, document.surfaces)}</span>
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

function GlobalLayerSettings({ nodeId }: { nodeId: string }) {
  const candidate = useEditorStore(selectSlideAuthoringBackend)
  const spatialSession = useEditorStore((state) => state.spatialSession)
  const flowSession = useEditorStore((state) => state.flowSession)
  if (candidate || spatialSession || flowSession) return <CandidateGlobalLayerSettings nodeId={nodeId} />
  const placement = useEditorStore((state) =>
    state.project.globalLayer.find((item) => item.node.id === nodeId),
  )
  const scenes = useEditorStore((state) => state.project.scenes)
  const updateSettings = useEditorStore(
    (state) => state.updateGlobalLayerSettings,
  )
  const [pendingVisibilityMode, setPendingVisibilityMode] = useState<
    Exclude<GlobalLayerVisibility['mode'], 'all'> | null
  >(null)
  useEffect(() => {
    setPendingVisibilityMode(null)
  }, [nodeId, placement?.visibility.mode])
  if (!placement) return null

  const setVisibility = (visibility: GlobalLayerVisibility) => {
    updateSettings(nodeId, { visibility })
  }
  const effectiveVisibilityMode = pendingVisibilityMode ?? placement.visibility.mode
  const selected = new Set(
    pendingVisibilityMode === null ? placement.visibility.sceneIds : [],
  )

  return (
    <section
      className="property-section global-component-settings"
      data-testid="global-layer-settings"
    >
      <h3 className="property-title"><Globe2 size={14} />全局挂载</h3>
      <SelectField<RuntimeLayer>
        label="图层位置"
        value={placement.layer}
        options={[
          { value: 'underlay', label: 'Underlay · 场景内容下方' },
          { value: 'overlay', label: 'Overlay · 场景内容上方' },
        ]}
        onChange={(layer) => updateSettings(nodeId, { layer })}
      />
      <SelectField<GlobalLayerVisibility['mode']>
        label="场景可见范围"
        value={effectiveVisibilityMode}
        options={[
          { value: 'all', label: '全部场景' },
          { value: 'include', label: '仅所选场景' },
          { value: 'exclude', label: '除所选场景外' },
        ]}
        onChange={(mode) => {
          if (mode === 'all') {
            setPendingVisibilityMode(null)
            setVisibility({ mode, sceneIds: [] })
            return
          }
          const startsEmpty = placement.visibility.mode === 'all' ||
            placement.visibility.sceneIds.length === 0
          if (startsEmpty) {
            setPendingVisibilityMode(mode)
            return
          }
          setPendingVisibilityMode(null)
          setVisibility({ mode, sceneIds: placement.visibility.sceneIds })
        }}
      />
      {effectiveVisibilityMode !== 'all' && (
        <fieldset className="visibility-scene-list">
          <legend>
            {effectiveVisibilityMode === 'include' ? '显示于' : '隐藏于'}
          </legend>
          {scenes.map((scene) => (
            <label key={scene.id}>
              <input
                type="checkbox"
                checked={selected.has(scene.id)}
                onChange={(event) => {
                  const sceneIds = new Set(
                    pendingVisibilityMode === null
                      ? placement.visibility.sceneIds
                      : [],
                  )
                  if (event.target.checked) sceneIds.add(scene.id)
                  else sceneIds.delete(scene.id)
                  if (sceneIds.size === 0) {
                    if (effectiveVisibilityMode === 'exclude') {
                      setPendingVisibilityMode(null)
                      setVisibility({ mode: 'all', sceneIds: [] })
                    } else {
                      event.currentTarget.checked = true
                    }
                    return
                  }
                  setPendingVisibilityMode(null)
                  setVisibility({
                    mode: effectiveVisibilityMode,
                    sceneIds: [...sceneIds],
                  })
                }}
              />
              <span>{scene.name}</span>
            </label>
          ))}
        </fieldset>
      )}
      {pendingVisibilityMode !== null && (
        <p className="property-hint" role="status">
          选择至少一个场景后，可见范围才会生效。
        </p>
      )}
      <p className="property-hint">
        全局元素只创建一次并跨场景持续存在；切换场景只更新显隐，组件内部状态不会因此重置。
      </p>
    </section>
  )
}

function SpatialPathRelationFields({
  session,
  pageSection,
  selectedPathId,
  selectedRelationId,
}: {
  session: SpatialAuthoringSession
  pageSection?: boolean
  selectedPathId?: string | null
  selectedRelationId?: string | null
}) {
  const runSpatialCommand = useEditorStore((state) => state.runSpatialCommand)
  const surface = session.history.present.surfaces.find(
    (candidate) => candidate.id === session.selection.surfaceId && candidate.type === 'spatial-2d',
  )
  if (!surface || surface.type !== 'spatial-2d') return null
  return (
    <SpatialPathEditor
      surfaceTitle={surface.title}
      worldLayerItems={surface.world.layerItems}
      paths={surface.world.paths ?? []}
      relations={surface.world.relations ?? []}
      pageSection={pageSection}
      selectedPathId={selectedPathId}
      selectedRelationId={selectedRelationId}
      onAddPath={(input) => runSpatialCommand((current) => addSpatialPathInSession(current, input))}
      onRenamePath={(pathId, name) => runSpatialCommand((current) => updateSpatialPathInSession(current, pathId, { name }))}
      onUpdatePathStyle={(pathId, style) => runSpatialCommand((current) => updateSpatialPathInSession(current, pathId, { style }))}
      onReorderPathWaypoints={(pathId, layerItemIds) => runSpatialCommand((current) => reorderSpatialPathWaypointsInSession(current, pathId, layerItemIds))}
      onDeletePath={(pathId) => runSpatialCommand((current) => deleteSpatialPathInSession(current, pathId))}
      onAddRelation={(input) => runSpatialCommand((current) => addSpatialRelationInSession(current, input))}
      onUpdateRelationLabel={(relationId, label) => runSpatialCommand((current) => updateSpatialRelationInSession(current, relationId, { label }))}
      onUpdateRelationKind={(relationId, kind) => runSpatialCommand((current) => updateSpatialRelationInSession(current, relationId, { kind }))}
      onDeleteRelation={(relationId) => runSpatialCommand((current) => deleteSpatialRelationInSession(current, relationId))}
    />
  )
}

function SpatialPageProperties({ session }: { session: SpatialAuthoringSession }) {
  const runSpatialCommand = useEditorStore((state) => state.runSpatialCommand)
  const setActiveScene = useEditorStore((state) => state.setActiveScene)
  const playbackPathId = useEditorStore((state) => state.spatialPlaybackPathId)
  const setSpatialPlaybackPathId = useEditorStore((state) => state.setSpatialPlaybackPathId)
  const view = buildSpatialEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
  })
  const surface = session.history.present.surfaces.find(
    (candidate) => candidate.id === session.selection.surfaceId && candidate.type === 'spatial-2d',
  )
  if (!surface || surface.type !== 'spatial-2d') return null
  return (
    <>
      <section className="property-section" data-testid="spatial-page-properties">
        <h3 className="property-title"><Palette size={14} />空间画布</h3>
        <ColorInput
          id="spatial-canvas-background"
          data-testid="spatial-canvas-background"
          label="画布背景色"
          value={resolveCourseSurfaceBackgroundColor(surface.backgroundColor)}
          onChange={(backgroundColor) => runSpatialCommand((current) => updateSpatialSurfaceBackgroundColor(current, backgroundColor))}
        />
      </section>
      <SpatialCameraPanel
        surfaceTitle={view.surfaceTitle}
        frames={[...view.camera.frames]}
        home={view.camera.home}
        sessionCamera={session.sessionCamera}
        activeCameraFrameId={view.camera.activeFrameId}
        showCameraFrames={session.showCameraFrames}
        worldLayerItems={surface.world.layerItems}
        paths={surface.world.paths ?? []}
        playbackPathId={playbackPathId}
        semanticZoomRules={surface.semanticZoom}
        sessionCameraLabel={`${Math.round(session.sessionCamera.zoom * 100)}%`}
        onShowCameraFramesChange={(show) => {
          runSpatialCommand((current) => setSpatialShowCameraFrames(current, show))
        }}
        onAddFrame={() => runSpatialCommand((current) => addSpatialCameraFrameFromSession(current), {
          statusMessage: '已添加镜头',
        })}
        onRenameFrame={(frameId, name) => runSpatialCommand((current) => renameSpatialCameraFrameInSession(current, frameId, name))}
        onReorderFrame={(frameId, toIndex) => runSpatialCommand((current) => reorderSpatialCameraFramesInSession(current, frameId, toIndex))}
        onDeleteFrame={(frameId) => runSpatialCommand((current) => deleteSpatialCameraFrameInSession(current, frameId))}
        onSetHome={() => runSpatialCommand((current) => setSpatialCameraHomeFromSession(current))}
        onUpdateActiveFromSession={() => runSpatialCommand((current) => updateActiveSpatialCameraFrameFromSession(current))}
        onActivateFrame={(frameId) => setActiveScene(frameId)}
        onFitWorldContent={() => runSpatialCommand((current) => fitSpatialSessionToWorldContent(current, {
          viewportWidth: CANVAS_WIDTH,
          viewportHeight: CANVAS_HEIGHT,
        }))}
        onPlaybackPathIdChange={setSpatialPlaybackPathId}
        onAddSemanticZoomRule={(rule) => runSpatialCommand((current) => addSpatialSemanticZoomRuleInSession(current, rule))}
        onUpdateSemanticZoomRule={(ruleId, patch) => runSpatialCommand((current) => updateSpatialSemanticZoomRuleInSession(current, ruleId, patch))}
        onDeleteSemanticZoomRule={(ruleId) => runSpatialCommand((current) => deleteSpatialSemanticZoomRuleInSession(current, ruleId))}
      />
      <SpatialPathRelationFields session={session} pageSection />
    </>
  )
}

function selectedFlowBlock(session: FlowAuthoringSession): FlowBlock | null {
  const blockId = session.selection.selectedBlockId
  if (!blockId) return null
  try {
    return findFlowBlockRecursive(
      flowSurfaceIn(session.history.present, session.selection.surfaceId).blocks,
      blockId,
    )?.block ?? null
  } catch {
    return null
  }
}

function uniformFlowFormatValue<T>(field: FlowSelectionFormatField<T>): T | undefined {
  return field.state === 'uniform' ? field.value : undefined
}

function flowFormatFieldDescription<T>(
  label: string,
  field: FlowSelectionFormatField<T>,
): string {
  if (field.state === 'mixed') return `${label}：混合`
  if (field.state === 'unset') return `${label}：默认`
  return `${label}：${String(field.value)}`
}

function FlowPageProperties({ session }: { session: FlowAuthoringSession }) {
  const renameFlowPage = useEditorStore((state) => state.renameFlowPage)
  const applyFlowCommand = useEditorStore((state) => state.applyFlowCommand)
  const surface = session.history.present.surfaces.find(
    (candidate) => candidate.id === session.selection.surfaceId && candidate.type === 'flow',
  )
  if (!surface || surface.type !== 'flow') return null
  return (
    <section className="property-section" data-testid="flow-page-properties">
      <h3 className="property-title"><Type size={14} />流式页面</h3>
      <BufferedInput
        label="页面标题"
        value={surface.title}
        onCommit={(title) => renameFlowPage(surface.id, title)}
      />
      <ColorInput
        id="flow-paper-background"
        data-testid="flow-paper-background"
        label="稿纸背景色"
        value={resolveCourseSurfaceBackgroundColor(surface.backgroundColor)}
        onChange={(backgroundColor) => {
          const result = updateFlowSurfaceBackgroundColor(
            session.history.present,
            surface.id,
            backgroundColor,
            { expectedRevision: session.history.present.revision },
          )
          applyFlowCommand(result, { statusMessage: '已修改稿纸背景色' })
        }}
      />
      <p className="property-hint">
        标题和段落在稿纸里编辑。这里只改页面名称与稿纸底色，不会出现 1280×720 场景背景。
      </p>
    </section>
  )
}

const FLOW_MEDIA_KIND_LABEL: Record<FlowMediaBlock['mediaKind'], string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
}

function FlowMediaBlockProperties({
  session,
  block,
}: {
  session: FlowAuthoringSession
  block: FlowMediaBlock
}) {
  const applyFlowCommand = useEditorStore((state) => state.applyFlowCommand)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const document = session.history.present
  const asset = document.assets[block.assetId]
  const sameKindAssets = Object.values(document.assets).filter((candidate) => candidate.kind === block.mediaKind)
  const patchMedia = (patch: Partial<Pick<FlowMediaBlock, 'altText' | 'caption' | 'layout' | 'wrap'>>) => {
    const target = flowBlockTargetFromSelection(document, session.selection)
    applyFlowCommand(updateFlowEditorBlock(document, target, patch, {
      expectedRevision: document.revision,
    }))
  }
  return (
    <section className="property-section" data-testid="flow-media-properties">
      <h3 className="property-title"><ImageIcon size={14} />媒体块</h3>
      <p className="property-hint">
        {FLOW_MEDIA_KIND_LABEL[block.mediaKind]}
        {asset?.filename ? ` · ${asset.filename}` : ''}
      </p>
      {block.mediaKind === 'image' ? (
        <BufferedInput
          label="替代文本"
          value={block.altText ?? ''}
          onCommit={(altText) => patchMedia({ altText })}
        />
      ) : null}
      <BufferedInput
        label="题注"
        value={block.caption ?? ''}
        onCommit={(caption) => patchMedia({ caption })}
      />
      <SelectField<FlowMediaBlock['layout']>
        label="版式"
        value={block.layout}
        options={[
          { value: 'content-width', label: '正文宽' },
          { value: 'wide', label: '较宽' },
          { value: 'full-width', label: '全宽' },
        ]}
        onChange={(layout) => patchMedia({ layout })}
      />
      <div data-testid="flow-media-wrap">
        <SelectField<'none' | 'left' | 'right'>
          label="文字环绕"
          value={block.wrap ?? 'none'}
          options={[
            { value: 'none', label: '不环绕（独占一行）' },
            { value: 'left', label: '居左环绕' },
            { value: 'right', label: '居右环绕' },
          ]}
          onChange={(wrap) => patchMedia({ wrap })}
        />
      </div>
      <div data-testid="flow-replace-media">
        <SelectField
          label="替换素材"
          value={block.assetId}
          options={sameKindAssets.map((candidate) => ({
            value: candidate.id,
            label: candidate.filename || candidate.id,
          }))}
          onChange={(assetId) => {
            const target = flowBlockTargetFromSelection(document, session.selection)
            applyFlowCommand(replaceFlowMediaBlockAsset(document, target, assetId, {
              expectedRevision: document.revision,
            }))
          }}
        />
      </div>
      <input
        ref={fileInputRef}
        type="file"
        hidden
        data-testid="flow-replace-media-file"
        accept={block.mediaKind === 'image' ? 'image/*' : block.mediaKind === 'video' ? 'video/*' : 'audio/*'}
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (!file) return
          try {
            const bytes = new Uint8Array(await file.arrayBuffer())
            const imported = block.mediaKind === 'image'
              ? createImageAssetImport({
                  name: file.name,
                  mimeType: file.type || 'image/png',
                  bytes,
                })
              : createMediaAssetImport(
                  { name: file.name, mimeType: file.type, bytes },
                  block.mediaKind,
                  { duration: 0 },
                )
            const target = flowBlockTargetFromSelection(document, session.selection)
            const files = useEditorStore.getState().slideCandidateSidecar?.files ?? {}
            applyFlowCommand(
              importAndReplaceFlowMediaBlock(document, target, imported.meta, {
                expectedRevision: document.revision,
              }),
              {
                sidecar: freezeCourseAssetSidecar({
                  ...files,
                  [imported.meta.id]: imported.bytes,
                }),
              },
            )
          } catch (error) {
            useEditorStore.setState({
              errorMessage: error instanceof Error ? error.message : '无法替换素材',
              statusMessage: null,
            })
          }
        }}
      />
      <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()}>
        从文件替换…
      </button>
      <div className="property-button-row">
        <button
          type="button"
          className="secondary-button"
          data-testid="flow-block-move-up"
          onClick={() => {
            const surface = flowSurfaceIn(document, session.selection.surfaceId)
            const found = findFlowBlockRecursive(surface.blocks, block.id)
            if (!found) return
            applyFlowCommand(
              executeFlowEditorCommand(
                document,
                session.selection,
                {
                  name: 'move',
                  destination: {
                    parentId: found.parentId,
                    index: Math.max(0, found.index - 1),
                    surfaceId: session.selection.surfaceId,
                  },
                },
                { expectedRevision: document.revision },
              ),
            )
          }}
        >
          上移
        </button>
        <button
          type="button"
          className="secondary-button"
          data-testid="flow-block-move-down"
          onClick={() => {
            const surface = flowSurfaceIn(document, session.selection.surfaceId)
            const found = findFlowBlockRecursive(surface.blocks, block.id)
            if (!found) return
            const maxIndex = found.parentId
              ? (findFlowBlockRecursive(surface.blocks, found.parentId)?.block as { blocks?: FlowBlock[] })?.blocks?.length ?? found.index + 1
              : surface.blocks.length
            applyFlowCommand(
              executeFlowEditorCommand(
                document,
                session.selection,
                {
                  name: 'move',
                  destination: {
                    parentId: found.parentId,
                    index: Math.min(maxIndex, found.index + 1),
                    surfaceId: session.selection.surfaceId,
                  },
                },
                { expectedRevision: document.revision },
              ),
            )
          }}
        >
          下移
        </button>
      </div>
      <button
        type="button"
        className="secondary-button"
        data-testid="flow-block-to-overlay"
        onClick={() => {
          applyFlowCommand(
            convertFlowMediaBlockToOverlay(document, session.selection, {
              expectedRevision: document.revision,
            }),
          )
        }}
      >
        转为浮层
      </button>
      <button
        type="button"
        className="secondary-button"
        data-testid="flow-delete-media-block"
        onClick={() => applyFlowCommand(
          executeFlowEditorCommand(document, session.selection, { name: 'delete' }, {
            expectedRevision: document.revision,
          }),
        )}
      >
        <Trash2 size={14} />删除此块
      </button>
    </section>
  )
}

function FlowBlockProperties({ session }: { session: FlowAuthoringSession }) {
  const block = selectedFlowBlock(session)
  const applyFlowCommand = useEditorStore((state) => state.applyFlowCommand)
  const formatFlowBlock = useEditorStore((state) => state.formatFlowBlock)
  const formatFlowTextStyle = useEditorStore((state) => state.formatFlowTextStyle)
  const flowTextEdit = useEditorStore((state) => state.flowTextEdit)
  if (!block) {
    return (
      <div className="properties-scroll" data-testid="properties-tab">
        <FlowPageProperties session={session} />
      </div>
    )
  }

  const document = session.history.present
  const selectionFormat = deriveFlowSelectionFormat({
    block,
    edit: flowTextEdit?.blockId === block.id ? flowTextEdit : null,
  })
  const formatDisabled = !selectionFormat.canApplyInlineStyle
  const formatScopeTitle = selectionFormat.mode === 'caret'
    ? '插入点格式'
    : selectionFormat.mode === 'range'
      ? '选区格式'
      : '整块格式'
  const formatScopeHint = selectionFormat.mode === 'caret'
    ? '当前显示插入点格式。选择文字后应用；这里不创建待输入样式。'
    : selectionFormat.mode === 'range'
      ? selectionFormat.hasMixedValue
        ? '选区包含混合格式；修改会统一所选文字。'
        : '修改只应用到当前选中的文字。'
      : '未进入文字选区；修改会应用到整个文字块。'
  const fontFamilyField = selectionFormat.fields.fontFamily
  const fontSizeField = selectionFormat.fields.fontSize
  const colorField = selectionFormat.fields.color
  const boldField = selectionFormat.fields.bold
  const italicField = selectionFormat.fields.italic
  const boldActive = uniformFlowFormatValue(boldField) === true
  const italicActive = uniformFlowFormatValue(italicField) === true

  const patchBlockLayout = (patch: { textAlign?: 'left' | 'center' | 'right'; lineSpacing?: number }) => {
    const target = flowBlockTargetFromSelection(document, session.selection)
    applyFlowCommand(updateFlowEditorBlock(document, target, patch, {
      expectedRevision: document.revision,
    }))
  }

  return (
    <div className="properties-scroll" data-testid="properties-tab">
      <section className="property-section" data-testid="flow-block-properties">
        <h3 className="property-title"><Type size={14} />块结构</h3>
        {block.type === 'heading' || block.type === 'paragraph' || block.type === 'quote' ? (
          <>
          <div data-testid="flow-block-type">
            <SelectField
              label="块类型"
              value={block.type === 'heading' ? `${block.level}` : block.type === 'paragraph' ? 'paragraph' : 'quote'}
              options={[
                { value: 'paragraph', label: '段落' },
                { value: 'quote', label: '引用' },
                { value: '1', label: '一级标题' },
                { value: '2', label: '二级标题' },
                { value: '3', label: '三级标题' },
                { value: '4', label: '四级标题' },
                { value: '5', label: '五级标题' },
                { value: '6', label: '六级标题' },
              ]}
              onChange={(value) => {
                if (value === 'paragraph') {
                  formatFlowBlock({ kind: 'convert-paragraph' })
                } else if (value === 'quote') {
                  formatFlowBlock({ kind: 'convert-quote' })
                } else if (value === '1' || value === '2' || value === '3' || value === '4' || value === '5' || value === '6') {
                  formatFlowBlock({
                    kind: 'convert-heading',
                    level: Number(value) as 1 | 2 | 3 | 4 | 5 | 6,
                  })
                }
              }}
            />
          </div>
            <div data-testid="flow-block-align">
              <SelectField<'left' | 'center' | 'right'>
                label="对齐方式"
                value={('textAlign' in block && block.textAlign) ? block.textAlign : 'left'}
                options={[
                  { value: 'left', label: '左对齐' },
                  { value: 'center', label: '居中' },
                  { value: 'right', label: '右对齐' },
                ]}
                onChange={(textAlign) => patchBlockLayout({ textAlign })}
              />
            </div>
            <div data-testid="flow-block-line-spacing">
              <BufferedInput
                label="行距"
                type="number"
                min={0}
                max={200}
                value={('lineSpacing' in block && typeof block.lineSpacing === 'number') ? block.lineSpacing : ''}
                onCommit={(value) => {
                  const lineSpacing = value === '' ? undefined : Number(value)
                  patchBlockLayout({ lineSpacing })
                }}
              />
            </div>
          </>
        ) : null}
        {block.type === 'component' ? (
          <>
            <div className="property-button-row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="secondary-button"
                data-testid="flow-block-move-up"
                onClick={() => {
                  const surface = flowSurfaceIn(session.history.present, session.selection.surfaceId)
                  const found = findFlowBlockRecursive(surface.blocks, block.id)
                  if (!found) return
                  applyFlowCommand(
                    executeFlowEditorCommand(
                      session.history.present,
                      session.selection,
                      {
                        name: 'move',
                        destination: {
                          parentId: found.parentId,
                          index: Math.max(0, found.index - 1),
                          surfaceId: session.selection.surfaceId,
                        },
                      },
                      { expectedRevision: session.history.present.revision },
                    ),
                  )
                }}
              >
                上移
              </button>
              <button
                type="button"
                className="secondary-button"
                data-testid="flow-block-move-down"
                onClick={() => {
                  const surface = flowSurfaceIn(session.history.present, session.selection.surfaceId)
                  const found = findFlowBlockRecursive(surface.blocks, block.id)
                  if (!found) return
                  const maxIndex = found.parentId
                    ? (findFlowBlockRecursive(surface.blocks, found.parentId)?.block as { blocks?: FlowBlock[] })?.blocks?.length ?? found.index + 1
                    : surface.blocks.length
                  applyFlowCommand(
                    executeFlowEditorCommand(
                      session.history.present,
                      session.selection,
                      {
                        name: 'move',
                        destination: {
                          parentId: found.parentId,
                          index: Math.min(maxIndex, found.index + 1),
                          surfaceId: session.selection.surfaceId,
                        },
                      },
                      { expectedRevision: session.history.present.revision },
                    ),
                  )
                }}
              >
                下移
              </button>
              <button
                type="button"
                className="secondary-button"
                data-testid="flow-block-to-overlay"
                onClick={() => {
                  applyFlowCommand(
                    convertFlowComponentBlockToOverlay(session.history.present, session.selection, {
                      expectedRevision: session.history.present.revision,
                    }),
                  )
                }}
              >
                转为浮层
              </button>
            </div>
            <div data-testid="flow-component-wrap">
              <SelectField<'none' | 'left' | 'right'>
                label="文字环绕"
                value={block.wrap ?? 'none'}
                options={[
                  { value: 'none', label: '不环绕（独占一行）' },
                  { value: 'left', label: '居左环绕' },
                  { value: 'right', label: '居右环绕' },
                ]}
                onChange={(wrap) => {
                  const target = flowBlockTargetFromSelection(document, session.selection)
                  applyFlowCommand(updateFlowEditorBlock(document, target, { wrap }, {
                    expectedRevision: document.revision,
                  }))
                }}
              />
            </div>
          </>
        ) : null}
        {block.type === 'list' ? (
          <ToggleRow
            label="有序列表"
            checked={block.ordered}
            onChange={(ordered) => formatFlowBlock({ kind: 'list-ordered', ordered })}
          />
        ) : null}
        {block.type === 'media' || block.type === 'formula' ? null : (
          <p className="property-hint">改正文请在稿纸里双击就地编辑，不要在这里整段替换。</p>
        )}
      </section>
      {block.type === 'media' ? (
        <FlowMediaBlockProperties session={session} block={block} />
      ) : null}
      {block.type === 'formula' ? (
        <FlowFormulaBlockProperties session={session} />
      ) : null}
      {selectionFormat.richText ? (
        <section
          className="property-section"
          data-testid="flow-selection-format-properties"
          data-flow-selection-preserving-target="true"
          data-flow-format-mode={selectionFormat.mode}
          data-format-state={selectionFormat.hasMixedValue ? 'mixed' : 'resolved'}
        >
          <h3 className="property-title" data-testid="flow-selection-format-title">
            <Type size={14} />{formatScopeTitle}
          </h3>
          <p className="property-hint" data-testid="flow-selection-format-hint">
            {formatScopeHint}
          </p>
          <fieldset
            disabled={formatDisabled}
            title={formatDisabled ? '选择文字后应用' : undefined}
            style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
          >
            <div
              data-testid="flow-font-family-state"
              data-format-state={fontFamilyField.state}
              aria-label={flowFormatFieldDescription('字体', fontFamilyField)}
            >
              <FontFamilyPicker
                value={uniformFlowFormatValue(fontFamilyField) ?? ''}
                placeholder={fontFamilyField.state === 'mixed' ? '混合字体' : '默认字体'}
                onCommit={(fontFamily) => formatFlowTextStyle({ fontFamily })}
              />
            </div>
            <div
              data-testid="flow-font-size"
              data-format-state={fontSizeField.state}
              aria-label={flowFormatFieldDescription('字号', fontSizeField)}
            >
              <BufferedInput
                label="字号"
                type="number"
                min={8}
                max={400}
                value={uniformFlowFormatValue(fontSizeField) ?? ''}
                placeholder={fontSizeField.state === 'mixed' ? '混合' : '默认'}
                onCommit={(value) => {
                  const fontSize = value === '' ? undefined : Number(value)
                  formatFlowTextStyle({ fontSize })
                }}
              />
            </div>
            <div className="property-button-row">
              <button
                type="button"
                className={`secondary-button${boldActive ? ' secondary-button--active' : ''}`}
                data-testid="flow-format-bold"
                data-format-state={boldField.state}
                aria-pressed={boldField.state === 'mixed' ? 'mixed' : boldActive}
                title={flowFormatFieldDescription('粗体', boldField)}
                onClick={() => formatFlowTextStyle({ bold: !boldActive })}
              >
                <Bold size={14} />粗体
              </button>
              <button
                type="button"
                className={`secondary-button${italicActive ? ' secondary-button--active' : ''}`}
                data-testid="flow-format-italic"
                data-format-state={italicField.state}
                aria-pressed={italicField.state === 'mixed' ? 'mixed' : italicActive}
                title={flowFormatFieldDescription('斜体', italicField)}
                onClick={() => formatFlowTextStyle({ italic: !italicActive })}
              >
                <Italic size={14} />斜体
              </button>
            </div>
            <div
              data-testid="flow-text-color-state"
              data-format-state={colorField.state}
              aria-label={flowFormatFieldDescription('文字颜色', colorField)}
            >
              <ColorInput
                id="flow-text-color"
                label="文字颜色"
                value={uniformFlowFormatValue(colorField) ?? FLOW_PAPER_TEXT_COLOR}
                onChange={(color) => formatFlowTextStyle({ color })}
              />
            </div>
          </fieldset>
        </section>
      ) : null}
    </div>
  )
}

function FlowOverlayProperties({ session }: { session: FlowAuthoringSession }) {
  const applyFlowCommand = useEditorStore((state) => state.applyFlowCommand)
  const document = session.history.present
  const overlayId = session.selection.selectedOverlayIds[0]
  if (!overlayId) return null
  const located = locateCourseLayer(document, overlayId)
  if (!located) return null
  const item = located.item
  const paperSpaceField = item.kind === 'native' && item.content.nativeType === 'teacher-controller'
    ? null
    : (
      <div data-testid="flow-overlay-paper-space">
        <SelectField<'viewport' | 'paper'>
          label="定位空间"
          value={item.paperSpace === 'paper' ? 'paper' : 'viewport'}
          options={[
            { value: 'viewport', label: '钉在视口' },
            { value: 'paper', label: '跟随稿纸滚动' },
          ]}
          onChange={(paperSpace) => {
            applyFlowCommand(
              patchFlowOverlayPaperSpace(document, session.selection, paperSpace, {
                expectedRevision: document.revision,
              }),
            )
          }}
        />
      </div>
    )

  if (item.kind === 'native' && item.content.nativeType === 'formula') {
    const ast = item.content.data.ast
    const accessibleText = item.content.data.accessibleText ?? formulaAstToAccessibleText(ast)
    const node: FormulaNode = {
      id: overlayId,
      name: item.label || '公式',
      type: 'formula',
      x: item.frame.x,
      y: item.frame.y,
      width: item.frame.width,
      height: item.frame.height,
      rotation: item.rotation,
      opacity: item.opacity,
      visible: item.visible,
      locked: item.locked,
      playbackInitialVisibility: item.playbackInitialVisibility,
      ast,
      accessibleText,
      formulaId: item.content.data.formulaId,
      style: item.content.data.style,
    }
    return (
      <div className="properties-scroll" data-testid="properties-tab">
        <section className="property-section" data-testid="flow-formula-properties">
          <h3 className="property-title">公式</h3>
          <FormulaAuthoringEditor
            node={node}
            onCommit={(committedAst, committedAccessibleText) => {
              applyFlowCommand(
                commitFlowOverlayFormulaAst(
                  document,
                  session.selection,
                  committedAst,
                  committedAccessibleText,
                  { expectedRevision: document.revision },
                ),
              )
            }}
          />
          {paperSpaceField}
        </section>
      </div>
    )
  }

  if (item.kind === 'native' && (item.content.nativeType === 'image' || item.content.nativeType === 'video')) {
    return (
      <div className="properties-scroll" data-testid="properties-tab">
        <section className="property-section" data-testid="flow-overlay-media-properties">
          <h3 className="property-title">浮层媒体</h3>
          {paperSpaceField}
          <button
            type="button"
            className="secondary-button"
            data-testid="flow-overlay-to-document"
            onClick={() => {
              applyFlowCommand(
                convertFlowOverlayMediaToDocument(document, session.selection, {
                  expectedRevision: document.revision,
                }),
              )
            }}
          >
            转回正文
          </button>
        </section>
      </div>
    )
  }

  if (item.kind === 'component') {
    return (
      <div className="properties-scroll" data-testid="properties-tab">
        <section className="property-section" data-testid="flow-overlay-component-properties">
          <h3 className="property-title">浮层组件</h3>
          {paperSpaceField}
          <button
            type="button"
            className="secondary-button"
            data-testid="flow-overlay-to-document"
            onClick={() => {
              applyFlowCommand(
                convertFlowOverlayComponentToDocument(document, session.selection, {
                  expectedRevision: document.revision,
                }),
              )
            }}
          >
            转回正文
          </button>
        </section>
      </div>
    )
  }

  return null
}

export function PropertiesTab({ onReplaceImage }: { onReplaceImage(): void }) {
  const flowSession = useEditorStore((state) => state.flowSession)
  if (
    flowSession
    && flowSession.selection.authoringScope !== 'global'
    && flowSession.selection.focus !== 'overlay'
    && flowSession.selection.selectedBlockId
  ) {
    return <FlowBlockProperties session={flowSession} />
  }
  if (
    flowSession
    && flowSession.selection.authoringScope !== 'global'
    && flowSession.selection.focus === 'overlay'
    && flowSession.selection.selectedOverlayIds.length > 0
  ) {
    return <FlowOverlayProperties session={flowSession} />
  }
  return <PropertiesTabContent onReplaceImage={onReplaceImage} />
}

function PropertiesTabContent({ onReplaceImage }: { onReplaceImage(): void }) {
  const flowSession = useEditorStore((state) => state.flowSession)
  const scene = useEditorStore(selectActiveScene)
  const editingScope = useEditorStore((state) => state.editingScope)
  const editorMode = useEditorStore((state) => state.editorMode)
  const activePresentationStateId = useEditorStore(
    (state) => state.activePresentationStateId,
  )
  const courseProject = useEditorStore(selectActiveCourseProjectDocument)
  const activeCourseLocationId = useEditorStore(selectActiveCourseLocationId)
  const courseAuthoringSession = useEditorStore(
    (state) => state.courseAuthoringSession,
  )
  const editingNodes = useEditorStore(selectEditingNodes)
  const node = useEditorStore(selectSelectedNode)
  const spatialSession = useEditorStore((state) => state.spatialSession)
  const spatialGraphSelection = useEditorStore((state) => state.spatialGraphSelection)
  const selectedNodeIds = useEditorStore((state) => state.selectedNodeIds)
  const selectedNodes = editingNodes.filter((item) => selectedNodeIds.includes(item.id))
  const components = useEditorStore((state) => state.componentPackages)
  const project = useEditorStore((state) => state.project)
  const candidateGlobalLayerItems = useEditorStore(selectCandidateGlobalLayerItems)
  const globalLayerCount = candidateGlobalLayerItems?.length ?? project.globalLayer.length
  const projectAssets = project.assets
  const projectDiagnostics = useMemo(
    () => collectProjectDiagnostics(project),
    [project],
  )
  const updateScene = useEditorStore((state) => state.updateScene)
  const updateNode = useEditorStore((state) => state.updateNode)
  const addInteractionRule = useEditorStore((state) => state.addInteractionRule)
  const updateInteractionRule = useEditorStore((state) => state.updateInteractionRule)
  const deleteInteractionRule = useEditorStore((state) => state.deleteInteractionRule)
  const addGlobalInteractionRule = useEditorStore((state) => state.addGlobalInteractionRule)
  const updateGlobalInteractionRule = useEditorStore((state) => state.updateGlobalInteractionRule)
  const deleteGlobalInteractionRule = useEditorStore((state) => state.deleteGlobalInteractionRule)
  const updatePlayback = useEditorStore((state) => state.updatePlayback)
  const updateDesignTokens = useEditorStore((state) => state.updateDesignTokens)
  const ensureTeacherController = useEditorStore((state) => state.ensureTeacherController)
  const setEditorMode = useEditorStore((state) => state.setEditorMode)
  const setActiveTab = useEditorStore((state) => state.setActiveTab)
  const clearNodePresentationOverride = useEditorStore(
    (state) => state.clearNodePresentationOverride,
  )
  const activeCourseLocation = courseProject?.locations.find(
    (location) => location.id === activeCourseLocationId,
  )
  const runtimeInspectorView = useMemo<RuntimeInspectorAuthoringView | null>(() => {
    if (!courseProject || !activeCourseLocationId || !courseAuthoringSession) {
      return null
    }
    const currentAuthoringSession = updateCourseAuthoringSessionRevision(
      courseAuthoringSession,
      courseProject.revision,
    )
    return selectRuntimeInspectorAuthoringView({
      project: courseProject,
      locationId: activeCourseLocationId,
      editingScope,
      activeStateId: activeCourseLocation?.kind === 'slide-scene'
        ? activePresentationStateId
        : null,
      sessionToken: currentAuthoringSession.token,
    })
  }, [
    activeCourseLocation?.kind,
    activeCourseLocationId,
    activePresentationStateId,
    courseAuthoringSession,
    courseProject,
    editingScope,
  ])
  const effectiveScene = materializeScene(scene, activePresentationStateId)
  const activePresentationState = activePresentationStateId === null
    ? null
    : findPresentationState(scene, activePresentationStateId)
  if (selectedNodes.length > 1) {
    return (
      <MultiSelectionProperties
        nodes={selectedNodes}
        spatialMode={Boolean(spatialSession)}
        presentationContext={editingScope === 'scene'
          ? { scene, stateId: activePresentationStateId }
          : null}
      />
    )
  }
  if (editingScope !== 'global' && spatialSession && spatialGraphSelection) {
    return (
      <div className="properties-scroll" data-testid="properties-tab">
        <SpatialPathRelationFields
          session={spatialSession}
          selectedPathId={spatialGraphSelection.kind === 'path' ? spatialGraphSelection.id : null}
          selectedRelationId={spatialGraphSelection.kind === 'relation' ? spatialGraphSelection.id : null}
        />
      </div>
    )
  }
  if (!node) {
    return (
      <div className="properties-scroll" data-testid="properties-tab">
        {editingScope === 'global' ? (
          <>
            <section className="property-section global-layer-summary">
              <h3 className="property-title"><Globe2 size={14} />全局层</h3>
              <div className="runtime-summary-grid" aria-label="全局层摘要">
                <span><small>全局元素</small>{globalLayerCount}</span>
                <span><small>Underlay</small>{project.globalLayer.filter((item) => item.layer === 'underlay').length}</span>
                <span><small>Overlay</small>{
                  candidateGlobalLayerItems
                    ? globalLayerCount
                    : project.globalLayer.filter((item) => item.layer === 'overlay').length
                }</span>
                <span><small>运行时</small>{runtimeInspectorView?.availability === 'available' ? '已配置' : '无'}</span>
              </div>
              <p className="property-hint">
                全局层类似课件母版：文字、图片、图形和组件都可统一布置，并可设置场景可见范围。
              </p>
            </section>
            <section className="property-section">
              <h3 className="property-title"><SlidersHorizontal size={14} />成品控制</h3>
              <SelectField<ProjectDocument['playback']['controls']>
                label="导航控制方式"
                value={project.playback.controls}
                options={[
                  { value: 'canvas', label: '画布内全局控制器（推荐）' },
                  { value: 'none', label: '不显示控制器' },
                ]}
                onChange={(controls) => {
                  if (controls === 'canvas') ensureTeacherController()
                  else updatePlayback({ controls })
                }}
              />
              <p className="property-hint">
                选择“不显示控制器”会保留可编辑节点，但在交付播放时将其初始隐藏。
              </p>
              {project.playback.controls === 'none' &&
                project.globalLayer.some((item) => item.node.type === 'teacher-controller') && (
                <div
                  className="property-hint"
                  data-testid="controller-consistency-notice"
                  role="status"
                >
                  画布教师控制器已从成品中隐藏。如果需要恢复，请使用下方按钮一键修复其可见性与控制模式。
                </div>
              )}
              <ToggleRow label="键盘左右键翻页" checked={project.playback.keyboardNavigation} onChange={(keyboardNavigation) => updatePlayback({ keyboardNavigation })} />
              <PresenterSettingsEditor
                value={project.playback.presenter}
                onChange={(presenter) => updatePlayback({ presenter })}
              />
              <button type="button" className="secondary-button" onClick={ensureTeacherController}>
                <SlidersHorizontal size={14} />{project.playback.controls === 'none'
                  ? '恢复并显示教师控制器'
                  : '添加或定位教师控制器'}
              </button>
            </section>
            {editorMode === 'professional' && (
              <DesignTokensEditor
                value={project.designTokens}
                onChange={updateDesignTokens}
              />
            )}
            {editorMode === 'professional' && (
              <RuntimeInspector
                scope="global"
                view={runtimeInspectorView}
              />
            )}
          </>
        ) : flowSession ? (
          <FlowPageProperties session={flowSession} />
        ) : spatialSession ? (
          <SpatialPageProperties session={spatialSession} />
        ) : (
          <>
            <section className={`state-editing-notice${activePresentationState ? ' state-editing-notice--override' : ''}`}>
              <Layers3 size={15} />
              <div>
                <strong>{activePresentationState ? `状态：${activePresentationState.name}` : '基础场景'}</strong>
                <span>{activePresentationState
                  ? '背景修改只保存在当前状态；场景名称仍为通用名称。'
                  : '这里的修改会被所有状态继承。'}</span>
              </div>
            </section>
            <section className="property-section">
              <h3 className="property-title"><Palette size={14} />场景</h3>
              <BufferedInput label="场景名称" value={scene.name} onCommit={(name) => updateScene(scene.id, { name })} />
              <ColorInput id="scene-background" label="背景色" value={effectiveScene.backgroundColor} onChange={(backgroundColor) => updateScene(scene.id, { backgroundColor })} />
            </section>
            {editorMode === 'professional' ? (
              <>
                <section className="property-section">
                  <h3 className="property-title"><Workflow size={14} />场景规则</h3>
                  <p className="property-hint">
                    当前场景有 {scene.interactions.length} 条规则。规则按“何时发生 → 是否满足条件 → 做什么”组织。
                  </p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setActiveTab('automation')}
                  >
                    <Workflow size={14} />打开规则面板
                  </button>
                </section>
                <RuntimeInspector
                  scope="scene"
                  view={runtimeInspectorView}
                />
              </>
            ) : scene.interactions.length > 0 ? (
              <section className="property-section simple-rule-summary">
                <h3 className="property-title"><Workflow size={14} />专业互动</h3>
                <p className="property-hint">
                  此场景已有 {scene.interactions.length} 条专业规则，播放时会继续生效。
                </p>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setEditorMode('professional')
                    setActiveTab('automation')
                  }}
                >
                  切换专业模式查看
                </button>
              </section>
            ) : null}
          </>
        )}
      </div>
    )
  }
  const update = (patch: DeepPartial<SceneNode>) => {
    if (node.type === 'text') {
      const textPatch = patch as DeepPartial<TextNode>
      const nextNode = {
        ...node,
        ...textPatch,
        style: { ...node.style, ...textPatch.style },
      } as TextNode
      if (nextNode.style.overflow === 'auto-height') {
        const rendered = renderTextNodeCanvas(nextNode, nextNode.width)
        updateNode(node.id, {
          ...patch,
          width: rendered.width,
          height: rendered.height,
        } as DeepPartial<SceneNode>)
        return
      }
    }
    updateNode(node.id, patch)
  }
  return (
    <div className="properties-scroll" data-testid="properties-tab">
      {editingScope === 'scene' && !spatialSession && !flowSession && (
        <section className={`state-editing-notice${activePresentationState ? ' state-editing-notice--override' : ''}`}>
          <Layers3 size={15} />
          <div>
            <strong>{activePresentationState ? `状态：${activePresentationState.name}` : '基础场景'}</strong>
            <span>{activePresentationState
              ? isNodeOverriddenInState(scene, activePresentationState.id, node.id)
                ? '此元素已有当前状态覆盖。'
                : '当前继承基础值；修改后会创建状态覆盖。'
              : '修改基础元素会影响所有继承它的状态。'}</span>
          </div>
          {activePresentationState && isNodeOverriddenInState(
            scene,
            activePresentationState.id,
            node.id,
          ) && (
            <button
              type="button"
              className="state-editing-notice__clear"
              onClick={() => clearNodePresentationOverride(node.id)}
            >
              恢复基础值
            </button>
          )}
        </section>
      )}
      <CommonNodeProperties node={node} update={update} />
      {editingScope === 'scene' && editorMode === 'simple' && !spatialSession && (
        <SimpleEntranceAnimationEditor
          scene={scene}
          node={node}
          activeStateId={activePresentationStateId}
        />
      )}
      {(editingScope === 'global' ||
        Boolean(candidateGlobalLayerItems?.some((entry) => entry.item.layerItemId === node.id))) && (
        <GlobalLayerSettings nodeId={node.id} />
      )}
      {spatialSession && node.type !== 'text' ? (
        <section
          className="property-section"
          data-testid="spatial-type-properties-unavailable"
          role="status"
        >
          <h3 className="property-title">类型属性</h3>
          <p className="property-hint">
            当前 Spatial 载体只开放上方可写入真实图层的通用属性；此类型的专属属性尚未接入 canonical 历史，因此已隐藏可提交控件。
          </p>
        </section>
      ) : null}
      {node.type === 'text' && (
        <TextProperties
          node={node}
          update={update}
          contentEditingEnabled={!spatialSession || spatialSession.scope === 'world'}
        />
      )}
      {!spatialSession && node.type === 'formula' && (
        <FormulaProperties
          node={node}
          update={update}
        />
      )}
      {!spatialSession && node.type === 'image' && <ImageProperties node={node} update={update} onReplaceImage={onReplaceImage} />}
      {!spatialSession && node.type === 'video' && (
        <VideoProperties
          node={node}
          update={update}
          diagnostics={projectDiagnostics
            .filter((diagnostic) => (
              editingScope === 'scene' &&
              diagnostic.sceneId === scene.id &&
              diagnostic.nodeId === node.id
            ))
            .map((diagnostic) => diagnostic.message)}
          onOpenAutomation={editorMode === 'professional'
            ? () => setActiveTab('automation')
            : undefined}
        />
      )}
      {editorMode === 'professional' &&
        (spatialSession || flowSession) &&
        node.type !== 'teacher-controller' && (
        <section
          className="property-section"
          data-testid="interaction-properties-unavailable"
          role="status"
        >
          <h3 className="property-title">交互</h3>
          <p className="property-hint">
            {editingScope === 'global'
              ? '当前 Flow 或 Spatial 页面不在元素属性中提供全局点击规则写入；请在“互动与动画”中使用可写的全局模板与专业字段。'
              : '当前 Flow 或 Spatial 页面没有元素级局部 Interaction carrier；这里不会创建无法保存的点击规则。'}
          </p>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setActiveTab('automation')}
          >
            打开互动与动画
          </button>
        </section>
      )}
      {editorMode === 'professional' &&
        editingScope === 'global' &&
        !spatialSession &&
        !flowSession &&
        node.type !== 'teacher-controller' && (
        <InteractionEditor
          scene={scene}
          selectedNode={node}
          sourceScope="global"
          sourceNodes={project.globalLayer.map((item) => item.node)}
          sourceRules={project.globalInteractions}
          activeStateId={activePresentationStateId}
          scenes={project.scenes}
          sounds={project.media.audio.sounds}
          onAddRule={addGlobalInteractionRule}
          onUpdateRule={(ruleId, patch) => {
            const current = project.globalInteractions.find(
              (rule) => rule.id === ruleId,
            )
            if (current) {
              updateGlobalInteractionRule(ruleId, { ...current, ...patch })
            }
          }}
          onDeleteRule={deleteGlobalInteractionRule}
        />
      )}
      {!spatialSession && node.type === 'shape' && <ShapeProperties node={node} update={update} />}
      {!spatialSession && node.type === 'teacher-controller' && (
        <TeacherControllerProperties node={node} scenes={project.scenes} update={update} />
      )}
      {!spatialSession && node.type === 'external-component' && (
        <>
          <section className="property-section">
            <h3 className="property-title"><Box size={14} />外部组件</h3>
            <div className="form-field"><label>组件名称</label><div className="readonly-value">{components[node.component.packageId]?.manifest.name ?? node.name}</div></div>
            <div className="form-field"><label>组件 ID</label><div className="readonly-value">{node.component.packageId}</div></div>
            <div className="form-field"><label>版本</label><div className="readonly-value">{node.component.version}</div></div>
          </section>
          {components[node.component.packageId] && (
            <ComponentPropertiesEditor
              manifest={components[node.component.packageId]!.manifest}
              node={node}
              assets={projectAssets}
              onChange={(props) => update({ props })}
            />
          )}
        </>
      )}
      {editorMode === 'professional' &&
        editingScope === 'scene' &&
        !spatialSession &&
        !flowSession && (
        <InteractionEditor
          scene={scene}
          selectedNode={node}
          activeStateId={activePresentationStateId}
          scenes={project.scenes}
          sounds={project.media.audio.sounds}
          onAddRule={(rule) => addInteractionRule(scene.id, rule)}
          onUpdateRule={(ruleId, patch) => {
            const current = scene.interactions.find((rule) => rule.id === ruleId)
            if (current) updateInteractionRule(scene.id, ruleId, { ...current, ...patch })
          }}
          onDeleteRule={(ruleId) => deleteInteractionRule(scene.id, ruleId)}
        />
      )}
    </div>
  )
}
