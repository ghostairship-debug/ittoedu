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
          const resolved = typeof variant.$ref === 'string' && variant.$ref.startsWith('#/$defs/')
            ? (tool.schema.$defs as Record<string, Record<string, unknown>>)[variant.$ref.slice('#/$defs/'.length)] : variant
          expect(resolved, tool.name).toBeDefined()
          expect(resolved.type, tool.name).toBe('object')
          expect(resolved.additionalProperties, tool.name).toBe(false)
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
    const variants = insertion.anyOf as Record<string, any>[]
    const handleVariant = variants[0]!.$ref ? (insertion.$defs as Record<string, any>)[variants[0]!.$ref.slice('#/$defs/'.length)] : variants[0]
    const resolve = (field: any) => field.$ref ? (insertion.$defs as Record<string, any>)[field.$ref.slice('#/$defs/'.length)] : field
    expect(resolve(handleVariant.properties.target)).toMatchObject({ type: 'string' })
    expect(resolve(handleVariant.properties.kind)).toMatchObject({ enum: expect.arrayContaining(['text', 'table', 'chart', 'input']) })
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
    expect(mapMarkdownRange('abcDEFghi', '!abcDEFghi!', range)).toEqual({ ...range, from: 4, to: 7 })
    expect(() => mapMarkdownRange('aaaa', 'aaaaa', { kind: 'markdown-range', from: 1, to: 2 })).toThrow('不唯一')
  })
})
