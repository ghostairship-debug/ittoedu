// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { describeTools, toolCatalog } from '../../src/core/tools/ToolCatalog'
import { objectUpdatePropertiesInputSchema } from '../../src/core/tools/toolSchemas'
import { containsTarget, mapMarkdownRange } from '../../src/core/tools/ToolTargets'

const schemaPropertyNames = (value: unknown): string[] => !value || typeof value !== 'object' ? []
  : Array.isArray(value) ? value.flatMap(schemaPropertyNames)
    : Object.entries(value).flatMap(([key, child]) => [
      ...(key === 'properties' && child && typeof child === 'object' ? Object.keys(child) : []), ...schemaPropertyNames(child)])

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
      // No internal identity is a model field; a description may still name one to warn against it.
      expect(schemaPropertyNames(tool.schema).filter(name => /^(documentId|epoch|operationId|baseRevision|grantId)$/.test(name))).toEqual([])
    }
    expect(objectUpdatePropertiesInputSchema.safeParse({ frame: { width: -1 } }).success).toBe(false)
    expect(objectUpdatePropertiesInputSchema.safeParse({ projectId: 'forged' }).success).toBe(false)
    expect(describeTools(['component.package'])).toEqual([])
    expect(describeTools(['object.insert'])).toHaveLength(1)
    const insertion = describeTools(['object.insert'])[0].schema
    expect(insertion.properties).toMatchObject({ target: { type: 'string' }, kind: { enum: expect.arrayContaining(['text', 'table', 'chart', 'input']) } })
    expect(Object.keys(insertion.properties ?? {})).not.toContain('id')
    const surface = { kind: 'course-surface' as const, surfaceId: 'flow', stateId: 'current' }
    expect(containsTarget(surface, { ...surface, surfaceId: 'other' })).toBe(false)
    expect(containsTarget(surface, { ...surface, stateId: 'other' })).toBe(false)
    expect(containsTarget(surface, { ...surface })).toBe(true)
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
