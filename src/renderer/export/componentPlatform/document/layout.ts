import type { ComponentReadingBlock, ComponentReadingProjection } from './reading'
import { nativeFlowContainerStyle, nativeFlowItemStyle } from '../../../../shared/flowNativeLayout'
import type { ComponentInstance } from '../../../../shared/contracts/component-platform/project'

export interface ReadingLayoutCell { id: string; column: number; columnSpan: number; rowSpan: number; verticalAlign?: 'center' | 'bottom' }
export interface ReadingLayoutRow { cells: ReadingLayoutCell[]; height?: number; heightRule?: 'exact' | 'atLeast' }
export interface ReadingLayoutGroup { columns: number[]; rows: ReadingLayoutRow[]; captureReason?: string }
export interface ReadingLayout { widths: Map<string, number>; groups: Map<string, ReadingLayoutGroup>; scales: Map<string, number> }

const tokens = (value: string): string[] => value.match(/(?:[^\s(]+\([^)]*\)|[^\s])+/g) ?? []
function tracks(value: string): string[] {
  const repeat = value.trim().match(/^repeat\(\s*(\d+)\s*,([\s\S]*)\)$/)
  return repeat ? Array.from({ length: Number(repeat[1]) }, () => tracks(repeat[2]!)).flat() : tokens(value)
}
function length(value: string | undefined, width: number): number | undefined {
  if (!value) return
  if (/^-?[\d.]+(?:px)?$/.test(value)) return Number.parseFloat(value)
  if (/^[\d.]+%$/.test(value)) return Number.parseFloat(value) * width / 100
}
function columnWidths(value: string, width: number, gap: number): number[] | undefined {
  const list = tracks(value)
  if (!list.length) return
  let fixed = gap * (list.length - 1), weight = 0
  const sizes = list.map(track => {
    const minmax = track.match(/^minmax\(\s*(?:0(?:px)?|auto|min-content)\s*,\s*(.*?)\s*\)$/)
    track = minmax?.[1] ?? track
    const fr = track.match(/^([\d.]+)fr$/)
    if (fr) { weight += Number(fr[1]); return { fr: Number(fr[1]), value: 0 } }
    const value = length(track, width)
    if (value === undefined) return undefined
    fixed += value; return { fr: 0, value }
  })
  if (sizes.some(size => !size) || fixed > width + 0.5) return
  return sizes.map(size => size!.value + (weight ? Math.max(0, width - fixed) * size!.fr / weight : 0))
}
function axis(value: string | undefined): { start?: number; span: number } | undefined {
  if (!value || value === 'auto') return { span: 1 }
  const span = value.match(/^span\s+(\d+)$/)
  if (span) return { span: Number(span[1]) }
  const range = value.match(/^(\d+)(?:\s*\/\s*(?:(\d+)|span\s+(\d+)))?$/)
  if (!range) return
  return { start: Number(range[1]) - 1, span: range[3] ? Number(range[3]) : range[2] ? Number(range[2]) - Number(range[1]) : 1 }
}
function placementAxis(shorthand: string | undefined, start: string | undefined, end: string | undefined) {
  if (start === 'auto') start = undefined
  if (end === 'auto') end = undefined
  if (shorthand || start) return axis(shorthand ?? (end ? `${start} / ${end}` : start))
  // An end line alone places a single track immediately before that line.
  if (end && /^\d+$/.test(end)) return { start: Number(end) - 2, span: 1 }
  return axis(end)
}

function gridPlacement(style: Record<string, string>) {
  const area = style.gridArea?.split('/').map(value => value.trim())
  if (area && (area.length > 4 || area.some(value => !/^(?:auto|\d+|span\s+\d+)$/.test(value)))) return
  const row = placementAxis(style.gridRow, style.gridRowStart ?? area?.[0], style.gridRowEnd ?? area?.[2])
  const column = placementAxis(style.gridColumn, style.gridColumnStart ?? area?.[1], style.gridColumnEnd ?? area?.[3])
  return row && column ? { row, column } : undefined
}

function flexStyle(style: Record<string, string>) {
  const flow = tokens(style.flexFlow ?? '')
  return { direction: style.flexDirection ?? flow.find(value => /^(?:row|column)(?:-reverse)?$/.test(value)) ?? 'row',
    wrap: style.flexWrap ?? flow.find(value => /^(?:nowrap|wrap|wrap-reverse)$/.test(value)) ?? 'nowrap' }
}

