import { describe, expect, it } from 'vitest'
import { describeAuthoringToolDiscovery } from '@/renderer/authoring/tools/authoringToolFacade'
import { nativeAuthoringToolInputSchema } from '@/renderer/authoring/tools/nativeAuthoringTool'
import { readCourseAgentCapability, type CourseAgentCapabilityData } from '@/shared/courseAgentCapabilities'

function discoveryData(): CourseAgentCapabilityData {
  const tool = describeAuthoringToolDiscovery().find(entry => entry.name === 'native.content')!
  return { version: 1, semanticVersion: '0'.repeat(64),
    entries: [{ id: tool.name, kind: 'tool', label: tool.name, path: 'tools/native.content.json', scopes: tool.supportedScopes,
      carriers: ['native'], variants: tool.variants, summary: tool.description!, dependencies: [] }],
    files: { 'tools/native.content.json': JSON.stringify({ version: 1, ...tool }) } }
}

describe('Native content edit discovery uses executable narrow operations', () => {
  it.each(['edit-text', 'edit-image', 'edit-formula'])('selects the complete %s branch with a closed schema inside the existing initial card budget', operation => {
    const card = readCourseAgentCapability(discoveryData(), 'native.content', { operation })
    if (!('content' in card)) throw new Error('Expected typed card')
    const schema = card.content.inputSchema
    expect(schema.oneOf).toHaveLength(1)
    expect(schema.oneOf[0].properties.operation.const).toBe(operation)
    const input = operation === 'edit-text' ? { operation, text: '新标题', textStyle: { fontSize: 44 }, properties: { frame: { x: 40 } } }
      : operation === 'edit-image' ? { operation, image: { assetId: 'existing-image' } }
      : { operation, formula: { ast: { type: 'token', value: 'x' }, accessibleText: 'x' } }
    expect(nativeAuthoringToolInputSchema.parse(input)).toEqual(input)
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      if ('$ref' in value) {
        const reference = String(value.$ref)
        expect(reference).toMatch(/^#\//)
        expect(reference.slice(2).split('/').reduce((node, key) => node?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], schema)).toBeDefined()
      }
      Object.values(value).forEach(visit)
    }
    visit(schema)
    if (operation === 'edit-text') {
      expect(JSON.stringify(schema)).toContain('fontSize')
      expect(JSON.stringify(schema)).toContain('frame')
      expect(JSON.stringify(schema)).not.toContain('accessibleText')
      expect(JSON.stringify(schema)).not.toContain('assetId')
    }
    // Mirror only the existing metadata deduplication. The full selected schema,
    // examples, invocation and recovery remain in the measured initial card.
    const { variants: _variants, ...entry } = card.entry
    const initial = { ...card, entry, content: { ...card.content } }
    delete initial.content.description; delete initial.content.variants; delete initial.content.supportedScopes
    expect(new TextEncoder().encode(JSON.stringify([initial])).byteLength).toBeLessThanOrEqual(5_200)
  })
  it('keeps the old edit wire shape and rejects fields outside a selected content family', () => {
    expect(nativeAuthoringToolInputSchema.parse({ operation: 'edit', text: '兼容文字' })).toEqual({ operation: 'edit', text: '兼容文字' })
    expect(nativeAuthoringToolInputSchema.parse({ operation: 'edit', formula: { ast: { type: 'token', value: 'x' }, accessibleText: 'x' } }).operation).toBe('edit')
    expect(nativeAuthoringToolInputSchema.safeParse({ operation: 'edit-text', image: { assetId: 'image' } }).success).toBe(false)
    expect(nativeAuthoringToolInputSchema.safeParse({ operation: 'edit-formula', formula: { ast: { type: 'token', value: 'x' } } }).success).toBe(false)
  })
})
