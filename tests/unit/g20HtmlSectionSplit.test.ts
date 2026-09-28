// @vitest-environment node
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { splitHtmlSections } from '../../src/main/workbench/htmlImport/splitHtmlSections'

describe('splitHtmlSections', () => {
  it('splits three-sections.html fixture into three distinct pages with preserved scripts and heads', async () => {
    const fixturePath = path.join(__dirname, '../fixtures/g20-m24/three-sections.html')
    const source = await fs.readFile(fixturePath, 'utf8')
    const result = splitHtmlSections(source, 'auto')

    expect(result.mode).toBe('sections')
    expect(result.sections).toHaveLength(3)

    // Check first section (fixed-page)
    const sec1 = result.sections[0]!
    expect(sec1.id).toBe('fixed-page')
    expect(sec1.title).toBe('第一节：固定画布观察')
    expect(sec1.html).toContain('<title>三页互动课例夹具</title>')
    expect(sec1.html).toContain('.fixed-page')
    expect(sec1.html).toContain('id="fixed-page"')
    expect(sec1.html).toContain('id="nested-detail"') // Nested section remains inside page 1!
    expect(sec1.html).toContain('track.setAttribute("data-camera-frame"') // Shared script included!

    // Check second section (flow-page)
    const sec2 = result.sections[1]!
    expect(sec2.id).toBe('flow-page')
    expect(sec2.title).toBe('第二节：流式观察记录')
    expect(sec2.html).toContain('id="flow-page"')
    expect(sec2.html).not.toContain('id="fixed-page"')

    // Check third section (camera-page)
    const sec3 = result.sections[2]!
    expect(sec3.id).toBe('camera-page')
    expect(sec3.title).toBe('第三节：持续镜头')
    expect(sec3.html).toContain('id="camera-page"')
    expect(sec3.html).not.toContain('id="fixed-page"')
    expect(sec3.html.indexOf('id="camera-page"')).toBeLessThan(sec3.html.indexOf('track.setAttribute("data-camera-frame"'))
  })

  it('splits flow-sections.html into three flow pages with correct titles', async () => {
    const fixturePath = path.join(__dirname, '../fixtures/g20-m24/flow-sections.html')
    const source = await fs.readFile(fixturePath, 'utf8')
    const result = splitHtmlSections(source, 'sections')

    expect(result.mode).toBe('sections')
    expect(result.sections).toHaveLength(3)
    expect(result.sections[0]!.id).toBe('flow-observe')
    expect(result.sections[0]!.title).toBe('观察：先记录现象')
    expect(result.sections[1]!.id).toBe('flow-compare')
    expect(result.sections[1]!.title).toBe('比较：一次只改变一个条件')
    expect(result.sections[2]!.id).toBe('flow-explain')
    expect(result.sections[2]!.title).toBe('解释：用证据支持结论')
  })

  it('falls back to whole mode when auto is requested on an unpaginated document', () => {
    const source = '<!doctype html><html><head><title>Test</title></head><body><p>No sections here</p></body></html>'
    const result = splitHtmlSections(source, 'auto')
    expect(result.mode).toBe('whole')
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]!.html).toBe(source)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('throws an error when sections mode is explicitly requested on an unpaginated document', () => {
    const source = '<!doctype html><html><head><title>Test</title></head><body><p>No sections here</p></body></html>'
    expect(() => splitHtmlSections(source, 'sections')).toThrow(/未找到可分页的 <section>/)
  })

  it('strictly rejects unassignable visual content outside sections in sections mode', () => {
    const source = '<!doctype html><html><body><h1>Header Outside</h1><section id="s1"><p>P1</p></section></body></html>'
    expect(() => splitHtmlSections(source, 'sections')).toThrow(/不可归属于特定 <section>/)

    // In auto mode it falls back to whole
    const autoResult = splitHtmlSections(source, 'auto')
    expect(autoResult.mode).toBe('whole')
  })

  it('supports explicit whole mode unconditionally', () => {
    const source = '<!doctype html><html><body><section id="s1"><p>P1</p></section><section id="s2"><p>P2</p></section></body></html>'
    const result = splitHtmlSections(source, 'whole')
    expect(result.mode).toBe('whole')
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]!.html).toBe(source)
  })
})
