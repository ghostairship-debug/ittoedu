import { describe, expect, it } from 'vitest'
import Ajv2020 from 'ajv/dist/2020.js'
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { mcpObjectInputSchema } from '../../src/main/workbench/external/mcpObjectInputSchema'
import { describeTools } from '../../src/core/tools/ToolCatalog'

const variants = {
  type: 'object',
  $defs: { word: { type: 'string', minLength: 1 } },
  oneOf: [
    { type: 'object', properties: { section: { const: 'instructions' }, value: { $ref: '#/$defs/word' } }, required: ['section', 'value'], additionalProperties: false },
    { type: 'object', properties: { section: { const: 'work' }, value: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1 } }, required: ['section', 'value'], additionalProperties: false },
  ],
}
function sameAcceptance(schema: Record<string, unknown>, examples: Array<[unknown, boolean]>) {
  const original = structuredClone(schema), projected = mcpObjectInputSchema(schema)
  const before = new Ajv2020({ strict: false }).compile(schema), after = new Ajv2020({ strict: false }).compile(projected)
  for (const [input, valid] of examples) {
    expect(before(input), JSON.stringify(input)).toBe(valid)
    expect(after(input), JSON.stringify(input)).toBe(valid)
  }
  expect(schema).toEqual(original)
  return projected
}
describe('MCP object-union field discovery', () => {
  it('exposes the real object.insert referenced branches without changing accepted arguments', () => {
    const schema = describeTools(['object.insert'])[0].schema
    const output = sameAcceptance(schema, [
      [{ target: 'page', kind: 'text', text: '标题' }, true],
      [{ project: 'lesson', path: 'pages/one', kind: 'shape', width: 120 }, true],
      [{ target: 'page', kind: 'text', width: -1 }, false],
      [{ target: 'page', kind: 'unknown' }, false],
      [{ kind: 'text' }, false],
      [{ target: 'page', kind: 'text', extra: 1 }, false],
    ])
    expect(output.properties).toHaveProperty('kind')
    expect(output.properties).toHaveProperty('target')
    expect(output.properties).toHaveProperty('path')
    expect(output.anyOf).toBe(schema.anyOf)
    expect(output.$defs).toBe(schema.$defs)
  })
  it('preserves values accepted through patternProperties and leaves unevaluated roots alone', () => {
    const schema = { type: 'object', anyOf: [
      { type: 'object', properties: { kind: { const: 'a' }, x: { type: 'integer' } }, required: ['kind'], additionalProperties: false },
      { type: 'object', properties: { kind: { const: 'b' } }, patternProperties: { '^x$': { type: 'string' } }, required: ['kind'], additionalProperties: false },
    ] }
    const output = sameAcceptance(schema, [[{ kind: 'b', x: 's' }, true], [{ kind: 'a', x: 1 }, true], [{ kind: 'a', x: 's' }, false], [{ kind: 'b', x: 1 }, false]])
    expect((output.properties as Record<string, unknown>).x).toEqual({})
    const unevaluated = { ...schema, unevaluatedProperties: false }
    expect(mcpObjectInputSchema(unevaluated)).toBe(unevaluated)
  })
  it('exposes fields while preserving strict union branches, root refs and actual valid/invalid arguments', () => {
    const output = sameAcceptance(variants, [
      [{ section: 'instructions', value: 'old requirement' }, true],
      [{ section: 'work', value: 0, limit: 2 }, true],
      [{ section: 'instructions', value: '' }, false],
      [{ section: 'instructions', value: 4 }, false],
      [{ section: 'work', value: '4' }, false],
      [{ section: 'work', value: -1 }, false],
      [{ section: 'work', value: 4, limit: 0 }, false],
      [{ section: 'instructions', value: 'ok', extra: 1 }, false],
      [{ value: 'missing section' }, false],
      [null, false],
    ])
    expect(output.properties).toHaveProperty('section')
    expect(output.properties).toHaveProperty('value')
    expect(output.properties).toHaveProperty('limit')
    expect(output.oneOf).toBe(variants.oneOf)
    expect(output.$defs).toBe(variants.$defs)
    expect(() => ListToolsResultSchema.parse({ tools: [{ name: 'handoff.read', inputSchema: output }] })).not.toThrow()
  })
  it('does not restrict values allowed by an open alternative or weaken original required fields', () => {
    const schema = { type: 'object', required: ['owner'], anyOf: [
      { type: 'object', properties: { owner: {}, mode: { const: 'strict' }, value: { type: 'integer' } }, required: ['mode'], additionalProperties: false },
      { type: 'object', properties: { owner: {}, mode: { const: 'open' } }, required: ['mode'], additionalProperties: true },
    ] }
    sameAcceptance(schema, [
      [{ owner: 'x', mode: 'strict', value: 5 }, true],
      [{ owner: 'x', mode: 'strict', value: 'five' }, false],
      [{ owner: 'x', mode: 'open', value: { arbitrary: true } }, true],
      [{ owner: 'x', mode: 'open', other: [1, 2] }, true],
      [{ mode: 'open', value: 4 }, false],
    ])
  })
  it('keeps overlapping oneOf rejection and boolean property constraints', () => {
    const schema = { type: 'object', oneOf: [
      { type: 'object', properties: { value: true }, required: ['value'], additionalProperties: false },
      { type: 'object', properties: { value: { type: 'number' }, forbidden: false }, required: ['value'], additionalProperties: false },
    ] }
    sameAcceptance(schema, [[{ value: 'only first' }, true], [{ value: 2 }, false], [{ value: 2, forbidden: 'x' }, false]])
  })
  it('leaves ordinary and unfamiliar root variants unchanged, without moving scoped references', () => {
    const ordinary = { type: 'object', properties: { value: { type: 'string' } } }
    expect(mcpObjectInputSchema(ordinary)).toBe(ordinary)
    const unfamiliar = { type: 'object', anyOf: [true, { type: 'object', properties: { value: {} } }] }
    expect(mcpObjectInputSchema(unfamiliar)).toBe(unfamiliar)
    const scoped = { type: 'object', oneOf: [{ type: 'object', properties: { value: { $id: 'urn:local', type: 'string' } }, required: ['value'], additionalProperties: false }] }
    expect(mcpObjectInputSchema(scoped).properties).toEqual({ value: {} })
    expect(mcpObjectInputSchema(scoped).oneOf).toBe(scoped.oneOf)
  })
})

