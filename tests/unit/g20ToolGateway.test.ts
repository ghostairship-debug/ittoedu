// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { describeTools, pendingToolMigrations, toolCatalog } from '../../src/core/tools/ToolCatalog'
import { layerItemPropertiesInputSchema } from '../../src/core/tools/toolSchemas'
import { containsTarget, mapMarkdownRange } from '../../src/core/tools/ToolTargets'

describe('G20 tool catalog and target mapping', () => {
  it('exports the executable registry as strict model schemas and manual metadata', () => {
    const tools = describeTools()
    expect(tools.map(tool => tool.name)).toEqual(toolCatalog.map(tool => tool.name))
    for (const tool of tools) {
      expect(tool.schema.type).toBe('object')
      const variants = tool.schema.oneOf ?? tool.schema.anyOf
      if (Array.isArray(variants)) {
        for (const variant of variants) {
          expect(variant.type).toBe('object')
          expect(variant.additionalProperties).toBe(false)
        }
      } else expect(tool.schema.additionalProperties).toBe(false)
      expect(tool.manual.label.length).toBeGreaterThan(0)
      expect(JSON.stringify(tool.schema)).not.toMatch(/documentId|epoch|operationId|baseRevision|grantId/)
    }
    expect(layerItemPropertiesInputSchema.safeParse({ frame: { width: -1 } }).success).toBe(false)
    expect(layerItemPropertiesInputSchema.safeParse({ projectId: 'forged' }).success).toBe(false)
    expect(pendingToolMigrations).toContain('component.package')
    expect(describeTools(['component.package'])).toEqual([])
    expect(describeTools(['document.insert'])).toHaveLength(1)
    const definitions = describeTools(['document.insert'])[0].schema.$defs as { flowInsertBlock: { oneOf: { properties: Record<string, unknown> }[] } }
    expect(definitions.flowInsertBlock.oneOf.some(option => 'content' in option.properties)).toBe(true)
    expect(definitions.flowInsertBlock.oneOf.every(option => !('id' in option.properties))).toBe(true)
    const insertion = { kind: 'flow-container' as const, surfaceId: 'flow', parentId: null, index: 1 }
    expect(containsTarget(insertion, { ...insertion, index: 0 })).toBe(false)
    expect(containsTarget(insertion, { kind: 'flow-block', surfaceId: 'flow', parentId: null, blockId: 'existing' })).toBe(false)
  })

  it('maps proven disjoint edits and refuses overlap or ambiguous edits', () => {
    const range = { kind: 'markdown-range' as const, from: 3, to: 6 }
    expect(mapMarkdownRange('abcDEFghi', 'a-long-bcDEFghi', range)).toEqual({ ...range, from: 9, to: 12 })
    expect(mapMarkdownRange('abcDEFghi', 'abcDEF-more', range)).toEqual(range)
    expect(() => mapMarkdownRange('abcDEFghi', 'abcDE!Fghi', range)).toThrow('重叠')
    expect(() => mapMarkdownRange('abcDEFghi', '!abcDEFghi!', range)).toThrow('重叠')
    expect(() => mapMarkdownRange('aaaa', 'aaaaa', { kind: 'markdown-range', from: 1, to: 2 })).toThrow('不唯一')
  })
})
