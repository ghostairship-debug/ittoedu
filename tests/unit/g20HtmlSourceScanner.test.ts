// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  decodeHtmlEntities,
  indexHtmlElements,
  parseHtmlStartTag,
  readHtmlRawText,
  scanHtmlSource,
} from '../../src/shared/html/htmlSourceScanner'

const slice = (source: string, span: { start: number; end: number }) => source.slice(span.start, span.end)

describe('scanHtmlSource token stream', () => {
  it('separates text, start tags, end tags and comments', () => {
    const source = 'a<div>b</div><!-- c -->'
    const { tokens } = scanHtmlSource(source)
    expect(tokens.map(token => token.kind)).toEqual([
      'text', 'start-tag', 'text', 'end-tag', 'comment',
    ])
    expect(slice(source, tokens[0]!.span)).toBe('a')
    expect(tokens[1]!.name).toBe('div')
    expect(slice(source, tokens[3]!.span)).toBe('</div>')
    expect(slice(source, tokens[4]!.span)).toBe('<!-- c -->')
  })

  it('reports unclosed comments without dropping the tail', () => {
    const { tokens, diagnostics } = scanHtmlSource('<p>x<!-- open')
    expect(tokens.some(token => token.kind === 'comment')).toBe(true)
    expect(diagnostics.some(item => item.code === 'unclosed-comment')).toBe(true)
  })

  it('keeps script and style bodies as raw-text, not markup', () => {
    const source = '<script>if (a < b) { x("</div>") }</script><style>a{content:"</p>"}</style>'
    const { tokens } = scanHtmlSource(source)
    const raw = tokens.filter(token => token.kind === 'raw-text')
    expect(raw.map(token => token.rawKind)).toEqual(['script', 'style'])
    expect(slice(source, raw[0]!.span)).toContain('</div>')
    expect(slice(source, raw[1]!.span)).toContain('</p>')
    expect(tokens.filter(token => token.kind === 'end-tag').map(token => token.name)).toEqual(['script', 'style'])
  })

  it('treats title/textarea/noscript as raw text too', () => {
    const source = '<title>a<b</title><textarea><div></textarea>'
    const { tokens } = scanHtmlSource(source)
    const raw = tokens.filter(token => token.kind === 'raw-text')
    expect(raw.map(token => token.rawKind)).toEqual(['rcdata', 'rcdata'])
    expect(slice(source, raw[0]!.span)).toBe('a<b')
    expect(slice(source, raw[1]!.span)).toBe('<div>')
  })

  it('reports an unclosed script instead of consuming the rest as markup', () => {
    const source = '<script>var a = 1;'
    const { tokens, diagnostics } = scanHtmlSource(source)
    expect(tokens.filter(token => token.kind === 'start-tag')).toHaveLength(1)
    expect(diagnostics.some(item => item.code === 'unclosed-raw-text')).toBe(true)
  })

  it('emits a lone "<" as text rather than inventing a tag', () => {
    const { tokens } = scanHtmlSource('a < b')
    expect(tokens.map(token => token.kind)).toEqual(['text', 'text', 'text'])
  })

  it('marks doctype separately from comments', () => {
    const { tokens } = scanHtmlSource('<!DOCTYPE html><html></html>')
    expect(tokens[0]!.kind).toBe('doctype')
  })

  it('tracks UTF-16 offsets across CRLF, BOM and astral characters', () => {
    // BOM occupies one code unit, then <p>, then an astral emoji spanning two
    // code units, then </p>, CRLF, and the span start.
    const source = '﻿<p>😀</p>\r\n<span>x</span>'
    const { tokens } = scanHtmlSource(source)
    const starts = tokens.filter(token => token.kind === 'start-tag')
    expect(starts.map(token => token.name)).toEqual(['p', 'span'])
    expect(slice(source, starts[1]!.span)).toBe('<span>')
    expect(starts[0]!.span.start).toBe(1)
    expect(starts[1]!.span.start).toBe(1 + 3 + 2 + 4 + 2)
  })
})

