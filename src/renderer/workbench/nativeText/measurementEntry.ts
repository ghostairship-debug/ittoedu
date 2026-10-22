import { textNodeSchema } from '../../../shared/contracts/native-v1/schema'
import { analyzeTextNodeLayout, textNodeFontRequests } from '../../../shared/textLayout'
import { installBundledFontFaces } from '../../../shared/fonts/installBundledFontFaces'
import { prepareTextFonts } from '../../../shared/fonts/ensureBundledFonts'
import type { NativeTextMeasurementSpec } from '../../../core/tools/nativeTextLayout'
import type { NativeTextMeasurementResult } from '../../../core/tools/prepareNativeTextFrame'

// Same CSS face names, bytes, weight ranges and unicode slices as the editor.
installBundledFontFaces()
Object.defineProperty(window, '__GUOLING_NATIVE_TEXT_MEASURE__', { writable: false, configurable: false,
  value: async (input: NativeTextMeasurementSpec): Promise<NativeTextMeasurementResult> => {
    const node = textNodeSchema.parse(input.node)
    if (input.width !== node.width || !Number.isFinite(input.width) || input.width <= 0) throw new Error('文字测量宽度无效')
    await prepareTextFonts(textNodeFontRequests(node), document.fonts)
    const result = analyzeTextNodeLayout(node, input.width)
    if (result.measurementMode !== 'browser-canvas') throw new Error('当前环境未提供真实 Canvas 测量')
    return { measurementMode: result.measurementMode, requiredWidth: result.requiredWidth, requiredHeight: result.requiredHeight }
  },
})