function flexSize(style: Record<string, string>, available: number) {
  const shorthand = tokens(style.flex ?? '')
  const number = (value: string | undefined) => value !== undefined && /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)
  let grow = 0, shrink = 1, basis = 'auto'
  if (shorthand[0] === 'none') shrink = 0
  else if (shorthand[0] === 'auto') grow = 1
  else if (number(shorthand[0])) {
    grow = Number(shorthand[0]); basis = '0'
    if (number(shorthand[1])) { shrink = Number(shorthand[1]); basis = shorthand[2] ?? '0' }
    else basis = shorthand[1] ?? '0'
  } else if (shorthand.length && shorthand[0] !== 'initial') { grow = 1; basis = shorthand[0]! }
  basis = style.flexBasis ?? basis
  const size = length(basis === 'auto' ? style.width : basis, available)
  return size === undefined ? undefined : { basis: size, grow: Number(style.flexGrow ?? grow), shrink: Number(style.flexShrink ?? shrink) }
}

function verticalAlignment(style: Record<string, string>, item: Record<string, string>): 'top' | 'center' | 'bottom' | undefined {
  const alignment = item.alignSelf && item.alignSelf !== 'auto' ? item.alignSelf : item.placeSelf?.split(/\s+/)[0]
    ?? style.alignItems ?? style.placeItems?.split(/\s+/)[0] ?? 'normal'
  if (['normal', 'stretch', 'start', 'flex-start', 'self-start'].includes(alignment)) return 'top'
  if (alignment === 'center') return 'center'
  if (['end', 'flex-end', 'self-end'].includes(alignment)) return 'bottom'
}

/** Word cells fill their track; independent horizontal boxes require a local capture. */
function horizontalItemFillsTrack(style: Record<string, string>, item: Record<string, string>, trackWidth: number, axis: 'align' | 'justify'): boolean {
  const self = tokens(item.placeSelf ?? ''), parent = tokens(style.placeItems ?? '')
  const ownAlignment = axis === 'justify' ? item.justifySelf ?? self[1] ?? self[0] : item.alignSelf ?? self[0]
  const parentAlignment = axis === 'justify' ? style.justifyItems ?? parent[1] ?? parent[0] : style.alignItems ?? parent[0]
  const alignment = ownAlignment && ownAlignment !== 'auto' ? ownAlignment : parentAlignment ?? 'normal'
  const size = item.inlineSize ?? item.width
  if (size && size !== 'auto') {
    const resolved = length(size, trackWidth)
    // When the item fills its track there is no remaining horizontal space for alignment to move it.
    return resolved !== undefined && Math.abs(resolved - trackWidth) <= 0.5
  }
  return alignment === 'normal' || alignment === 'stretch'
}

function rowTracks(value: string | undefined, height: number | undefined, gap: number): (number | undefined)[] | undefined {
  if (!value || value === 'none') return []
  const list = tracks(value)
  if (list.some(value => value.endsWith('fr'))) return height === undefined ? undefined : columnWidths(value, height, gap)
  const result = list.map(value => value === 'auto' ? undefined : length(value, height ?? 0))
  return list.some((value, index) => value !== 'auto' && (result[index] === undefined || value.endsWith('%') && height === undefined)) ? undefined : result
}

function box(instance: ComponentInstance) {
  const style = instance.style ?? {}
  const number = (camel: string, css: string, fallback = 0) => length(String(style[camel] ?? style[css] ?? fallback), 0) ?? 0
  const padding = String(style.padding ?? '0').trim().split(/\s+/).map(value => length(value, 0) ?? 0)
  const border = number('borderWidth', 'border-width', Number.parseFloat(String(style.border ?? '0')) || 0)
  return { left: number('paddingLeft', 'padding-left', padding[3] ?? padding[1] ?? padding[0]), right: number('paddingRight', 'padding-right', padding[1] ?? padding[0]),
    top: number('paddingTop', 'padding-top', padding[0]), bottom: number('paddingBottom', 'padding-bottom', padding[2] ?? padding[0]), border }
}

