import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import userGuideMarkdown from '../../../../docs/USER_GUIDE.md?raw'
import { plainDocumentText, type DocumentBlock, type FlowInline, type FlowTextContent } from '../../../shared/document/content'
import { parseDocumentMarkdown } from '../../../shared/document/markdown'

export interface NativeAgentHelpProps {
  /** Tests may supply a small fixture; production always uses the raw user guide. */
  source?: string
}

function headingSlug(text: string): string {
  return text.trim().toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s_-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-') || 'section'
}

function headingIds(blocks: readonly DocumentBlock[]): Map<string, string> {
  const ids = new Map<string, string>()
  const occurrences = new Map<string, number>()
  for (const block of blocks) {
    if (block.type !== 'heading') continue
    const base = headingSlug(plainDocumentText(block.content))
    const occurrence = (occurrences.get(base) ?? 0) + 1
    occurrences.set(base, occurrence)
    ids.set(block.id, occurrence === 1 ? base : `${base}-${occurrence}`)
  }
  return ids
}

function internalTarget(href: string): string | null {
  if (!href.startsWith('#') || href.length === 1) return null
  try { return decodeURIComponent(href.slice(1)) } catch { return null }
}

function textStyle(inline: Extract<FlowInline, { type: 'text' }>): CSSProperties | undefined {
  const style = inline.style
  if (!style) return { whiteSpace: 'pre-wrap' }
  return {
    whiteSpace: 'pre-wrap',
    color: style.color,
    backgroundColor: style.highlightColor ?? undefined,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.bold ? 'bold' : undefined,
    fontStyle: style.italic || style.emphasis ? 'italic' : undefined,
    textDecoration: [style.underline && 'underline', style.strike && 'line-through'].filter(Boolean).join(' ') || undefined,
    verticalAlign: style.baseline === undefined ? undefined : `${style.baseline}em`,
  }
}

function HelpLink({ inline, children, sectionIds }: { inline: FlowInline; children: ReactNode; sectionIds: ReadonlySet<string> }) {
  if (!inline.link) return children
  const target = internalTarget(inline.link.href)
  if (target !== null) return sectionIds.has(target)
    ? <a href={`#${target}`} title={inline.link.title} onClick={event => {
      event.preventDefault()
      const root = event.currentTarget.closest('.native-agent-help-content')
      const heading = Array.from(root?.querySelectorAll<HTMLElement>('[id]') ?? []).find(element => element.id === target)
      heading?.scrollIntoView({ block: 'start' })
      if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }) }
    }}>{children}</a>
    : <span aria-disabled="true" title="本指南中没有对应章节">{children}</span>
  if (/^(https?:|mailto:)/i.test(inline.link.href)) return <a href={inline.link.href} title={inline.link.title} target="_blank" rel="noopener noreferrer">{children}</a>
  return <span aria-disabled="true" title="此链接无法在软件内打开">{children}</span>
}

function InlineContent({ content, sectionIds }: { content: FlowTextContent; sectionIds: ReadonlySet<string> }) {
  return <>{content.inlines.map((inline, index) => {
    let value: ReactNode = inline.type === 'math'
      ? <span aria-label={inline.accessibleText}>{inline.accessibleText}</span>
      : <span style={textStyle(inline)}>{inline.text}</span>
    if (inline.type === 'text' && inline.code) value = <code>{value}</code>
    return <HelpLink key={index} inline={inline} sectionIds={sectionIds}>{value}</HelpLink>
  })}</>
}

function HelpBlock({ block, sectionIds, headingId }: { block: DocumentBlock; sectionIds: ReadonlySet<string>; headingId?: string }) {
  const inline = (content: FlowTextContent) => <InlineContent content={content} sectionIds={sectionIds} />
  switch (block.type) {
    case 'heading': {
      const children = inline(block.content)
      if (block.level === 1) return <h2 id={headingId}>{children}</h2>
      if (block.level === 2) return <h3 id={headingId}>{children}</h3>
      if (block.level === 3) return <h4 id={headingId}>{children}</h4>
      if (block.level === 4) return <h5 id={headingId}>{children}</h5>
      return <h6 id={headingId}>{children}</h6>
    }
    case 'paragraph': return <p>{inline(block.content)}</p>
    case 'quote': return <blockquote><p>{inline(block.content)}</p>{block.citation && <cite>{inline(block.citation)}</cite>}</blockquote>
    case 'list': {
      const items = block.items.map(item => <li key={item.id}>{inline(item.content)}</li>)
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>
    }
    case 'divider': return <hr />
    case 'code': return <pre><code>{block.code}</code></pre>
    case 'formula': return <p aria-label={block.accessibleText}>{block.accessibleText}</p>
    case 'table': return <table>{block.caption && <caption>{inline(block.caption)}</caption>}<thead><tr>{block.columns.map(column => <th key={column.id} scope="col">{inline(column.header)}</th>)}</tr></thead><tbody>{block.rows.map(row => <tr key={row.id}>{block.columns.map(column => <td key={column.id}>{inline(row.cells[column.id]!)}</td>)}</tr>)}</tbody></table>
    default: return null
  }
}

export function NativeAgentHelp({ source = userGuideMarkdown }: NativeAgentHelpProps) {
  const [open, setOpen] = useState(false)
  const parsed = useMemo(() => {
    if (!open) return null
    let identity = 0
    return parseDocumentMarkdown(source, { target: 'file', createId: kind => `native-agent-help-${kind}-${++identity}` })
  }, [open, source])
  const ids = useMemo(() => parsed?.status === 'valid' ? headingIds(parsed.document.content.blocks) : new Map<string, string>(), [parsed])
  const sectionIds = useMemo(() => new Set(ids.values()), [ids])

  return <details className="native-agent-help" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary tabIndex={0}>使用指南</summary>
    {open && parsed?.status === 'invalid' && <p role="alert">使用指南暂时无法显示：{parsed.diagnostics[0]?.message ?? '内容格式无效'}</p>}
    {open && parsed?.status === 'valid' && <div className="native-agent-help-content" style={{ overflowWrap: 'anywhere' }}>
      {parsed.document.content.blocks.map(block => <HelpBlock key={block.id} block={block} sectionIds={sectionIds} headingId={ids.get(block.id)} />)}
    </div>}
  </details>
}
