import { describe, expect, it } from 'vitest'
import { isDisplayText, scanPageText } from '../../src/shared/runtimeText/scanPageText'

const html = (text: string) => [{ path: 'page.html', kind: 'html' as const, text }]
const js = (text: string, path = 'app.js') => [{ path, kind: 'js' as const, text }]

describe('isDisplayText', () => {
  it('keeps CJK text even single words', () => {
    expect(isDisplayText('标题')).toBe(true)
    expect(isDisplayText('こんにちは')).toBe(true)
  })
  it('keeps natural-language English', () => {
    expect(isDisplayText('Good morning.')).toBe(true)
    expect(isDisplayText('Enter your name')).toBe(true)
    expect(isDisplayText('OK!')).toBe(true)
  })
  it('drops identifiers, urls, class lists, format strings and punctuation-only text', () => {
    expect(isDisplayText('userName')).toBe(false)
    expect(isDisplayText('https://example.com/x')).toBe(false)
    expect(isDisplayText('data:image/png;base64,AAAA')).toBe(false)
    expect(isDisplayText('/static/app.js')).toBe(false)
    expect(isDisplayText('btn btn-primary active')).toBe(false)
    expect(isDisplayText('.card .title')).toBe(false)
    expect(isDisplayText('Hello %s')).toBe(false)
    expect(isDisplayText('value {0} of {1}')).toBe(false)
    expect(isDisplayText('2024-09-25 10:30')).toBe(false)
    expect(isDisplayText('use strict')).toBe(false)
    expect(isDisplayText('x'.repeat(501))).toBe(false)
    expect(isDisplayText('')).toBe(false)
  })
})

describe('scanPageText html', () => {
  it('collects static text and alt/title/placeholder attributes', () => {
    const src = '<div class="wrap"><p>你好，世界</p><img alt="封面图片" src="x.png"><input placeholder="Enter your name" title="Click to edit"></div>'
    const result = scanPageText(html(src))
    const texts = result.entries.map((e) => e.text)
    expect(texts).toContain('你好，世界')
    expect(texts).toContain('封面图片')
    expect(texts).toContain('Enter your name')
    expect(texts).toContain('Click to edit')
    expect(texts).not.toContain('x.png')
    const byText = new Map(result.entries.map((e) => [e.text, e]))
    expect(byText.get('封面图片')?.occurrences[0]).toMatchObject({ context: 'html-attr', attribute: 'alt', path: 'page.html' })
    expect(byText.get('你好，世界')?.occurrences[0]?.context).toBe('html-text')
    expect(result.diagnostics).toEqual([])
  })
  it('records offsets pointing into the original file', () => {
    const src = '<p>你好</p>'
    const result = scanPageText(html(src))
    const occ = result.entries[0].occurrences[0]
    expect(src.slice(occ.start, occ.end)).toBe('你好')
  })
  it('skips comments, style, template and keeps only meaningful text', () => {
    const src = '<!-- 注释里的文字 --><style>.a{content:"样式中的文字"}</style><template><p>模板里的文字</p></template><p>  真实文字  </p>'
    const result = scanPageText(html(src))
    expect(result.entries.map((e) => e.text)).toEqual(['真实文字'])
  })
  it('decodes entities and collapses whitespace', () => {
    const src = '<p>Tom &amp; Jerry&nbsp;&nbsp;  回来了</p>'
    const result = scanPageText(html(src))
    expect(result.entries.map((e) => e.text)).toContain('Tom & Jerry 回来了')
  })
  it('scans inline scripts, skips external and non-js scripts', () => {
    const src = '<script src="app.js">"外链脚本里的文字"</script><script type="application/json">{"k":"数据里的文字内容"}</script><script type="module">var a="内联脚本文字内容";</script>'
    const result = scanPageText(html(src))
    const texts = result.entries.map((e) => e.text)
    expect(texts).toContain('内联脚本文字内容')
    expect(texts).not.toContain('外链脚本里的文字')
    expect(texts).not.toContain('数据里的文字内容')
  })
  it('deduplicates text and records multiple occurrences with positions', () => {
    const files = [
      { path: 'a.html', kind: 'html' as const, text: '<p>早上好</p>' },
      { path: 'b.html', kind: 'html' as const, text: '<span>早上好</span><i>早上好</i>' },
    ]
    const result = scanPageText(files)
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].text).toBe('早上好')
    expect(result.entries[0].occurrences.map((o) => o.path)).toEqual(['a.html', 'b.html', 'b.html'])
    expect(files[1].text.slice(result.entries[0].occurrences[2].start, result.entries[0].occurrences[2].end)).toBe('早上好')
  })
  it('sorts entries by first occurrence', () => {
    const result = scanPageText(html('<p>第一段文字</p><p>第二段文字</p>'))
    expect(result.entries.map((e) => e.text)).toEqual(['第一段文字', '第二段文字'])
  })
})

