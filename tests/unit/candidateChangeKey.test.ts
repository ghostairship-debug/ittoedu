// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { candidateChangeKey } from '../../src/main/localAgent/candidateChangeKey'
import type { GenerationCandidate } from '../../src/shared/generationContract'

const destination: GenerationCandidate['steps'][number]['destination'] = { kind: 'update', target: {
  projectId: 'project', documentRevision: 1, revisionPolicy: { kind: 'exact' }, sessionGeneration: 1,
  surfaceType: 'slide', surfaceId: 'slides', locationId: 'page', stateId: null,
  owner: 'scene', ownerKey: 'scene:page', itemId: 'title', authoringAddress: 'page/title',
} }
function candidate(input: GenerationCandidate['steps'][number]['input'], tool = 'native.content'): GenerationCandidate {
  return { version: 1, requestId: '0d7707e8-a038-4268-bb34-486289611708', candidateId: 'fed9470a-e68f-4bd6-928d-b9c4c54e60f2', summary: 'Change title',
    afterCommit: { version: 1, action: 'finish' }, steps: [{ id: 'edit', tool, carrier: tool === 'runtime.source' ? 'runtime' : 'native', destination,
      input, lowerCarrierReason: 'Required by current content' }] }
}
function source(text: string): GenerationCandidate { return candidate({ source: text }, 'runtime.source') }
function fileSource(text: string, operation: 'patch' | 'revise', encoding: 'utf8' | 'base64' = 'utf8'): GenerationCandidate {
  return candidate({ operation, ...(operation === 'patch' ? { mode: 'shared', basePackageId: 'component', deleteFiles: [] } : {}),
    baseVersion: '1.0.0', baseContentIdentity: 'a'.repeat(64),
    [operation === 'patch' ? 'changedFiles' : 'files']: { 'runtime.js': encoding === 'utf8' ? { encoding: 'utf8', text } : Buffer.from(text).toString('base64') },
  }, 'component.package')
}

