import { parseDocumentMath, type MathNode } from './math'

export const OMML_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')

/** ISO 29500 math objects. No renderer DOM, image, or legacy AST dependency. */
export function documentMathOmml(latex: string, display = false): string {
  const render = (node: MathNode, roman = false): string => {
    const wrap = (tag: string, child?: MathNode) => `<m:${tag}>${child ? render(child, roman) : ''}</m:${tag}>`
    switch (node.type) {
      case 'row': return node.children.map(child => render(child, roman)).join('')
      case 'text': case 'symbol': return `<m:r>${node.type === 'text' ? '<m:rPr><m:nor/></m:rPr>' : roman ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ''}<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" w:eastAsia="Microsoft YaHei"/></w:rPr><m:t xml:space="preserve">${xml(node.value)}</m:t></m:r>`
      case 'roman': return render(node.body, true)
      case 'fraction': return `<m:f>${wrap('num', node.numerator)}${wrap('den', node.denominator)}</m:f>`
      case 'root': return `<m:rad><m:radPr><m:degHide m:val="${node.degree ? 0 : 1}"/></m:radPr>${wrap('deg', node.degree)}${wrap('e', node.body)}</m:rad>`
      case 'scripts': {
        const tag = node.sub && node.sup ? 'sSubSup' : node.sub ? 'sSub' : 'sSup'
        return `<m:${tag}>${wrap('e', node.base)}${node.sub ? wrap('sub', node.sub) : ''}${node.sup ? wrap('sup', node.sup) : ''}</m:${tag}>`
      }
      case 'nary': {
        const limits = node.limits ?? (display && node.operator !== '∫')
        return `<m:nary><m:naryPr><m:chr m:val="${node.operator}"/><m:limLoc m:val="${limits ? 'undOvr' : 'subSup'}"/><m:subHide m:val="${node.sub ? 0 : 1}"/><m:supHide m:val="${node.sup ? 0 : 1}"/></m:naryPr>${wrap('sub', node.sub)}${wrap('sup', node.sup)}${wrap('e', node.body)}</m:nary>`
      }
      case 'delimiter': return `<m:d><m:dPr><m:begChr m:val="${xml(node.left)}"/><m:endChr m:val="${xml(node.right)}"/></m:dPr>${wrap('e', node.body)}</m:d>`
      case 'aligned': return `<m:eqArr><m:eqArrPr><m:baseJc m:val="center"/></m:eqArrPr>${node.rows.map(cells => `<m:e>${render(cells[0]!, roman)}<m:r><m:rPr><m:aln/></m:rPr><m:t/></m:r>${render(cells[1]!, roman)}</m:e>`).join('')}</m:eqArr>`
      case 'matrix': case 'cases': {
        const matrix = `<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="${node.rows[0]!.length}"/><m:mcJc m:val="${node.type === 'cases' ? 'left' : 'center'}"/></m:mcPr></m:mc></m:mcs></m:mPr>${node.rows.map(cells => `<m:mr>${cells.map(cell => wrap('e', cell)).join('')}</m:mr>`).join('')}</m:m>`
        return node.type === 'cases' ? `<m:d><m:dPr><m:begChr m:val="{"/><m:endChr m:val=""/></m:dPr><m:e>${matrix}</m:e></m:d>` : matrix
      }
    }
  }
  const math = `<m:oMath>${render(parseDocumentMath(latex))}</m:oMath>`
  return display ? `<m:oMathPara>${math}</m:oMathPara>` : math
}
