import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildFlowDocx } from '../../src/renderer/export/course/flowDocx'
import type { PublishedFlowSurface } from '../../src/shared/publishedCourseTypes'
import { mountPublishedCredits } from '../../src/player/surfaces/publishedCredits'
import { courseCreditLine, withCourseCreditsPage } from '../../src/renderer/export/course/courseCredits'
import type { PublishedCourseCredit } from '../../src/shared/publishedCourseTypes'

const credit: PublishedCourseCredit = {
  assetId: 'photo', kind: 'open-library', title: 'Earth', author: 'NASA', url: 'https://commons.wikimedia.org/wiki/File:Earth.png',
  license: { id: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/' }, attribution: '“Earth” by NASA, CC BY 4.0',
}

describe('course credits', () => {
  it('appends a closing credits page to print documents only when there are credits', () => {
    const html = '<!doctype html><html><body><section class="page">1</section></body></html>'
    expect(withCourseCreditsPage(html, undefined)).toBe(html)
    const printed = withCourseCreditsPage(html, [credit])
    expect(printed.indexOf('素材来源')).toBeGreaterThan(printed.indexOf('<section class="page">1'))
    expect(printed).toContain('CC-BY-4.0')
    expect(printed.endsWith('</body></html>')).toBe(true)
    expect(courseCreditLine(credit)).toContain('出处：https://commons.wikimedia.org/wiki/File:Earth.png')
  })

  it('closes a Flow DOCX with the credits section when there are credits', () => {
    const surface: PublishedFlowSurface = { id: 'flow', title: '讲义', type: 'flow', surfaceLayerItems: [],
      layout: { widthMode: 'fluid', readingWidth: 760, wideContentWidth: 1080 },
      blocks: [{ id: 'p', type: 'paragraph', content: { inlines: [{ type: 'text', text: '正文' }] } }] }
    const text = (bytes: Uint8Array) => strFromU8(unzipSync(bytes)['word/document.xml']!)
    expect(text(buildFlowDocx(surface).bytes)).not.toContain('素材来源')
    const documentXml = text(buildFlowDocx(surface, { credits: [credit] }).bytes)
    expect(documentXml.indexOf('素材来源')).toBeGreaterThan(documentXml.indexOf('正文'))
    expect(documentXml).toContain('<w:pStyle w:val="Heading2"/>')
    expect(documentXml).toContain('“Earth” by NASA, CC BY 4.0（CC-BY-4.0')
  })

  it('shows a faint corner entry that opens and closes the list', () => {
    const root = document.createElement('div')
    document.body.append(root)
    expect(mountPublishedCredits(root, [])).toBeTypeOf('function')
    expect(root.querySelector('[data-course-credits]')).toBeNull()
    const dispose = mountPublishedCredits(root, [credit])
    const button = root.querySelector<HTMLButtonElement>('[data-course-credits="button"]')!
    expect(button.style.opacity).toBe('0.4')
    button.click()
    const panel = root.querySelector('[data-course-credits="panel"]')!
    expect(panel.textContent).toContain('“Earth” by NASA')
    expect(panel.querySelector('a[href="https://creativecommons.org/licenses/by/4.0/"]')?.textContent).toBe('CC-BY-4.0')
    button.click()
    expect(root.querySelector('[data-course-credits="panel"]')).toBeNull()
    dispose()
    expect(root.querySelector('[data-course-credits]')).toBeNull()
    root.remove()
  })
})
