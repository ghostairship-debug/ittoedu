// @vitest-environment node
import { expect, it } from 'vitest'
import { prepareContentResources } from '../../../../src/main/workbench/contentApply/resources/contentResources'
import { htmlPreviewResponse } from '../../../../src/main/workbench/htmlPreview/htmlPreviewResponse'

it('actual HTML CSS resource declarations reach the preview response in their image media style and font purposes', async () => {
  const html = '<link rel="stylesheet" href="https://styles.example/lesson.css"><link rel="stylesheet" href="./local.css">'
    + '<img src="https://images.example/a.png"><video src="https://media.example/a.mp4"></video>'
    + '<script src="https://scripts.example/a.js"></script><img src="https://styles.example/shared">'
    + '<link rel="stylesheet" href="https://styles.example/shared">'
  const prepared = await prepareContentResources({ html, siblingFiles: new Map([['local.css', new TextEncoder().encode('@font-face{font-family:lesson;src:url(https://fonts.example/lesson.woff2)}')]]) }, () => 'resource')
  expect(prepared.resourceSources).toEqual(expect.arrayContaining([
    { url: 'https://styles.example/lesson.css', usage: 'stylesheet' },
    { url: 'https://images.example/a.png', usage: 'image' },
    { url: 'https://media.example/a.mp4', usage: 'media' },
    { url: 'https://fonts.example/lesson.woff2', usage: 'font' },
    { url: 'https://styles.example/shared', usage: 'image' },
    { url: 'https://styles.example/shared', usage: 'stylesheet' },
  ]))
  const response = htmlPreviewResponse(prepared.html, { contentType: 'text/html', resourceSources: prepared.resourceSources })
  const directives = new Map(response.headers.get('Content-Security-Policy')!.split(';').map(value => {
    const [name, ...tokens] = value.trim().split(/\s+/); return [name, tokens]
  }))
  expect(directives.get('img-src')).toContain('https://images.example')
  expect(directives.get('media-src')).toContain('https://media.example')
  expect(directives.get('style-src')).toContain('https://styles.example')
  expect(directives.get('font-src')).toContain('https://fonts.example')
  for (const family of ['script-src', 'connect-src', 'worker-src']) {
    expect(directives.get(family)?.some(value => /^https?:/.test(value))).toBe(false)
  }
  expect(directives.get('style-src')).not.toContain('https://fonts.example')
  expect(directives.get('font-src')).not.toContain('https://styles.example')
  // This proves declaration/response policy, not network availability or a rendered font/image.
})
