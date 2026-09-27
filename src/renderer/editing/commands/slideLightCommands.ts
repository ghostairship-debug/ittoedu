import { FONT_FAMILY_OPTIONS, fontFamilySource } from '../../../shared/fonts/fontFamilyCatalog'
import { LIGHT_SLIDE_LINE_SPACING, LIGHT_SLIDE_OPACITIES, type SlidePageAlignment } from '../../../core/tools/lightSlideEditing'

export type SlideLightCommand = {
  readonly id: string
  readonly label: string
  readonly group: 'style' | 'layout' | 'background' | 'interaction'
  readonly kind: 'opacity' | 'font' | 'line-spacing' | 'page-align' | 'scene-background' | 'audio-play' | 'location-go' | 'audio-import'
  readonly value?: string | number
  readonly disabledReason?: string | null
}

export interface SlideLightPageCommandState {
  readonly stateBackgroundOverride?: boolean
}

export interface SlideLightObjectCommandState {
  readonly isText: boolean
  readonly locked: boolean
  readonly clickBindable: boolean
  readonly complexAudioRule?: boolean
  readonly complexNavigationRule?: boolean
  readonly sounds: readonly { readonly id: string; readonly name: string }[]
  readonly locations: readonly { readonly id: string; readonly label: string }[]
}

export interface SlideLightCommandState extends SlideLightPageCommandState, SlideLightObjectCommandState {}

const alignments: readonly { id: SlidePageAlignment; label: string }[] = [
  { id: 'left', label: '对齐页面左侧' }, { id: 'center-x', label: '对齐页面水平居中' },
  { id: 'right', label: '对齐页面右侧' }, { id: 'top', label: '对齐页面顶部' },
  { id: 'center-y', label: '对齐页面垂直居中' }, { id: 'bottom', label: '对齐页面底部' },
]
export const LIGHT_SLIDE_BACKGROUND_COLORS = ['#ffffff', '#f8fafc', '#fef3c7', '#dbeafe', '#dcfce7', '#111827'] as const
const spacingLabels = ['紧凑', '标准', '宽松', '加宽'] as const

/** Page actions have no object requirement, including a page with no layer items. */
export function slideLightPageCommands(state: SlideLightPageCommandState): SlideLightCommand[] {
  return [
    ...LIGHT_SLIDE_BACKGROUND_COLORS.map(value => ({ id: `slide.background.${value.slice(1)}`, label: `页面背景：${value}`, group: 'background' as const, kind: 'scene-background' as const, value, disabledReason: state.stateBackgroundOverride ? '此状态有独立背景，请切换母版或在编辑器中调整' : null })),
    { id: 'slide.audio.import', label: '放置音频', group: 'interaction', kind: 'audio-import' },
  ]
}

/** Object actions require a captured item and keep the existing item-specific policy. */
export function slideLightObjectCommands(state: SlideLightObjectCommandState): SlideLightCommand[] {
  const locked = state.locked ? '所选元素已锁定' : null
  const click = locked ?? (state.clickBindable ? null : '此元素不支持点击互动')
  const seen = new Set<string>(), duplicateLabels = new Set<string>()
  for (const location of state.locations) {
    if (seen.has(location.label)) duplicateLabels.add(location.label)
    else seen.add(location.label)
  }
  return [
    ...LIGHT_SLIDE_OPACITIES.map(value => ({ id: `slide.opacity.${Math.round(value * 100)}`, label: `不透明度：${Math.round(value * 100)}%`, group: 'style' as const, kind: 'opacity' as const, value, disabledReason: locked })),
    ...FONT_FAMILY_OPTIONS.filter(option => fontFamilySource(option.family) === 'bundled').map(option => ({ id: `slide.font.${option.family}`, label: `字体：${option.label}`, group: 'style' as const, kind: 'font' as const, value: option.family, disabledReason: locked ?? (state.isText ? null : '仅文字元素支持字体') })),
    ...LIGHT_SLIDE_LINE_SPACING.map((value, index) => ({ id: `slide.spacing.${value}`, label: `行距：${spacingLabels[index]}（额外 ${value} 像素）`, group: 'style' as const, kind: 'line-spacing' as const, value, disabledReason: locked ?? (state.isText ? null : '仅文字元素支持行距') })),
    ...alignments.map(option => ({ id: `slide.align.${option.id}`, label: option.label, group: 'layout' as const, kind: 'page-align' as const, value: option.id, disabledReason: locked })),
    ...state.sounds.map(sound => ({ id: `slide.audio.${sound.id}`, label: `点击播放：${sound.name}`, group: 'interaction' as const, kind: 'audio-play' as const, value: sound.id, disabledReason: click ?? (state.complexAudioRule ? '已有复杂互动，请在编辑器中设置' : null) })),
    ...state.locations.map((location, index) => ({ id: `slide.go.${location.id}`, label: `点击跳到：${location.label}${duplicateLabels.has(location.label) ? `（第${index + 1}页）` : ''}`, group: 'interaction' as const, kind: 'location-go' as const, value: location.id, disabledReason: click ?? (state.complexNavigationRule ? '已有复杂互动，请在编辑器中设置' : null) })),
  ]
}

/** Combined descriptors remain available to existing menu consumers during composition wiring. */
export function slideLightCommands(state: SlideLightCommandState): SlideLightCommand[] {
  return [...slideLightObjectCommands(state), ...slideLightPageCommands(state)]
}