describe('parseHtmlStartTag attribute spans', () => {
  it('records double, single and unquoted values with quote style', () => {
    const source = '<img src="a.png" alt=\'b\' width=10 disabled>'
    const tag = parseHtmlStartTag(source, 0)!
    const byName = (name: string) => tag.attributes.find(attribute => attribute.name === name)!
    expect(byName('src').quote).toBe('"')
    expect(byName('src').decodedValue).toBe('a.png')
    expect(slice(source, byName('src').valueSpan!)).toBe('a.png')
    expect(byName('alt').quote).toBe("'")
    expect(byName('width').quote).toBe('')
    expect(byName('width').decodedValue).toBe('10')
    expect(byName('disabled').valueSpan).toBeUndefined()
  })

  it('stops an unquoted final attribute before the tag close', () => {
    const source = '<img src=old.png>'
    const tag = parseHtmlStartTag(source, 0)!
    expect(slice(source, tag.attributes[0]!.valueSpan!)).toBe('old.png')
    expect(tag.end).toBe(source.length)
  })

  it('keeps attribute name spans pointing at the raw name only', () => {
    const source = '<div DATA-X="1">'
    const tag = parseHtmlStartTag(source, 0)!
    const attribute = tag.attributes[0]!
    expect(attribute.rawName).toBe('DATA-X')
    expect(attribute.name).toBe('data-x')
    expect(slice(source, attribute.span)).toBe('DATA-X')
  })

  it('decodes entities in values while leaving the raw span intact', () => {
    const source = '<a href="a&amp;b">'
    const tag = parseHtmlStartTag(source, 0)!
    expect(slice(source, tag.attributes[0]!.valueSpan!)).toBe('a&amp;b')
    expect(tag.attributes[0]!.decodedValue).toBe('a&b')
  })

  it('handles a ">" inside a quoted value', () => {
    const source = '<a title="a>b">x</a>'
    const tag = parseHtmlStartTag(source, 0)!
    expect(tag.attributes[0]!.decodedValue).toBe('a>b')
    expect(tag.end).toBe(source.indexOf('>x') + 1)
  })

  it('detects self-closing and rejects non start tags', () => {
    expect(parseHtmlStartTag('<br/>', 0)!.selfClosing).toBe(true)
    expect(parseHtmlStartTag('</div>', 0)).toBeNull()
    expect(parseHtmlStartTag('<!doctype>', 0)).toBeNull()
    expect(parseHtmlStartTag('x', 0)).toBeNull()
  })

  it('returns null for a truncated tag instead of throwing', () => {
    expect(parseHtmlStartTag('<div class="x', 0)).not.toBeNull()
    expect(parseHtmlStartTag('<', 0)).toBeNull()
  })
})

describe('readHtmlRawText', () => {
  it('bounds the body and locates the close tag', () => {
    const source = '<style>a{}</style>'
    const raw = readHtmlRawText(source, 7, 'style')
    expect(slice(source, raw.body)).toBe('a{}')
    expect(raw.close).not.toBeNull()
    expect(slice(source, raw.close!)).toBe('</style>')
  })

  it('accepts whitespace inside the close tag and reports a missing close', () => {
    const spaced = '<style>a{}</style >'
    expect(slice(spaced, readHtmlRawText(spaced, 7, 'style').close!)).toBe('</style >')
    const missing = '<style>a{}'
    expect(readHtmlRawText(missing, 7, 'style').close).toBeNull()
  })
})

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeHtmlEntities('a&amp;b&lt;c&gt;d&quot;e&apos;f')).toBe('a&b<c>d"e\'f')
    expect(decodeHtmlEntities('&#65;&#x42;')).toBe('AB')
    expect(decodeHtmlEntities('&nbsp;&mdash;&copy;')).toBe(' —©')
  })

  it('leaves unknown entities and bare ampersands untouched', () => {
    expect(decodeHtmlEntities('a & b &unknown;')).toBe('a & b &unknown;')
  })

  it('handles surrogate pairs without splitting them', () => {
    expect(decodeHtmlEntities('&#x1F600;')).toBe('😀')
  })
})

