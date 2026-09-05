import { Shapes } from 'lucide-react'
import type {
  ArrowHead,
  ShapeLineStyle,
  ShapeNode,
  ShapeType,
} from '../../../shared/contracts/native-v1'
import { isStrokeOnlyShapeType, SHAPE_TYPES } from '../../../shared/contracts/native-v1'
import {
  opacityToTransparencyPercent,
  transparencyPercentToOpacity,
} from '../../../shared/opacity'
import { NativeColorInput as ColorInput } from './NativeColorPreview'
import {
  BufferedInput,
  RangeField,
  SelectField,
} from './PropertyControls'

export const SHAPE_LABELS: Record<ShapeType, string> = {
  rectangle: '矩形',
  'rounded-rectangle': '圆角矩形',
  ellipse: '圆形/椭圆',
  triangle: '三角形',
  diamond: '菱形',
  line: '直线',
  'arrow-left': '左箭头',
  'arrow-right': '右箭头',
  'arrow-up': '上箭头',
  'arrow-down': '下箭头',
  'arrow-left-right': '双向箭头',
  'elbow-arrow': '折线箭头',
  'brace-left': '左大括号',
  'brace-right': '右大括号',
  'brace-top': '上大括号',
  'brace-bottom': '下大括号',
  'brace-pair-horizontal': '横向大括号对',
  'brace-pair-vertical': '纵向大括号对',
  'bracket-left': '左方括号',
  'bracket-right': '右方括号',
  'emphasis-dot': '着重圆点',
  'emphasis-triangle': '着重三角',
}

export const ARROW_OPTIONS: Array<{ value: ArrowHead; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'triangle', label: '三角' },
  { value: 'stealth', label: '尖角' },
  { value: 'circle', label: '圆点' },
  { value: 'diamond', label: '菱形' },
]

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

export interface SharedShapePropertiesProps {
  node: ShapeNode
  update(patch: DeepPartial<ShapeNode>): void
}

export function SharedShapeProperties({ node, update }: SharedShapePropertiesProps) {
  const style = node.style
  const strokeOnly = isStrokeOnlyShapeType(node.shapeType)
  const supportsArrowHeads = node.shapeType === 'line' || node.shapeType === 'elbow-arrow'
  return (
    <section className="property-section" data-testid="shape-properties">
      <h3 className="property-title"><Shapes size={14} />图形</h3>
      <SelectField<ShapeType>
        label="图形类型"
        value={node.shapeType}
        options={SHAPE_TYPES.map((value) => ({ value, label: SHAPE_LABELS[value] }))}
        onChange={(shapeType) => update({ shapeType })}
      />
      {!strokeOnly ? (
        <>
          <ColorInput
            id="shape-fill"
            previewPatch={fillColor => ({ style: { fillColor } })}
            label="填充色"
            value={style.fillColor}
            onChange={(fillColor) => update({ style: { fillColor } })}
          />
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
        </>
      ) : (
        <p className="property-hint" data-testid="shape-stroke-only-hint">
          当前线型仅包含描边，不适用填充。
        </p>
      )}
      <ColorInput
        id="shape-border"
        previewPatch={borderColor => ({ style: { borderColor } })}
        label={strokeOnly ? '线条颜色' : '边框颜色'}
        value={style.borderColor}
        onChange={(borderColor) => update({ style: { borderColor } })}
      />
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
      <BufferedInput
        label={strokeOnly ? '线条宽度' : '边框宽度'}
        type="number"
        min={0}
        max={100}
        value={style.borderWidth}
        onCommit={(borderWidth) => update({ style: { borderWidth: Number(borderWidth) } })}
      />
      <SelectField<ShapeLineStyle>
        label="线型"
        value={style.lineStyle}
        options={[
          { value: 'solid', label: '实线' },
          { value: 'dashed', label: '虚线' },
          { value: 'dotted', label: '点线' },
        ]}
        onChange={(lineStyle) => update({ style: { lineStyle } })}
      />
      {(node.shapeType === 'rounded-rectangle' || node.shapeType === 'rectangle') && (
        <RangeField
          label="圆角"
          value={style.cornerRadius}
          min={0}
          max={Math.min(node.width, node.height) / 2}
          suffix="px"
          onChange={(cornerRadius) => update({
            style: { cornerRadius },
            shapeType: cornerRadius > 0 ? 'rounded-rectangle' : 'rectangle',
          })}
        />
      )}
      {supportsArrowHeads && (
        <div className="coordinate-grid">
          <SelectField<ArrowHead>
            label="起点箭头"
            value={style.startArrow}
            options={ARROW_OPTIONS}
            onChange={(startArrow) => update({ style: { startArrow } })}
          />
          <SelectField<ArrowHead>
            label="终点箭头"
            value={style.endArrow}
            options={ARROW_OPTIONS}
            onChange={(endArrow) => update({ style: { endArrow } })}
          />
        </div>
      )}
    </section>
  )
}