/** Target-format allocation only. CSS stays owned by the existing native Flow layout. */
export function componentReadingLayout(projection: ComponentReadingProjection, width: number): ReadingLayout {
  const widths = new Map<string, number>(), groups = new Map<string, ReadingLayoutGroup>(), scales = new Map<string, number>()
  const children = (id: string) => projection.blocks.filter(block => block.parentId === id && !block.floatingPlacement)
  const visit = (block: ComponentReadingBlock, available: number, scale = 1) => {
    if (block.floatingPlacement && block.instance.frame) available = block.instance.frame.width
    widths.set(block.instance.id, available)
    scales.set(block.instance.id, scale)
    const items = children(block.instance.id)
    if (block.kind !== 'layout') { items.forEach(child => visit(child, available, scale)); return }
    const inset = box(block.instance)
    available = Math.max(1, available - (inset.left + inset.right + inset.border * 2) * scale)
    const unavailable = (reason: string) => {
      groups.set(block.instance.id, { columns: [available], rows: [], captureReason: reason })
      items.forEach(child => visit(child, available, scale))
    }
    if (block.floatingPlacement) {
      unavailable('Word 浮层组使用一个实际图面保留局部层级、坐标与合成，不把后代拆散到正文。'); return
    }
    const style = nativeFlowContainerStyle(block.instance)
    if (block.mode === 'free') {
      if (!items.length) { groups.set(block.instance.id, { columns: [available], rows: [] }); return }
      const boxes = items.map(item => {
        const frame = item.instance.frame, m = frame?.transform
        return frame && m && m[1] === 0 && m[2] === 0 && m[0] > 0 && m[3] > 0 && Math.abs(m[0] - m[3]) < 1e-9
          ? { id: item.instance.id, x: m[4], y: m[5], width: frame.width * m[0], height: frame.height * m[3], scale: m[0] } : undefined
      })
      if (boxes.some(box => !box)) { unavailable('自由组包含不能映射到 Word 行列的局部几何。'); return }
      const rects = boxes.map(box => box!)
      if (rects.some((a, index) => rects.slice(index + 1).some(b => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 0.5 && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 0.5))) {
        unavailable('自由组包含重叠对象，Word 行列不能保留其合成关系。'); return
      }
      const left = Math.min(0, ...rects.map(box => box.x)), top = Math.min(0, ...rects.map(box => box.y))
      const right = Math.max(block.instance.frame?.width ?? 0, ...rects.map(box => box.x + box.width))
      const bottom = Math.max(block.instance.frame?.height ?? 0, ...rects.map(box => box.y + box.height))
      const fittedScale = scale * Math.min(1, (available / scale) / (right - left))
      const nativeScaledText = (item: ComponentReadingBlock): boolean => item.kind === 'layout'
        ? children(item.instance.id).every(nativeScaledText) : ['text', 'formula', 'document-block'].includes(item.kind)
      if (rects.some(rect => Math.abs(fittedScale * rect.scale - 1) > 1e-9 && !nativeScaledText(items.find(item => item.instance.id === rect.id)!))) {
        unavailable('自由组缩放的图表、表格或图形需要整体实际图面保留专业字体和局部合成。'); return
      }
      const xs = [...new Set([left, right, ...rects.flatMap(box => [box.x, box.x + box.width])])].sort((a, b) => a - b)
      const ys = [...new Set([top, bottom, ...rects.flatMap(box => [box.y, box.y + box.height])])].sort((a, b) => a - b)
      const group: ReadingLayoutGroup = { columns: xs.slice(1).map((x, index) => (x - xs[index]!) * fittedScale), rows: ys.slice(1).map((y, index) => ({ cells: [], height: (y - ys[index]!) * fittedScale })) }
      rects.forEach(box => {
        const column = xs.indexOf(box.x), row = ys.indexOf(box.y)
        group.rows[row]!.cells.push({ id: box.id, column, columnSpan: xs.indexOf(box.x + box.width) - column, rowSpan: ys.indexOf(box.y + box.height) - row })
        visit(items.find(item => item.instance.id === box.id)!, box.width * fittedScale, fittedScale * box.scale)
      })
      groups.set(block.instance.id, group); return
    }
    const ordered = [...items].sort((a, b) => Number(nativeFlowItemStyle(a.instance).order ?? 0) - Number(nativeFlowItemStyle(b.instance).order ?? 0))
    const localAvailable = available / scale
    const gapValues = tokens(style.gap ?? '')
    const gap = (length(style.columnGap ?? gapValues[1] ?? gapValues[0], localAvailable) ?? 0) * scale
    const rowGap = (length(style.rowGap ?? gapValues[0], localAvailable) ?? 0) * scale
    let columns: number[], rows: ReadingLayoutRow[] = []
    if (style.display === 'grid') {
      const resolved = columnWidths(style.gridTemplateColumns ?? '', localAvailable, gap / scale)?.map(value => value * scale)
      if (!resolved || style.gridTemplateAreas || style.gridAutoFlow && style.gridAutoFlow !== 'row') { unavailable('该 Grid 的内容依赖轨道或命名布局不能映射到 Word 固定行列。'); return }
      columns = resolved
      const placements = ordered.map(item => ({ item, placement: gridPlacement(nativeFlowItemStyle(item.instance)) }))
      if (placements.some(({ placement }) => !placement)) { unavailable('该 Grid 子项的命名区域不能映射到 Word 行列。'); return }
      if (placements.some(({ placement }) => {
        const { column: col, row } = placement!
        return col.span < 1 || row.span < 1 || col.span > columns.length
          || col.start !== undefined && (col.start < 0 || col.start + col.span > columns.length)
          || row.start !== undefined && row.start < 0
      })) { unavailable('该 Grid 子项使用隐式列或不能映射到 Word 的行列位置。'); return }
      const occupied = new Set<string>(), positions = new Map<string, { row: number; column: number }>()
      const fits = (r: number, c: number, rowSpan: number, columnSpan: number) => c + columnSpan <= columns.length
        && Array.from({ length: rowSpan }, (_, dy) => Array.from({ length: columnSpan }, (_, dx) => !occupied.has(`${r + dy}:${c + dx}`))).flat().every(Boolean)
      const place = (id: string, r: number, c: number, rowSpan: number, columnSpan: number) => {
        for (let dy = 0; dy < rowSpan; dy++) for (let dx = 0; dx < columnSpan; dx++) occupied.add(`${r + dy}:${c + dx}`)
        positions.set(id, { row: r, column: c })
      }
      // CSS places definite cells before auto items, independently of source order.
      for (const { item, placement } of placements) {
        const { row, column: col } = placement!
        if (row.start === undefined || col.start === undefined) continue
        if (!fits(row.start, col.start, row.span, col.span)) { unavailable('Grid 子项有重叠，Word 行列不能保留合成关系。'); return }
        place(item.instance.id, row.start, col.start, row.span, col.span)
      }
      for (const { item, placement } of placements) {
        const { row, column: col } = placement!
        if (row.start === undefined || col.start !== undefined) continue
        let c = 0
        while (c + col.span <= columns.length && !fits(row.start, c, row.span, col.span)) c++
        if (c + col.span > columns.length) { unavailable('Grid 固定行中的子项需要隐式列，Word 使用该局部实际图面。'); return }
        place(item.instance.id, row.start, c, row.span, col.span)
      }
      let cursorRow = 0, cursorColumn = 0
      for (const { item, placement } of placements) {
        const { row, column: col } = placement!
        if (row.start !== undefined) continue
        if (col.start !== undefined) { if (col.start < cursorColumn) cursorRow++; cursorColumn = col.start }
        for (;;) {
          if (cursorColumn + col.span > columns.length) { cursorRow++; cursorColumn = col.start ?? 0 }
          if (fits(cursorRow, cursorColumn, row.span, col.span)) break
          if (col.start !== undefined) cursorRow++
          else cursorColumn++
        }
        place(item.instance.id, cursorRow, cursorColumn, row.span, col.span)
        // The sparse auto cursor stays at this start cell; occupancy advances the next item.
      }
      for (const { item, placement } of placements) {
        const { row, column: col } = placement!, position = positions.get(item.instance.id)!
        const itemStyle = nativeFlowItemStyle(item.instance)
        const itemWidth = columns.slice(position.column, position.column + col.span).reduce((a, b) => a + b, 0) + gap * (col.span - 1)
        if (!horizontalItemFillsTrack(style, itemStyle, itemWidth / scale, 'justify')) {
          unavailable('Grid 子项的水平对齐或独立宽度不能由整轨 Word 单元格忠实表达，使用局部实际图面。'); return
        }
        const alignment = verticalAlignment(style, itemStyle)
        if (!alignment) { unavailable('Grid 子项的基线对齐不能由 Word 单元格忠实表达，使用局部实际图面。'); return }
        while (rows.length < position.row + row.span) rows.push({ cells: [] })
        rows[position.row]!.cells.push({ id: item.instance.id, column: position.column, columnSpan: col.span, rowSpan: row.span,
          ...(alignment !== 'top' ? { verticalAlign: alignment } : {}) })
        visit(item, itemWidth, scale)
      }
      const heightStyle = String(block.instance.style?.height ?? block.instance.style?.blockSize ?? '')
      const localHeight = heightStyle.endsWith('%') ? undefined : length(heightStyle, 0)
      const explicitRows = rowTracks(style.gridTemplateRows, localHeight, rowGap / scale), implicitRows = rowTracks(style.gridAutoRows ?? 'auto', localHeight, rowGap / scale)
      if (!explicitRows || !implicitRows) { unavailable('Grid 行轨道需要内容度量或未确定高度，使用该局部实际图面。'); return }
      while (rows.length < explicitRows.length) rows.push({ cells: [] })
      rows.forEach((row, index) => {
        const height = index < explicitRows.length ? explicitRows[index] : implicitRows[(index - explicitRows.length) % Math.max(1, implicitRows.length)]
        if (height !== undefined) { row.height = height * scale; row.heightRule = 'exact' }
      })
    } else {
      const { direction, wrap } = flexStyle(style)
      if (direction.endsWith('reverse')) ordered.reverse()
      if (wrap !== 'nowrap') { unavailable('换行 Flex 依赖目标字体与内容度量，Word 使用该局部区域的实际图面。'); return }
      if (direction.startsWith('column')) {
        const mainSize = nativeFlowItemStyle(block.instance).blockSize ?? nativeFlowItemStyle(block.instance).height
        if (mainSize && mainSize !== 'auto') {
          unavailable('固定主轴高度的纵向 Flex 依赖实际子项伸缩和位置，使用该局部实际图面。'); return
        }
        if (style.justifyContent && !['normal', 'start', 'flex-start'].includes(style.justifyContent)) { unavailable('纵向 Flex 的剩余空间分配需要实际图面。'); return }
        if (ordered.some(item => !horizontalItemFillsTrack(style, nativeFlowItemStyle(item.instance), localAvailable, 'align'))) {
          unavailable('纵向 Flex 子项的水平对齐或独立宽度需要该局部实际图面。'); return
        }
        columns = [available]; rows = ordered.map(item => ({ cells: [{ id: item.instance.id, column: 0, columnSpan: 1, rowSpan: 1 }] })); ordered.forEach(item => visit(item, available, scale))
      }
      else {
        const usable = Math.max(1, available - gap * Math.max(0, ordered.length - 1))
        const resolvedSizes = ordered.map(item => flexSize(nativeFlowItemStyle(item.instance), localAvailable))
        if (resolvedSizes.some(size => !size)) { unavailable('Flex 自动基准依赖内容的实际度量，使用该局部实际图面。'); return }
        const sizes = resolvedSizes.map(size => ({ ...size!, basis: size!.basis * scale }))
        const sum = sizes.reduce((total, size) => total + size.basis, 0), grow = sizes.reduce((total, size) => total + size.grow, 0), shrink = sizes.reduce((total, size) => total + size.shrink * size.basis, 0)
        columns = sizes.map(size => Math.max(0, size.basis + (sum < usable && grow ? (usable - sum) * size.grow / grow : sum > usable && shrink ? (usable - sum) * size.shrink * size.basis / shrink : 0)))
        if (columns.reduce((a, b) => a + b, 0) < usable - 0.5 || style.justifyContent && !['normal', 'start', 'flex-start'].includes(style.justifyContent)) { unavailable('该 Flex 的剩余空间分配不能映射到当前 Word 行列，保留局部实际图面。'); return }
        const alignments = ordered.map(item => verticalAlignment(style, nativeFlowItemStyle(item.instance)))
        if (alignments.some(value => !value)) { unavailable('Flex 基线对齐不能由 Word 单元格忠实表达，使用局部实际图面。'); return }
        rows = [{ cells: ordered.map((item, column) => ({ id: item.instance.id, column, columnSpan: 1, rowSpan: 1,
          ...(alignments[column] !== 'top' ? { verticalAlign: alignments[column] as 'center' | 'bottom' } : {}) })) }]
        ordered.forEach((item, index) => visit(item, columns[index]!, scale))
      }
    }
    // Gap columns/rows are native empty Word cells, keeping content fully editable.
    groups.set(block.instance.id, { columns: columns.flatMap((value, index) => index ? [gap, value] : [value]), rows: rows.flatMap((row, index) => {
      const mapped = { ...row, cells: row.cells.map(cell => ({ ...cell, column: cell.column * 2, columnSpan: cell.columnSpan * 2 - 1, rowSpan: cell.rowSpan * 2 - 1 })) }
      return index ? [{ cells: [], height: rowGap }, mapped] : [mapped]
    }) })
  }
  projection.blocks.filter(block => !block.parentId || block.instance.flowPlacement).forEach(block => visit(block, width))
  return { widths, groups, scales }
}