describe('indexHtmlElements sections', () => {
  it('takes body > section as pages in order', () => {
    const source = '<html><body><section id="a">1</section><section id="b">2</section></body></html>'
    const index = indexHtmlElements(source)
    expect(index.sections.map(section => section.id)).toEqual(['a', 'b'])
    expect(index.sections.map(section => section.order)).toEqual([0, 1])
    expect(slice(source, index.sections[0]!.full)).toBe('<section id="a">1</section>')
    expect(index.sectionsAmbiguous).toBe(false)
  })

  it('takes body > main > section when there is no direct section', () => {
    const source = '<body><main><section id="only">x</section></main></body>'
    const index = indexHtmlElements(source)
    expect(index.sections.map(section => section.id)).toEqual(['only'])
    expect(index.sectionsAmbiguous).toBe(false)
  })

  it('does not treat nested sections as additional pages', () => {
    const source = '<body><section id="outer"><section id="inner">x</section></section></body>'
    const index = indexHtmlElements(source)
    expect(index.sections.map(section => section.id)).toEqual(['outer'])
  })

  it('ignores section markup inside comments, scripts and attribute values', () => {
    const source = '<body><!--<section id="c">--><script>var s="<section id=\'j\'>"</script>' +
      '<div data-x="<section id=\'a\'>"></div><section id="real">x</section></body>'
    const index = indexHtmlElements(source)
    expect(index.sections.map(section => section.id)).toEqual(['real'])
  })

  it('returns no pages and no body when there is no body element', () => {
    const index = indexHtmlElements('<div>x</div>')
    expect(index.body).toBeNull()
    expect(index.sections).toEqual([])
  })

  it('marks ambiguity when two mains compete', () => {
    const index = indexHtmlElements('<body><main><section>a</section></main><main><section>b</section></main></body>')
    expect(index.sectionsAmbiguous).toBe(true)
    expect(index.sections).toEqual([])
  })

  it('marks ambiguity when direct sections coexist with a main', () => {
    const index = indexHtmlElements('<body><main><section id="m">m</section></main><section id="d">d</section></body>')
    expect(index.sections.map(section => section.id)).toEqual(['d'])
    expect(index.sectionsAmbiguous).toBe(true)
  })

  it('records parent, depth and sibling order for nested content', () => {
    const source = '<body><div><p>a</p><p>b</p></div></body>'
    const index = indexHtmlElements(source)
    const names = index.elements.map(element => element.name)
    const divIndex = names.indexOf('div')
    const paragraphs = index.elements.filter(element => element.name === 'p')
    expect(paragraphs.map(paragraph => paragraph.parent)).toEqual([divIndex, divIndex])
    expect(paragraphs.map(paragraph => paragraph.siblingIndex)).toEqual([0, 1])
    expect(paragraphs[0]!.depth).toBe(2)
  })

  it('bounds unclosed elements at end of source without inventing an end tag', () => {
    const source = '<body><div><p>a'
    const index = indexHtmlElements(source)
    const paragraph = index.elements.find(element => element.name === 'p')!
    expect(paragraph.endTag).toBeNull()
    expect(paragraph.full.end).toBe(source.length)
    expect(paragraph.content.end).toBe(source.length)
  })

  it('bounds implicitly closed elements at the closing tag of the outer element', () => {
    const source = '<body><div><p>a</div></body>'
    const index = indexHtmlElements(source)
    const paragraph = index.elements.find(element => element.name === 'p')!
    expect(paragraph.endTag).toBeNull()
    expect(slice(source, paragraph.full)).toBe('<p>a')
    const div = index.elements.find(element => element.name === 'div')!
    expect(slice(source, div.full)).toBe('<div><p>a</div>')
  })

  it('does not let void elements swallow later siblings', () => {
    const source = '<body><img src="a"><section id="s">x</section></body>'
    const index = indexHtmlElements(source)
    expect(index.sections.map(section => section.id)).toEqual(['s'])
    const image = index.elements.find(element => element.name === 'img')!
    expect(image.voidElement).toBe(true)
    expect(image.endTag).toBeNull()
  })

  it('ignores a stray end tag without corrupting the tree', () => {
    const source = '<body></span><section id="s">x</section></body>'
    const index = indexHtmlElements(source)
    expect(index.sections.map(section => section.id)).toEqual(['s'])
  })

  it('accepts a pre-scanned token list', () => {
    const source = '<body><section id="s">x</section></body>'
    expect(indexHtmlElements(source, scanHtmlSource(source).tokens).sections).toHaveLength(1)
  })
})
