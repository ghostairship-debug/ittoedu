import { parseDocumentMath, describeDocumentMath } from '../../../shared/document/math'
import { OMML_NAMESPACE } from '../../../shared/document/omml'

const elements = (node: Element) => Array.from(node.childNodes).filter((child): child is Element => child.nodeType === 1)
const children = (node: Element, name: string) => elements(node).filter(child => child.namespaceURI === OMML_NAMESPACE && child.localName === name)
const first = (node: Element, name: string) => children(node, name)[0]
const value = (node: Element | undefined) => node?.getAttributeNS(OMML_NAMESPACE, 'val') ?? undefined
const enabled = (node: Element | undefined) => !!node && !['0', 'false', 'off'].includes(value(node) ?? '')
const escapeText = (text: string) => text.replace(/[\\{}%$_&#]/g, '\\$&')
const literal = (text: string) => Array.from(text).map(char => /[a-zA-Z0-9+\-*/=<>()[\].,;:!|%−±∓×·÷≤≥≠≈∝→←↔∈∉α-ωΑ-Ω∞]/u.test(char)
  ? char : ['{', '}', '_', '$'].includes(char) ? '\\' + char : `\\text{${escapeText(char)}}`).join('')
const delimiterNames: Record<string, string> = { '{': '\\{', '}': '\\}', '⟨': '\\langle', '⟩': '\\rangle', '‖': '\\Vert', '': '.' }
const delimiter = (text: string) => delimiterNames[text] ?? text
const naryCommands: Record<string, string> = { '∑': 'sum', '∏': 'prod', '∫': 'int' }

/** Map Office math only to the existing editable grammar; the caller retains unsupported XML. */
export function importOmmlMath(math: Element): { latex: string; accessibleText: string } {
  const renderChildren = (node: Element): string => elements(node).filter(child => !child.localName.endsWith('Pr')).map(render).join('')
  const slot = (node: Element, name: string): string => { const child = first(node, name); return child ? renderChildren(child) : '' }
  const render = (node: Element): string => {
    if (node.namespaceURI !== OMML_NAMESPACE) throw new Error(`公式含不支持的节点 ${node.nodeName}`)
    switch (node.localName) {
      case 'oMath': case 'e': case 'num': case 'den': case 'deg': case 'sub': case 'sup': return renderChildren(node)
      case 'r': {
        const properties = first(node, 'rPr'), text = children(node, 't').map(child => child.textContent ?? '').join('')
        if (elements(node).some(child => child.localName === 't' ? child.namespaceURI !== OMML_NAMESPACE : !child.localName.endsWith('Pr'))) throw new Error('公式文字含不支持的节点')
        if (enabled(properties && first(properties, 'nor'))) return `\\text{${escapeText(text)}}`
        const contents = literal(text)
        return value(properties && first(properties, 'sty')) === 'p' ? `\\mathrm{${contents}}` : contents
      }
      case 'f': {
        const properties = first(node, 'fPr'), type = value(properties && first(properties, 'type'))
        if (type && type !== 'bar') throw new Error(`公式分式类型 ${type} 尚不能映射`)
        return `\\frac{${slot(node, 'num')}}{${slot(node, 'den')}}`
      }
      case 'rad': {
        const properties = first(node, 'radPr'), degree = slot(node, 'deg')
        return `\\sqrt${degree && !enabled(properties && first(properties, 'degHide')) ? `[${degree}]` : ''}{${slot(node, 'e')}}`
      }
      case 'sSub': case 'sSup': case 'sSubSup': {
        const sub = slot(node, 'sub'), sup = slot(node, 'sup')
        return `{${slot(node, 'e')}}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''}`
      }
      case 'nary': {
        const properties = first(node, 'naryPr'), operator = value(properties && first(properties, 'chr')) ?? '∫'
        const command = naryCommands[operator]
        if (!command) throw new Error(`公式运算符 ${operator} 尚不能映射`)
        const sub = slot(node, 'sub'), sup = slot(node, 'sup'), location = value(properties && first(properties, 'limLoc'))
        if (sub && enabled(properties && first(properties, 'subHide')) || sup && enabled(properties && first(properties, 'supHide'))) throw new Error('公式隐藏的非空上下限尚不能映射')
        return `\\${command}${location ? location === 'undOvr' ? '\\limits' : '\\nolimits' : ''}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''}{${slot(node, 'e')}}`
      }
      case 'd': {
        const properties = first(node, 'dPr'), begin = value(properties && first(properties, 'begChr')) ?? '(', end = value(properties && first(properties, 'endChr')) ?? ')'
        const separator = value(properties && first(properties, 'sepChr')) ?? '|'
        return `\\left${delimiter(begin)} ${children(node, 'e').map(renderChildren).join(literal(separator))}\\right${delimiter(end)}`
      }
      case 'm': return `\\begin{matrix}${children(node, 'mr').map(row => children(row, 'e').map(renderChildren).join('&')).join('\\\\')}\\end{matrix}`
      case 'eqArr': {
        const rows = children(node, 'e').map(row => {
          const parts = elements(row).filter(child => !child.localName.endsWith('Pr'))
          const split = parts.findIndex(child => child.localName === 'r' && enabled(first(child, 'rPr') && first(first(child, 'rPr')!, 'aln')))
          return split === -1 ? parts.map(render).join('') + '&' : parts.slice(0, split).map(render).join('') + '&' + parts.slice(split).map(render).join('')
        })
        return `\\begin{aligned}${rows.join('\\\\')}\\end{aligned}`
      }
      case 'func': return `\\mathrm{${slot(node, 'fName')}}{${slot(node, 'e')}}`
      default: throw new Error(`公式结构 ${node.localName} 尚不能映射`)
    }
  }
  const latex = render(math), parsed = parseDocumentMath(latex)
  return { latex, accessibleText: describeDocumentMath(parsed) }
}
