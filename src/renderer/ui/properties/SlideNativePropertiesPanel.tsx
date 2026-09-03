import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Box,
  FlipHorizontal2,
  FlipVertical2,
  Highlighter,
  ImageIcon,
  Italic,
  Layers3,
  Lock,
  Shapes,
  Sigma,
  SlidersHorizontal,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  Unlock,
  Video,
  Workflow,
} from 'lucide-react'
import { nanoid } from 'nanoid'
import { useRef, type ReactNode } from 'react'
import type {
  ArrowHead,
  FeatherMode,
  FormulaNode,
  ImageFit,
  ImageNode,
  NativeRenderableNode,
  ShapeLineStyle,
  ShapeNode,
  ShapeType,
  TextAlign,
  TextNode,
  TextOverflowMode,
  VerticalAlign,
  VideoNode,
  WritingMode,
} from '../../../shared/contracts/native-v1'
import { isStrokeOnlyShapeType, SHAPE_TYPES } from '../../../shared/contracts/native-v1'
import { formulaAstToAccessibleText } from '../../../shared/formulaLinear'
import { isVerticalWritingMode } from '../../../shared/textLayout'
import {
  opacityToTransparencyPercent,
  transparencyPercentToOpacity,
} from '../../../shared/opacity'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import type { ComponentManifest } from '../../../shared/componentTypes'
import type { InteractionRule } from '../../../shared/interactionTypes'
import { ColorInput } from '../ColorInput'
import { ComponentPropertiesEditor } from '../ComponentPropertiesEditor'
import { FormulaAuthoringEditor } from '../FormulaAuthoringEditor'
import {
  InteractionEditor,
  type InteractionEditorProps,
} from '../InteractionEditor'
import { SimpleEntranceAnimationEditor } from '../SimpleEntranceAnimationEditor'
import type { SlideSimpleEntranceAnimationConfig } from '../../course/v9SlideContentCommands'
import { FlowSpatialInteractionUnavailableSection } from './FlowSpatialInteractionUnavailableSection'
import {
  BufferedInput,
  FontFamilyPicker,
  PropertyDraftBoundary,
  RangeField,
  SelectField,
  TextContentTextarea,
  ToggleRow,
} from './PropertyControls'

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

export interface PropertiesItemBase {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
  playbackInitialVisibility: 'inherit' | 'hidden'
}

export type PropertiesComponentView = PropertiesItemBase & {
  type: 'external-component'
  component: { packageId: string; version: string }
  props: Record<string, unknown>
}

export type PropertiesRuntimeView = PropertiesItemBase & {
  type: 'runtime'
}

export type PropertiesItemView =
  | NativeRenderableNode
  | PropertiesComponentView
  | PropertiesRuntimeView

export type PropertiesPatch = DeepPartial<PropertiesItemView>

export type EditorModeView = 'simple' | 'professional'

export interface SlideNativeTextCommands {
  readonly beginEdit: (source: 'properties' | 'canvas') => void
  readonly commitEdit: () => void
  readonly cancelEdit: () => void
  readonly setComposing?: (composing: boolean) => void
  readonly updateDraft: (text: string) => void
  readonly toggleStyle: (
    key: 'bold' | 'italic' | 'underline' | 'strike',
    selection: { start: number; end: number },
  ) => void
}

export interface SlideNativeNoticesView {
  readonly surfaceBaseEditing: boolean
  readonly sceneOwner: boolean
  readonly presentationStateName: string | null
  readonly stateOverrideApplied: boolean
}

export interface SlideNativePropertiesContext {
  readonly kind: 'slide-native'
  readonly draftBindingKey: string
  readonly view: PropertiesItemView
  readonly target: { readonly layerItemId: string }
  readonly editorMode: EditorModeView
  readonly disabledReason: string | null
  readonly contentEditingEnabled: boolean
  readonly spatialMode: boolean
  readonly flowOrSpatial: boolean
  readonly editingScopeGlobal: boolean
  readonly notices: SlideNativeNoticesView
  readonly videoDiagnostics: readonly string[]
  readonly animation: {
    readonly layerItemId: string
    readonly interactions: readonly InteractionRule[]
    readonly activeStateId: string | null
    readonly onChange: (config: SlideSimpleEntranceAnimationConfig | null) => void
    readonly onOpenProfessional: () => void
  } | null
  readonly interaction: InteractionEditorProps | null
  readonly globalInteraction: InteractionEditorProps | null
  readonly component: {
    readonly manifest: ComponentManifest
    readonly assets: Readonly<Record<string, AssetMeta>>
  } | null
  readonly commands: {
    readonly patch: (patch: PropertiesPatch) => void
    readonly replaceImage: () => void
    readonly clearPresentationOverride: () => void
    readonly openAutomation: () => void
    readonly openProfessionalAutomation: () => void
    readonly text: SlideNativeTextCommands
  }
  readonly onFeedback: (feedback: { kind: 'error' | 'status'; message: string }) => void
}

