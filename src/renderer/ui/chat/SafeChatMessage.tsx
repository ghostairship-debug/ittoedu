import { Component, useState, type ReactNode } from 'react'
import { parseFormulaLinear, formulaAstToAccessibleText } from '../../../shared/formulaLinear'
import { PublishedFormulaPaint } from '../PublishedFormulaPaint'

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code>
    : part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part)
}
class FormulaBoundary extends Component<{ text: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <pre aria-label="公式原文">{this.props.text}</pre> : this.props.children }
}
function Formula({ text, id }: { text: string; id: string }) {
  try {
    if (text.length > 4000) throw new Error('公式超出显示预算')
    const ast = parseFormulaLinear(text)
    return <FormulaBoundary key={text} text={text}><PublishedFormulaPaint ast={ast} formulaId={id} accessibleText={formulaAstToAccessibleText(ast)} width={320} height={64} style={{ fontSize: 22, color: '#172033', align: 'left' }} /></FormulaBoundary>
  } catch { return <pre aria-label="公式原文">{text}</pre> }
}

/** Deliberately renders text nodes only: no raw HTML, remote images, or URL execution. */
export function SafeChatMessage({ text }: { text: string }) {
  const [copyStatus, setCopyStatus] = useState('')
  const lines = text.split('\n'); const nodes: ReactNode[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const code: string[] = []; const start = i
      while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i])
      nodes.push(<pre key={start}><code>{code.join('\n')}</code></pre>)
    } else if (line.startsWith('$$')) {
      const start = i; let formula = line.slice(2)
      while (!formula.endsWith('$$') && ++i < lines.length) formula += `\n${lines[i]}`
      nodes.push(<Formula key={start} id={`chat-formula-${start}`} text={formula.endsWith('$$') ? formula.slice(0, -2) : formula} />)
    } else if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? '')) {
      const start = i
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, '').split('|').map(value => value.trim())
      const headings = cells(line), rows: string[][] = []
      i += 2
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]))
      i--
      nodes.push(<table key={start}><thead><tr>{headings.map((cell, index) => <th key={index}>{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{inline(cell)}</td>)}</tr>)}</tbody></table>)
    } else if (/^#{1,6} /.test(line)) nodes.push(<h4 key={i}>{inline(line.replace(/^#+ /, ''))}</h4>)
    else if (/^([-*]|\d+\.) /.test(line)) {
      const start = i; const items: ReactNode[] = []; const ordered = /^\d/.test(line)
      do { items.push(<li key={i}>{inline(lines[i].replace(/^([-*]|\d+\.) /, ''))}</li>); i++ } while (i < lines.length && (ordered ? /^\d+\. / : /^[-*] /).test(lines[i]))
      i--; nodes.push(ordered ? <ol key={start}>{items}</ol> : <ul key={start}>{items}</ul>)
    } else if (line) nodes.push(<p key={i}>{inline(line)}</p>)
  }
  return <div className="chat-message" tabIndex={0}>{nodes}<button type="button" onClick={() => {
    void Promise.resolve().then(() => navigator.clipboard.writeText(text)).then(() => setCopyStatus('已复制')).catch(() => setCopyStatus('复制失败，请选择原文复制'))
  }}>复制原文</button><span role="status">{copyStatus}</span></div>
}
