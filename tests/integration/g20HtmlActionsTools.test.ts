import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { htmlActionToolCatalog, htmlActionToolSchemas, isHtmlActionTool } from '../../src/core/tools/HtmlActionTools'

describe('M28 HTML action tool contract', () => {
  it('accepts only model intent and excludes host-issued identity and operation IDs', () => {
    expect(htmlActionToolSchemas['html.observe'].parse({})).toEqual({})
    expect(htmlActionToolSchemas['html.navigate'].parse({ index: 2 })).toEqual({ index: 2 })
    expect(htmlActionToolSchemas['html.click'].parse({ handle: 'observed-handle' })).toEqual({ handle: 'observed-handle' })
    expect(htmlActionToolSchemas['html.input'].parse({ handle: 'observed-handle', value: '答案' }))
      .toEqual({ handle: 'observed-handle', value: '答案' })
    expect(htmlActionToolSchemas['html.errors'].parse({})).toEqual({})
    for (const schema of Object.values(htmlActionToolSchemas)) {
      expect(schema.safeParse({ operationId: 'model-picked' }).success).toBe(false)
      const exported = z.toJSONSchema(schema)
      expect(JSON.stringify(exported)).not.toMatch(/operationId|documentId|revision|leaseId|loadId|runId/)
    }
    expect(htmlActionToolSchemas['html.click'].safeParse({ handle: 'x', operationId: 'model-picked' }).success).toBe(false)
    expect(htmlActionToolSchemas['html.input'].safeParse({ handle: 'x', value: 'ok', documentId: 'other' }).success).toBe(false)
    expect(htmlActionToolSchemas['html.input'].safeParse({ handle: 'x', value: 'a'.repeat(8193) }).success).toBe(false)
  })

  it('lists only the five narrow tools and identifies interactive effects', () => {
    expect(htmlActionToolCatalog.map(tool => tool.name)).toEqual([
      'html.observe', 'html.navigate', 'html.click', 'html.input', 'html.errors',
    ])
    expect(htmlActionToolCatalog.filter(tool => tool.manual.group === 'edit').map(tool => tool.name))
      .toEqual(['html.click', 'html.input'])
    expect(isHtmlActionTool('html.click')).toBe(true)
    expect(isHtmlActionTool('html.import')).toBe(false)
  })
})