export function CommonNodeProperties({
  node,
  editorMode,
  update,
}: {
  node: PropertiesItemView
  editorMode: EditorModeView
  update(patch: PropertiesPatch): void
}) {
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
        <SelectField<PropertiesItemView['playbackInitialVisibility']>
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

function TextProperties({
  node,
  update,
  contentEditingEnabled = true,
  textCommands,
}: {
  node: TextNode
  update(patch: PropertiesPatch): void
  contentEditingEnabled?: boolean
  textCommands: SlideNativeTextCommands
}) {
  const style = node.style
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
  return (
    <section className="property-section">
      <h3 className="property-title"><Type size={14} />文本</h3>
      {contentEditingEnabled ? (
        <>
          <TextContentTextarea
            label="文字内容"
            value={node.text}
            onBegin={() => textCommands.beginEdit('properties')}
            onChange={textCommands.updateDraft}
            onCommit={textCommands.commitEdit}
            onCancel={textCommands.cancelEdit}
            onCompositionChange={textCommands.setComposing}
          />
          <button
            type="button"
            className="secondary-button"
            style={{ width: '100%', marginBottom: 10 }}
            onClick={() => textCommands.beginEdit('canvas')}
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
            <button type="button" key={String(key)} title={String(label)} aria-label={String(label)} className={`segment-button${style[key as 'bold'] ? ' segment-button--active' : ''}`} onMouseDown={captureSelection} onClick={() => textCommands.toggleStyle(key as 'bold' | 'italic' | 'underline' | 'strike', selectionRef.current)}>
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
  update(patch: PropertiesPatch): void
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
        } as PropertiesPatch)}
      />
      <BufferedInput
        label="无障碍描述"
        value={node.accessibleText}
        onCommit={(accessibleText) => update({ accessibleText } as PropertiesPatch)}
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
            } as PropertiesPatch)}
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
        } as PropertiesPatch)}
      />
      <ColorInput
        id="formula-color"
        label="公式颜色"
        value={node.style.color}
        onChange={(color) => update({ style: { color } } as PropertiesPatch)}
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
              onClick={() => update({ style: { align: value } } as PropertiesPatch)}
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
  node: ImageNode
  update(patch: PropertiesPatch): void
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
  update(patch: PropertiesPatch): void
  diagnostics?: readonly string[]
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

const SHAPE_LABELS: Record<ShapeType, string> = {
  rectangle: '矩形', 'rounded-rectangle': '圆角矩形', ellipse: '圆形/椭圆', triangle: '三角形', diamond: '菱形', line: '直线',
  'arrow-left': '左箭头', 'arrow-right': '右箭头', 'arrow-up': '上箭头', 'arrow-down': '下箭头', 'arrow-left-right': '双向箭头', 'elbow-arrow': '折线箭头',
  'brace-left': '左大括号', 'brace-right': '右大括号', 'brace-top': '上大括号', 'brace-bottom': '下大括号', 'brace-pair-horizontal': '横向大括号对', 'brace-pair-vertical': '纵向大括号对',
  'bracket-left': '左方括号', 'bracket-right': '右方括号', 'emphasis-dot': '着重圆点', 'emphasis-triangle': '着重三角',
}

const ARROW_OPTIONS: Array<{ value: ArrowHead; label: string }> = [
  { value: 'none', label: '无' }, { value: 'triangle', label: '三角' }, { value: 'stealth', label: '尖角' }, { value: 'circle', label: '圆点' }, { value: 'diamond', label: '菱形' },
]

