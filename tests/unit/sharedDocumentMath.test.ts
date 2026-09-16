import { describe, expect, it } from 'vitest'
import { DocumentMathError, MATH_SYMBOLS, parseDocumentMath } from '../../src/shared/document/math'
import { documentMathOmml, OMML_NAMESPACE } from '../../src/shared/document/omml'
import { documentMathCases } from '../fixtures/shared-document/mathCases'

const parseXml = (latex: string, display = true) => new DOMParser().parseFromString(`<root xmlns:m="${OMML_NAMESPACE}" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${documentMathOmml(latex, display)}</root>`, 'application/xml')
const find = (doc: Document | Element, name: string) => Array.from(doc.getElementsByTagNameNS(OMML_NAMESPACE, name))
describe('shared document finite mathematics', () => {
  it.each(documentMathCases)('$name emits nested editable OMML', ({ latex, tags }) => {
    const doc = parseXml(latex)
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    for (const tag of tags) expect(find(doc, tag).length, tag).toBeGreaterThan(0)
    expect(find(doc, 'oMath')).toHaveLength(1)
  })
  it('keeps numerator and denominator distinct, with nested exponent', () => {
    const doc = parseXml(documentMathCases[0].latex)
    expect(find(doc, 'num')[0]!.textContent).toBe('1+x')
    expect(find(doc, 'den')[0]!.textContent).toBe('x2')
    expect(find(find(doc, 'den')[0]!, 'sSup')).toHaveLength(1)
  })
  it('nary consumes one term and retains explicit groups and differential', () => {
    expect(parseDocumentMath(String.raw`\sum_{i=1}^n i^2+3`)).toMatchObject({ type: 'row', children: [{ type: 'nary', body: { type: 'scripts' } }, { value: '+' }, { value: '3' }] })
    expect(parseDocumentMath(String.raw`\int_0^1 x^2\,\mathrm{d}x=2`)).toMatchObject({ type: 'row', children: [{ type: 'nary', body: { type: 'row', children: [{ type: 'scripts' }, { type: 'symbol' }, { type: 'roman' }, { value: 'x' }] } }, { value: '=' }, { value: '2' }] })
    expect(parseDocumentMath(String.raw`\prod_i^n {-a_i+b_i}`)).toMatchObject({ type: 'nary', body: { type: 'row' } })
    expect(parseDocumentMath(String.raw`\sum_i^n -x+2`)).toMatchObject({ type: 'row', children: [{ type: 'nary', body: { type: 'row', children: [{ value: '-' }, { value: 'x' }] } }, { value: '+' }, { value: '2' }] })
  })
  it('sets limits by context and explicit override', () => {
    const location = (latex: string, display: boolean) => find(parseXml(latex, display), 'limLoc')[0]!.getAttributeNS(OMML_NAMESPACE, 'val')
    expect(location(String.raw`\sum_i^n{x}`, true)).toBe('undOvr')
    expect(location(String.raw`\sum_i^n{x}`, false)).toBe('subSup')
    expect(location(String.raw`\int_0^1{x}`, true)).toBe('subSup')
    expect(location(String.raw`\sum\nolimits_i^n{x}`, true)).toBe('subSup')
    expect(location(String.raw`\int_0^1\limits{x}`, false)).toBe('undOvr')
  })
  it('keeps rows, cells, alignment points, and Chinese normal runs', () => {
    const cases = parseXml(documentMathCases[8].latex)
    expect(find(cases, 'mr')).toHaveLength(2)
    expect(find(cases, 'nor')).toHaveLength(2)
    expect(find(cases, 'mcJc')[0]!.getAttributeNS(OMML_NAMESPACE, 'val')).toBe('left')
    const aligned = parseXml(documentMathCases[7].latex)
    expect(find(aligned, 'aln')).toHaveLength(2)
    expect(find(aligned, 'eqArr')[0]!.children.length).toBe(3)
  })
  it('supports the explicit existing symbol table', () => {
    for (const [name, value] of Object.entries(MATH_SYMBOLS)) expect(parseDocumentMath(`\\${name}`)).toEqual({ type: 'symbol', value })
  })
  it.each([String.raw`\foo{x}`, '$x$', String.raw`\frac{1}`, String.raw`x^^2`, String.raw`\sum_i^n`, String.raw`\left(x`, String.raw`\begin{matrix}1&2\\3\end{matrix}`, String.raw`\begin{aligned}x=2\end{aligned}`, String.raw`\begin{cases}x&a&b\end{cases}`, String.raw`\begin{matrix}\begin{matrix}x\end{matrix}\end{matrix}`, String.raw`\begin{matrix}1\\[2pt]2\end{matrix}`])('rejects incomplete or unsupported math %s with position', source => {
    expect(() => parseDocumentMath(source)).toThrow(DocumentMathError)
    try { parseDocumentMath(source) } catch (e) { expect((e as DocumentMathError).offset).toBeGreaterThanOrEqual(0) }
  })
})
