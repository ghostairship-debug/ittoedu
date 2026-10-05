/** Output paper options; this module has no editor, Player or carrier dependency. */
export type FlowDocxPageSize = 'A4' | 'letter' | 'surface-native'
export type FlowDocxOrientation = 'auto' | 'portrait' | 'landscape'

export interface PrintPageSize {
  widthPx: number
  heightPx: number
  cssSize: string
}

/** Native capture dimensions use CSS px (96/in); Flow without a fixed size uses A4. */
export function resolvePrintPageSize(
  pageSize: FlowDocxPageSize = 'A4',
  orientation: FlowDocxOrientation = 'auto',
  nativeSize?: { width: number; height: number },
): PrintPageSize {
  if (pageSize === 'surface-native' && nativeSize) {
    const swap = orientation === 'portrait' && nativeSize.width > nativeSize.height
      || orientation === 'landscape' && nativeSize.width < nativeSize.height
    const widthPx = swap ? nativeSize.height : nativeSize.width
    const heightPx = swap ? nativeSize.width : nativeSize.height
    return { widthPx, heightPx, cssSize: `${widthPx}px ${heightPx}px` }
  }
  const box = resolveFlowDocxPageBox(pageSize, orientation)
  return { widthPx: box.widthTwips / 15, heightPx: box.heightTwips / 15,
    cssSize: `${pageSize === 'letter' ? 'letter' : 'A4'} ${orientation === 'landscape' ? 'landscape' : 'portrait'}` }
}

export interface FlowDocxPageBox {
  widthTwips: number
  heightTwips: number
  marginTwips: number
  maxContentWidthPx: number
  maxContentHeightPx: number
}

export function resolveFlowDocxPageBox(
  pageSize: FlowDocxPageSize = 'A4',
  orientation: FlowDocxOrientation = 'portrait',
): FlowDocxPageBox {
  let widthTwips = 11_906
  let heightTwips = 16_838
  if (pageSize === 'letter') {
    widthTwips = 12_240
    heightTwips = 15_840
  }
  if (orientation === 'landscape') {
    const temp = widthTwips
    widthTwips = heightTwips
    heightTwips = temp
  }
  const marginTwips = 1134 // standard 20mm margins
  const maxContentWidthPx = Math.floor((widthTwips - marginTwips * 2) / 15)
  const maxContentHeightPx = Math.floor((heightTwips - marginTwips * 2) / 15)
  return { widthTwips, heightTwips, marginTwips, maxContentWidthPx, maxContentHeightPx }
}