function ShapeProperties({ node, update }: { node: ShapeNode; update(patch: PropertiesPatch): void }) {
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

export function SlideNativeTypeFields({
  node,
  update,
  contentEditingEnabled,
  spatialMode,
  videoDiagnostics,
  onReplaceImage,
  onOpenAutomation,
  textCommands,
}: {
  node: PropertiesItemView
  update(patch: PropertiesPatch): void
  contentEditingEnabled: boolean
  spatialMode: boolean
  videoDiagnostics: readonly string[]
  onReplaceImage(): void
  onOpenAutomation?: () => void
  textCommands: SlideNativeTextCommands
}) {
  if (spatialMode && node.type !== 'text') {
    return (
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
    )
  }
  return (
    <>
      {node.type === 'text' && (
        <TextProperties
          node={node}
          update={update}
          contentEditingEnabled={contentEditingEnabled}
          textCommands={textCommands}
        />
      )}
      {!spatialMode && node.type === 'formula' && (
        <FormulaProperties node={node} update={update} />
      )}
      {!spatialMode && node.type === 'image' && (
        <ImageProperties node={node} update={update} onReplaceImage={onReplaceImage} />
      )}
      {!spatialMode && node.type === 'video' && (
        <VideoProperties
          node={node}
          update={update}
          diagnostics={videoDiagnostics}
          onOpenAutomation={onOpenAutomation}
        />
      )}
      {!spatialMode && node.type === 'shape' && (
        <ShapeProperties node={node} update={update} />
      )}
    </>
  )
}

export function SlideNativeNotices({
  notices,
  onClearPresentationOverride,
}: {
  notices: SlideNativeNoticesView
  onClearPresentationOverride(): void
}) {
  return (
    <>
      {notices.surfaceBaseEditing && (
        <section
          className="state-editing-notice"
          data-testid="slide-surface-base-editing-notice"
        >
          <Layers3 size={15} />
          <div>
            <strong>表面共享基础值</strong>
            <span>修改会影响此 Slide 表面的所有场景，不会创建命名状态覆盖。</span>
          </div>
        </section>
      )}
      {notices.sceneOwner && (
        <section className={`state-editing-notice${notices.presentationStateName ? ' state-editing-notice--override' : ''}`}>
          <Layers3 size={15} />
          <div>
            <strong>{notices.presentationStateName ? `状态：${notices.presentationStateName}` : '基础场景'}</strong>
            <span>{notices.presentationStateName
              ? notices.stateOverrideApplied
                ? '此元素已有当前状态覆盖。'
                : '当前继承基础值；修改后会创建状态覆盖。'
              : '修改基础元素会影响所有继承它的状态。'}</span>
          </div>
          {notices.presentationStateName && notices.stateOverrideApplied && (
            <button
              type="button"
              className="state-editing-notice__clear"
              onClick={onClearPresentationOverride}
            >
              恢复基础值
            </button>
          )}
        </section>
      )}
    </>
  )
}

export function SlideNativePropertiesPanel({
  context,
  afterCommon,
}: {
  context: SlideNativePropertiesContext
  afterCommon?: ReactNode
}) {
  const {
    view: node,
    editorMode,
    commands,
    notices,
    animation,
    interaction,
    globalInteraction,
    component,
    spatialMode,
    flowOrSpatial,
    editingScopeGlobal,
    contentEditingEnabled,
    videoDiagnostics,
  } = context
  const update = commands.patch
  return (
    <PropertyDraftBoundary
      bindingKey={context.draftBindingKey}
      onStale={() => context.onFeedback({
        kind: 'error',
        message: '属性草稿对应的编辑目标已经改变，请按 Esc 放弃草稿后重试。',
      })}
    >
      <SlideNativeNotices
        notices={notices}
        onClearPresentationOverride={commands.clearPresentationOverride}
      />
      <CommonNodeProperties node={node} editorMode={editorMode} update={update} />
      {animation && (
        <SimpleEntranceAnimationEditor
          layerItemId={animation.layerItemId}
          interactions={animation.interactions}
          activeStateId={animation.activeStateId}
          onChange={animation.onChange}
          onOpenProfessional={animation.onOpenProfessional}
        />
      )}
      {afterCommon}
      <SlideNativeTypeFields
        node={node}
        update={update}
        contentEditingEnabled={contentEditingEnabled}
        spatialMode={spatialMode}
        videoDiagnostics={videoDiagnostics}
        onReplaceImage={commands.replaceImage}
        onOpenAutomation={editorMode === 'professional' && !notices.surfaceBaseEditing
          ? commands.openAutomation
          : undefined}
        textCommands={commands.text}
      />
      {editorMode === 'professional' &&
        flowOrSpatial &&
        node.type !== 'teacher-controller' && (
        <FlowSpatialInteractionUnavailableSection
          editingScopeGlobal={editingScopeGlobal}
          onOpenAutomation={commands.openProfessionalAutomation}
        />
      )}
      {globalInteraction && node.type !== 'teacher-controller' && (
        <InteractionEditor {...globalInteraction} />
      )}
      {node.type === 'external-component' && (
        <>
          <section className="property-section">
            <h3 className="property-title"><Box size={14} />外部组件</h3>
            <div className="form-field"><label>组件名称</label><div className="readonly-value">{component?.manifest.name ?? node.name}</div></div>
            <div className="form-field"><label>组件 ID</label><div className="readonly-value">{node.component.packageId}</div></div>
            <div className="form-field"><label>版本</label><div className="readonly-value">{node.component.version}</div></div>
          </section>
          {component && (
            <ComponentPropertiesEditor
              manifest={component.manifest}
              node={node}
              assets={component.assets}
              onChange={(props) => update({ props })}
            />
          )}
        </>
      )}
      {interaction && (
        <InteractionEditor {...interaction} />
      )}
    </PropertyDraftBoundary>
  )
}