/** Native Word cells carry the existing professional XML and relationships. */
export function wordReadingLayout(group: ReadingLayoutGroup, contents: ReadonlyMap<string, string>, instance: ComponentInstance, scale = 1): string {
  const twips = (px: number) => Math.max(0, Math.round(px * 15))
  const width = group.columns.reduce((a, b) => a + b, 0)
  const continuation = new Map<string, { span: number }>()
  const emptyParagraph = '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/></w:pPr></w:p>'
  const rows = group.rows.map((row, rowIndex) => {
    const cells: string[] = []
    for (let column = 0; column < group.columns.length;) {
      const cell = row.cells.find(cell => cell.column === column), continued = continuation.get(`${rowIndex}:${column}`)
      const span = cell?.columnSpan ?? continued?.span ?? 1
      const cellWidth = group.columns.slice(column, column + span).reduce((a, b) => a + b, 0)
      const properties = `<w:tcW w:w="${twips(cellWidth)}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}`
        + (cell && cell.rowSpan > 1 ? '<w:vMerge w:val="restart"/>' : continued ? '<w:vMerge/>' : '') + `<w:vAlign w:val="${cell?.verticalAlign ?? 'top'}"/>`
      if (cell) for (let dy = 1; dy < cell.rowSpan; dy++) continuation.set(`${rowIndex + dy}:${column}`, { span })
      const body = cell ? contents.get(cell.id) ?? '' : ''
      cells.push(`<w:tc><w:tcPr>${properties}</w:tcPr>${body}${body.endsWith('</w:p>') ? '' : emptyParagraph}</w:tc>`)
      column += span
    }
    return `<w:tr>${row.height !== undefined ? `<w:trPr><w:trHeight w:val="${twips(row.height)}" w:hRule="${row.heightRule ?? 'atLeast'}"/></w:trPr>` : ''}${cells.join('')}</w:tr>`
  }).join('')
  const noBorders = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(side => `<w:${side} w:val="nil"/>`).join('') + '</w:tblBorders>'
  const table = `<w:tbl><w:tblPr><w:tblW w:w="${twips(width)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${noBorders}<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${group.columns.map(value => `<w:gridCol w:w="${twips(value)}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`
  const sourceInset = box(instance), inset = Object.fromEntries(Object.entries(sourceInset).map(([key, value]) => [key, value * scale])) as ReturnType<typeof box>, style = instance.style ?? {}
  const color = String(style.backgroundColor ?? style['background-color'] ?? style.background ?? '').match(/^#([\da-f]{6})$/i)?.[1]
  const borderColor = String(style.borderColor ?? style['border-color'] ?? style.border ?? '').match(/#([\da-f]{6})/i)?.[1] ?? 'D1D5DB'
  if (!color && !inset.border && !inset.left && !inset.right && !inset.top && !inset.bottom) return rows ? table : '<w:p/>'
  const borders = inset.border ? '<w:tcBorders>' + ['top', 'left', 'bottom', 'right'].map(side => `<w:${side} w:val="single" w:sz="${Math.max(1, Math.round(inset.border * 6))}" w:color="${borderColor}"/>`).join('') + '</w:tcBorders>' : ''
  return `<w:tbl><w:tblPr><w:tblW w:w="${twips(width + inset.left + inset.right + inset.border * 2)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${noBorders}</w:tblPr><w:tblGrid><w:gridCol w:w="${twips(width + inset.left + inset.right + inset.border * 2)}"/></w:tblGrid><w:tr><w:tc><w:tcPr>${borders}${color ? `<w:shd w:fill="${color}"/>` : ''}<w:tcMar>${(['top', 'left', 'bottom', 'right'] as const).map(side => `<w:${side} w:w="${twips(inset[side])}" w:type="dxa"/>`).join('')}</w:tcMar></w:tcPr>${rows ? table : ''}${emptyParagraph}</w:tc></w:tr></w:tbl>`
}
