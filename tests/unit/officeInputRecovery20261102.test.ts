import { describe, expect, it } from 'vitest'
import { officeContentSchemas } from '../../src/core/tools/OfficeContentTools'
import { compactToolInputError } from '../../src/core/tools/ToolInputDiagnostic'

describe('Office schema recovery for a real PPT original edit', () => {
  it('directs a missing-slide request back to its Office original owner', () => {
    const call = { name: 'office.edit', input: { path: 'PPT共编验收.pptx', content: { format: 'pptx', edits: [{ oldText: '未编辑的第二页', newText: 'AI局改后的第二页' }] } } }
    const parsed = officeContentSchemas['office.edit'].safeParse(call.input)
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('The incomplete original edit must not be accepted')
    const result = compactToolInputError(parsed.error, call)
    expect(result.data).toMatchObject({ tool: 'office.edit', target: call.input.path, field: 'content.edits.0.slide', read: { name: 'office.inspect', input: { path: call.input.path } } })
    expect(result.message).not.toContain('project.read')
  })
})