describe('candidate operation semantic change key', () => {
  it('ignores candidate presentation, step labels, and object key insertion order', () => {
    const first = candidate({ operation: 'patch', props: { fontSize: 48, text: 'Title' } })
    const second = candidate({ props: { text: 'Title', fontSize: 48 }, operation: 'patch' })
    second.requestId = 'b3892eb1-8f1d-4c41-86da-e089034a1acd'
    second.candidateId = '0d7707e8-a038-4268-bb34-486289611708'
    second.summary = 'Different explanation'
    second.afterCommit = { version: 1, action: 'observe', reason: 'Different commentary' }
    second.steps[0]!.id = 'renamed-display-label'
    second.steps[0]!.lowerCarrierReason = 'Different explanation'
    expect(candidateChangeKey(second)).toBe(candidateChangeKey(first))
    expect(first.steps[0]!.id).toBe('edit')
  })

  it('normalizes only formal result and created-target step references by step order', () => {
    const first = candidate({ operation: 'import', text: 'Literal step name is data' })
    first.steps.push({ ...first.steps[0]!, id: 'use-asset', destination: { kind: 'created-item', stepId: 'edit', index: 0 },
      input: { assetId: { $result: { stepId: 'edit', kind: 'asset-id' } }, nested: [{ target: { $result: { stepId: 'edit', kind: 'item-id', index: 1 } } }] } })
    first.steps.push({ ...first.steps[0]!, id: 'scope', destination: { kind: 'created-scope', stepId: 'use-asset', parent: { kind: 'owner' }, insertion: { kind: 'append' } }, input: {} })
    const renamed = structuredClone(first)
    renamed.steps[0]!.id = 'imported'
    renamed.steps[1]!.id = 'placed'
    renamed.steps[2]!.id = 'children'
    renamed.steps[1]!.destination = { kind: 'created-item', stepId: 'imported', index: 0 }
    renamed.steps[1]!.input = { nested: [{ target: { $result: { kind: 'item-id', index: 1, stepId: 'imported' } } }], assetId: { $result: { kind: 'asset-id', index: 0, stepId: 'imported' } } }
    renamed.steps[2]!.destination = { kind: 'created-scope', stepId: 'placed', parent: { kind: 'owner' }, insertion: { kind: 'append' } }
    expect(candidateChangeKey(renamed)).toBe(candidateChangeKey(first))
    renamed.steps[1]!.input = { assetId: { $result: { stepId: 'imported', kind: 'asset-id', index: 1 } } }
    expect(candidateChangeKey(renamed)).not.toBe(candidateChangeKey(first))
    expect(candidateChangeKey(candidate({ stepId: 'a', text: 'a' }))).not.toBe(candidateChangeKey(candidate({ stepId: 'b', text: 'b' })))
  })

  it('retains actual parameters, source logic, target identity, and array order', () => {
    expect(candidateChangeKey(candidate({ fontSize: 48 }))).not.toBe(candidateChangeKey(candidate({ fontSize: 49 })))
    expect(candidateChangeKey(candidate({ order: [1, 2] }))).not.toBe(candidateChangeKey(candidate({ order: [2, 1] })))
    expect(candidateChangeKey(source('return api.speed * 2;'))).not.toBe(candidateChangeKey(source('return api.speed * 3;')))
    const anotherTarget = candidate({ fontSize: 48 })
    anotherTarget.steps[0]!.destination = { ...destination, target: { ...destination.target, itemId: 'other-title' } }
    expect(candidateChangeKey(anotherTarget)).not.toBe(candidateChangeKey(candidate({ fontSize: 48 })))
  })

  it('ignores runtime JavaScript comments and formatting without altering quoted text', () => {
    const first = source('const speed = 2; return { label: "https://example.test/*text*/", speed };')
    const formatted = source("// clarify the operation\nconst speed=2; /* unchanged */ return { label: 'https://example.test/*text*/', speed };\n")
    expect(candidateChangeKey(formatted)).toBe(candidateChangeKey(first))
    expect(candidateChangeKey(source('return "/*keep*/ // keep";'))).not.toBe(candidateChangeKey(source('return "// keep";')))
    expect(candidateChangeKey(candidate({ source: 'return 1;' }))).not.toBe(candidateChangeKey(candidate({ source: 'return 1; // note' })))
  })

  it.each(['patch', 'revise'] as const)('normalizes %s package JavaScript in UTF8 and base64 while retaining other files', operation => {
    expect(candidateChangeKey(fileSource('return api.speed * 2;', operation))).toBe(candidateChangeKey(fileSource('// note\nreturn api.speed*2;', operation, 'base64')))
    expect(candidateChangeKey(fileSource('return api.speed * 3;', operation))).not.toBe(candidateChangeKey(fileSource('return api.speed * 2;', operation)))
    const first = fileSource('return 1;', operation)
    const second = structuredClone(first)
    const field = operation === 'patch' ? 'changedFiles' : 'files'
    ;(first.steps[0]!.input as any)[field]['notes.txt'] = { encoding: 'utf8', text: 'return 1;' }
    ;(second.steps[0]!.input as any)[field]['notes.txt'] = { encoding: 'utf8', text: 'return 1; // note' }
    expect(candidateChangeKey(first)).not.toBe(candidateChangeKey(second))
  })

  it('preserves BigInt, regular expression, numeric overflow, and tagged-template semantics', () => {
    const first = source('const n = 12n; const re = /a\\/\\*b/gi; return String.raw`\\n/*literal*/${n}`;')
    const formatted = source('/* comment */ const n=0xcn; const re=/a\\/\\*b/gi; return String.raw`\\n/*literal*/${n}`;')
    expect(candidateChangeKey(formatted)).toBe(candidateChangeKey(first))
    expect(candidateChangeKey(source('return 12n;'))).not.toBe(candidateChangeKey(source('return 13n;')))
    const regex = String.raw`return /a\/b/g;`
    expect(candidateChangeKey(source(regex))).toBe(candidateChangeKey(source('// same regex\n' + regex)))
    expect(candidateChangeKey(source(regex))).not.toBe(candidateChangeKey(source(String.raw`return /a\/c/g;`)))
    expect(candidateChangeKey(source('return /a/g;'))).not.toBe(candidateChangeKey(source('return /a/i;')))
    expect(candidateChangeKey(source('return 1e400;'))).not.toBe(candidateChangeKey(source('return null;')))
    expect(candidateChangeKey(source('return String.raw`\\n`;'))).not.toBe(candidateChangeKey(source('return String.raw`\n`;')))
    expect(candidateChangeKey(source('return `/*literal*/`;'))).not.toBe(candidateChangeKey(source('return ``;')))
  })

  it('parses known JavaScript modules and normalizes lexical trivia when their grammar is invalid', () => {
    expect(candidateChangeKey(fileSource('export const value = 1;', 'revise'))).toBe(candidateChangeKey(fileSource('/* comment */ export const value=1;', 'revise')))
    expect(candidateChangeKey(source('function ( // invalid'))).toBe(candidateChangeKey(source('function ( // changed invalid')))
    expect(candidateChangeKey(fileSource('const value: number = 1;', 'patch'))).toBe(candidateChangeKey(fileSource('const value: number = 1; // unsupported TS', 'patch')))
  })

  it('ignores comments and formatting in syntax-error drafts but retains actual token changes', () => {
    const first = source('const value = ; const amount = 12n;')
    const formatted = source('/* revised explanation */\nconst\nvalue=; // still missing the same expression\nconst amount\n= 12n;\n')
    expect(candidateChangeKey(formatted)).toBe(candidateChangeKey(first))
    expect(candidateChangeKey(source('const value = ; const amount = 13n;'))).not.toBe(candidateChangeKey(first))
    expect(candidateChangeKey(source('const value = ; const amount = 12n + 1n;'))).not.toBe(candidateChangeKey(first))
    expect(candidateChangeKey(source('const value = 0; const amount = 12n;'))).not.toBe(candidateChangeKey(first))
    expect(candidateChangeKey(source('return\nvalue; const broken = ;'))).not.toBe(candidateChangeKey(source('return value; const broken = ;')))
  })

  it('preserves strings, template raw chunks, and regexes in the lexical fallback', () => {
    const malformed = 'const broken = ; '
    const regex = String.raw`const matcher = /a\/b\/\*text\*/gi;`
    expect(candidateChangeKey(source(malformed + regex))).toBe(candidateChangeKey(source('/* note */' + malformed + regex + '// another note')))
    expect(candidateChangeKey(source(malformed + regex))).not.toBe(candidateChangeKey(source(malformed + String.raw`const matcher = /a\/c\/\*text\*/gi;`)))
    expect(candidateChangeKey(source(malformed + regex))).not.toBe(candidateChangeKey(source(malformed + String.raw`const matcher = /a\/b\/\*text\*/g;`)))
    expect(candidateChangeKey(source(malformed + 'const text = "/* keep */ // keep";'))).not.toBe(candidateChangeKey(source(malformed + 'const text = "// keep";')))
    expect(candidateChangeKey(source(malformed + 'const text = String.raw`\\n/*keep*/`;'))).not.toBe(candidateChangeKey(source(malformed + 'const text = String.raw`\n/*keep*/`;')))
    expect(candidateChangeKey(source(malformed + 'const text = `/* keep */`;'))).not.toBe(candidateChangeKey(source(malformed + 'const text = ``;')))
  })

  it('retains exact source only when lexical analysis also fails', () => {
    const unterminatedString = 'const text = "unterminated'
    const unterminatedComment = 'const broken = ; /* unterminated'
    expect(candidateChangeKey(source(unterminatedString))).not.toBe(candidateChangeKey(source('// added note\n' + unterminatedString)))
    expect(candidateChangeKey(source(unterminatedComment))).not.toBe(candidateChangeKey(source(unterminatedComment + ' changed')))
    expect(candidateChangeKey(fileSource(unterminatedString, 'patch'))).toBe(candidateChangeKey(fileSource(unterminatedString, 'patch', 'base64')))
  })

  it('uses a bounded key without truncating later source changes', () => {
    const padding = ' '.repeat(170_000)
    const first = candidate({ text: padding + 'first' }), second = candidate({ text: padding + 'second' })
    expect(candidateChangeKey(first)).toMatch(/^candidate-change-v1:[a-f0-9]{64}$/)
    expect(candidateChangeKey(first)).not.toBe(candidateChangeKey(second))
    expect(candidateChangeKey(source(padding + 'return 1;'))).toBe(candidateChangeKey(source('return 1;')))
  })
})
