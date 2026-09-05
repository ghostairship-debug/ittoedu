import { describe, expect, it } from 'vitest'
import { createTableNode } from '@/renderer/project/nativeNodeFactories'
import { buildNativeTableLayout } from '@/shared/nativeTableLayout'

describe('nativeTableLayout buildNativeTableLayout', () => {
  it('builds scaled layout matching target frame dimensions', () => {
    const table = createTableNode({
      width: 600,
      height: 300,
    })

    const layout = buildNativeTableLayout(
      {
        columns: table.columns,
        rows: table.rows,
        headerRowCount: table.headerRowCount,
        style: table.style,
      },
      { width: 900, height: 450 },
    )

    expect(layout.width).toBe(900)
    expect(layout.height).toBe(450)
    expect(layout.columns).toHaveLength(3)
    expect(layout.rows).toHaveLength(3)
    expect(layout.cells).toHaveLength(9)

    // Check header row styling
    expect(layout.rows[0]!.isHeader).toBe(true)
    expect(layout.rows[1]!.isHeader).toBe(false)
    expect(layout.rows[0]!.cells[0]!.isHeader).toBe(true)
    expect(layout.rows[0]!.cells[0]!.style.bold).toBe(true)

    // Check coordinates tiling
    expect(layout.columns[0]!.x).toBe(0)
    expect(layout.columns[1]!.x).toBeCloseTo(layout.columns[0]!.width, 1)
    expect(layout.columns[0]!.width + layout.columns[1]!.width + layout.columns[2]!.width).toBe(900)

    expect(layout.rows[0]!.y).toBe(0)
    expect(layout.rows[0]!.height + layout.rows[1]!.height + layout.rows[2]!.height).toBe(450)

    // Check cells match columns and rows
    for (const cell of layout.cells) {
      const col = layout.columns[cell.columnIndex]!
      const row = layout.rows[cell.rowIndex]!
      expect(cell.x).toBe(col.x)
      expect(cell.y).toBe(row.y)
      expect(cell.width).toBe(col.width)
      expect(cell.height).toBe(row.height)
      expect(cell.columnId).toBe(col.id)
      expect(cell.rowId).toBe(row.id)
    }

    // Check grid lines
    expect(layout.verticalGridLines).toHaveLength(4)
    expect(layout.horizontalGridLines).toHaveLength(4)
  })

  it('inherits cell styles from table style unless overridden', () => {
    const table = createTableNode()
    // Override one cell's textColor and fontSize
    table.rows[1]!.cells[1]!.style = {
      textColor: '#ff0000',
      fontSize: 28,
    }

    const layout = buildNativeTableLayout({
      columns: table.columns,
      rows: table.rows,
      headerRowCount: table.headerRowCount,
      style: table.style,
    })

    const cell00 = layout.rows[0]!.cells[0]!
    const cell11 = layout.rows[1]!.cells[1]!

    expect(cell00.style.textColor).toBe(table.style.textColor)
    expect(cell00.style.fontSize).toBe(table.style.fontSize)

    expect(cell11.style.textColor).toBe('#ff0000')
    expect(cell11.style.fontSize).toBe(28)
    expect(cell11.style.fontFamily).toBe(table.style.fontFamily)
  })
})
