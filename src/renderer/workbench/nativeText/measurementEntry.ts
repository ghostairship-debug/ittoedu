import { textNodeSchema } from '../../../shared/contracts/native-v1/schema'
import { analyzeTextNodeLayout } from '../../../shared/textLayout'
import { installBundledFontFaces } from '../../../shared/fonts/installBundledFontFaces'
import { ensureBundledFonts } from '../../../shared/fonts/ensureBundledFonts'
import { BUNDLED_FONT_MANIFEST } from '../../../shared/fonts/bundledFontAssets'
import type { NativeTextMeasurementSpec } from '../../../core/tools/nativeTextLayout'
import type { NativeTextMeasurementResult } from '../../../core/tools/prepareNativeTextFrame'

// Same CSS face names, bytes, weight ranges and unicode slices as the editor.
installBundledFontFaces()
const ready = ensureBundledFonts().then(async () => {
  await document.fonts.ready
  const families = new Map(BUNDLED_FONT_MANIFEST.families.map(family => [family.family, family.faces.length]))
  const loaded = new Map<string, number>()
  document.fonts.forEach(face => {
    const family = face.family.replace(/^(["'])(.*)\1$/, '$2')
    if (!families.has(family)) return
    if (face.status !== 'loaded') throw new Error(`内置字体 ${family} 尚未成功加载，未使用回退字体测量`)
    loaded.set(family, (loaded.get(family) ?? 0) + 1)
  })
  for (const [family, count] of families) if (loaded.get(family) !== count) throw new Error(`内置字体 ${family} 的实际切片与构建清单不一致`)
})
// Handle the rejected readiness promise even before the first queued job calls it.
void ready.catch(() => {})
Object.defineProperty(window, '__GUOLING_NATIVE_TEXT_MEASURE__', { writable: false, configurable: false,
  value: async (input: NativeTextMeasurementSpec): Promise<NativeTextMeasurementResult> => {
    const node = textNodeSchema.parse(input.node)
    if (input.width !== node.width || !Number.isFinite(input.width) || input.width <= 0) throw new Error('文字测量宽度无效')
    await ready
    const result = analyzeTextNodeLayout(node, input.width)
    if (result.measurementMode !== 'browser-canvas') throw new Error('当前环境未提供真实 Canvas 测量')
    return { measurementMode: result.measurementMode, requiredWidth: result.requiredWidth, requiredHeight: result.requiredHeight }
  },
})
