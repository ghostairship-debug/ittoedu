import { BUNDLED_FONT_FAMILIES } from './bundledFontFamilies'

/**
 * Two kinds of font, two different bills. `bundled` families ship inside the
 * app, so an export can embed them and the layout survives a machine change at
 * the cost of file size; `system` families are whatever the machine happens to
 * have, which keeps exports small and makes the layout machine-dependent.
 */
export type FontFamilySource = 'bundled' | 'system'

const BUNDLED_FONT_FAMILY_SET = new Set(BUNDLED_FONT_FAMILIES)

/**
 * Classify a family. Membership comes from the bundled font module — the single
 * truth about what we ship — so the picker can never promise an embed for a
 * family the export does not have bytes for.
 */
export function fontFamilySource(fontFamily: string): FontFamilySource {
  return BUNDLED_FONT_FAMILY_SET.has(fontFamily.trim()) ? 'bundled' : 'system'
}

/**
 * What each class costs, in the same terse voice as the availability tags. The
 * picker offers the choice, so it owes the teacher the trade-off that comes
 * with it.
 */
export const FONT_FAMILY_SOURCE_TAGS: Record<
  FontFamilySource,
  { readonly badge: string; readonly cost: string }
> = {
  bundled: {
    badge: '内置',
    cost: '内置字体：导出时嵌入，换机器排版不变，文件更大',
  },
  system: {
    badge: '系统',
    cost: '系统字体：导出不嵌入，文件小，没装该字体的机器上排版可能变样',
  },
}

const FONT_FAMILY_CATALOG = [
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

/**
 * Stable partition: bundled first, each class keeping its authored order. Two
 * contiguous runs let the list state a class's cost once instead of repeating
 * it on every row.
 */
export function orderFontOptionsBySource<Option extends { readonly family: string }>(
  options: readonly Option[],
): Option[] {
  return [
    ...options.filter((option) => fontFamilySource(option.family) === 'bundled'),
    ...options.filter((option) => fontFamilySource(option.family) !== 'bundled'),
  ]
}

/**
 * The bundled families lead the list: they are the only entries whose layout is
 * guaranteed on another machine. This changes no default, only what the teacher
 * sees first.
 */
export const FONT_FAMILY_OPTIONS: readonly {
  readonly label: string
  readonly family: string
}[] = orderFontOptionsBySource(FONT_FAMILY_CATALOG)

export const COMMON_FONT_FAMILIES = FONT_FAMILY_OPTIONS.map(
  (option) => option.family,
)