describe('scanPageText js', () => {
  it('collects strings from jsx/createElement call shapes', () => {
    const result = scanPageText(js('jsx("p",{children:"Good morning."});createElement("h1",null,"标题");'))
    expect(result.entries.map((e) => e.text)).toEqual(['Good morning.', '标题'])
    expect(result.diagnostics).toEqual([])
  })
  it('handles regex literals containing quotes without false fragments', () => {
    const result = scanPageText(js('var re=/"[^"]*"/g;var ok="正则之后的文字";re.test(ok);'))
    const texts = result.entries.map((e) => e.text)
    expect(texts).toContain('正则之后的文字')
    expect(texts.some((t) => t.includes('[^'))).toBe(false)
    expect(result.diagnostics).toEqual([])
  })
  it('ignores quotes inside comments', () => {
    const src = '// "注释里的假字符串内容"\n/* \'另一段注释内容\' */\nvar t="真实内容文字";'
    const result = scanPageText(js(src))
    expect(result.entries.map((e) => e.text)).toEqual(['真实内容文字'])
    expect(result.diagnostics).toEqual([])
  })
  it('collects static template literal chunks', () => {
    const result = scanPageText(js('const s=`你好，${name}欢迎回来`;const t=`完整模板文字`;'))
    const texts = result.entries.map((e) => e.text)
    expect(texts).toContain('你好，')
    expect(texts).toContain('欢迎回来')
    expect(texts).toContain('完整模板文字')
    const tpl = result.entries.find((e) => e.text === '完整模板文字')
    expect(tpl?.occurrences[0]?.context).toBe('js-template')
  })
  it('decodes escape sequences in string values', () => {
    const result = scanPageText(js('var s="\\u4f60\\u597d\\uff0c\\u4e16\\u754c";'))
    expect(result.entries.map((e) => e.text)).toEqual(['你好，世界'])
  })
  it('drops identifiers, urls and class lists from strings', () => {
    const src = 'var a="userName";var b="https://example.com/x";var c="btn btn-primary";var d="%s 个结果";var e="use strict";var f="标题";'
    const result = scanPageText(js(src))
    expect(result.entries.map((e) => e.text)).toEqual(['标题'])
  })
  it('records js-string offsets excluding the quotes', () => {
    const src = 'var a="早上好";'
    const result = scanPageText(js(src))
    const occ = result.entries[0].occurrences[0]
    expect(src.slice(occ.start, occ.end)).toBe('早上好')
  })
  it('keeps partial results and reports diagnostics on syntax errors', () => {
    const result = scanPageText(js('var a="前面的文字";var b="未终止的字符串'))
    const texts = result.entries.map((e) => e.text)
    expect(texts).toContain('前面的文字')
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics[0].path).toBe('app.js')
  })
  it('falls back to script mode for non-module code', () => {
    const result = scanPageText(js('with(obj){x="严格模式不允许的文字";}'))
    expect(result.entries.map((e) => e.text)).toContain('严格模式不允许的文字')
  })
  it('ignores css files without errors', () => {
    const result = scanPageText([{ path: 'a.css', kind: 'css', text: '.a{content:"样式文字";color:red}' }])
    expect(result.entries).toEqual([])
    expect(result.diagnostics).toEqual([])
  })
  it('respects maxEntries', () => {
    const result = scanPageText(html('<p>第一段文字</p><p>第二段文字</p><p>第三段文字</p>'), { maxEntries: 2 })
    expect(result.entries.map((e) => e.text)).toEqual(['第一段文字', '第二段文字'])
  })
})

describe('scanPageText performance', () => {
  it('scans a 250KB minified single-line script within 300ms', () => {
    const chunk = 'var a="这是一段用于性能测试的中文显示文字",re=/"[^"]*"/g,t=`模板片段${x}尾部`,b="Another sample sentence for scanning.";'
    const code = chunk.repeat(Math.ceil((250 * 1024) / chunk.length))
    expect(code.length).toBeGreaterThanOrEqual(250 * 1024)
    expect(code.includes('\n')).toBe(false)
    const start = performance.now()
    const result = scanPageText(js(code, 'big.js'))
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(300)
    expect(result.entries.map((e) => e.text)).toContain('这是一段用于性能测试的中文显示文字')
  })
})
