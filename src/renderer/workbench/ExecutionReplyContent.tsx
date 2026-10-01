import { createElement, Fragment, memo, useMemo, useState, type ReactNode } from 'react'
import { marked, type Token, type Tokens } from 'marked'
import { decodeHTMLStrict } from 'entities'

function ReplyLink({ href, children }: { href: string; children: ReactNode }) {
  const [error, setError] = useState('')
  return <><a href={href} title={href} onClick={async event => {
    event.preventDefault(); setError('')
    try {
      const result = await window.desktopAPI?.lesson?.({ operation: 'open-link', url: href })
      if (result?.opened !== true) setError(result?.openError ?? '暂时无法打开，请复制链接后重试。')
    } catch { setError('暂时无法打开，请复制链接后重试。') }
  }}>{children}</a>{error && <small className="execution-reply__link-error" role="alert">{error}</small>}</>
}

function replyTokens(tokens: readonly Token[]): ReactNode {
  return tokens.map((token, key) => {
    const nested = () => replyTokens((token as Tokens.Generic).tokens ?? [])
    switch (token.type) {
      case 'space': case 'def': return null
      case 'heading': return createElement(`h${(token as Tokens.Heading).depth}`, { key }, nested())
      case 'paragraph': return <p key={key}>{nested()}</p>
      case 'blockquote': return <blockquote key={key}>{nested()}</blockquote>
      case 'strong': return <strong key={key}>{nested()}</strong>
      case 'em': return <em key={key}>{nested()}</em>
      case 'del': return <del key={key}>{nested()}</del>
      case 'br': return <br key={key} />
      case 'hr': return <hr key={key} />
      case 'code': return <pre key={key}><code>{(token as Tokens.Code).text}</code></pre>
      case 'codespan': return <code key={key}>{(token as Tokens.Codespan).text}</code>
      case 'text': case 'escape': return <Fragment key={key}>{'tokens' in token && token.tokens ? nested() : decodeHTMLStrict((token as Tokens.Text).text)}</Fragment>
      case 'list': {
        const list = token as Tokens.List
        return createElement(list.ordered ? 'ol' : 'ul', { key, ...(list.ordered && list.start !== '' ? { start: list.start } : {}) },
          list.items.map((item, index) => <li key={index}>{item.task && (item.checked ? '[x] ' : '[ ] ')}{replyTokens(item.tokens)}</li>))
      }
      case 'table': {
        const table = token as Tokens.Table
        return <div className="execution-reply__table" key={key}><table>
          <thead><tr>{table.header.map((cell, index) => <th key={index}>{replyTokens(cell.tokens)}</th>)}</tr></thead>
          <tbody>{table.rows.map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column}>{replyTokens(cell.tokens)}</td>)}</tr>)}</tbody>
        </table></div>
      }
      case 'link': case 'image': {
        const link = token as Tokens.Link | Tokens.Image
        const label = decodeHTMLStrict(link.text), address = decodeHTMLStrict(link.href)
        const content = token.type === 'image' ? label || '图片' : nested()
        return <span key={key}>{token.type === 'link' && /^https?:\/\//i.test(address) ? <ReplyLink href={address}>{content}</ReplyLink> : content}
          {label !== address && <span className="execution-reply__address">（{address}）</span>}</span>
      }
      // HTML and unknown carriers remain literal text, never DOM or executable markup.
      default: return <span className="execution-reply__literal" key={key}>{token.raw}</span>
    }
  })
}

/** Ordinary replies are read-only presentation; they do not enter the document import contract. */
export const ExecutionReplyContent = memo(function ExecutionReplyContent({ text }: { text: string }) {
  const tokens = useMemo(() => marked.lexer(text, { gfm: true }), [text])
  return <div className="execution-timeline__content execution-reply">{replyTokens(tokens)}</div>
})
