// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { resolveBundledFontDescriptors } from '../../src/shared/fonts/bundledFontSources'
import { bundledFontOutputManifest } from '../../src/shared/fonts/bundledFontOutputManifest'
import { BundledFontRealmResources } from '../../src/main/workbench/htmlPreview/bundledFontRealmResources'
import { HtmlPreviewService } from '../../src/main/workbench/htmlPreview/HtmlPreviewService'
import { PreviewNetworkPolicy } from '../../src/main/previewNetworkPolicy'
import { installedBundledFontFaceCss, splitInstalledBundledFontFaceCss } from '../../src/shared/fonts/installedBundledFontFaceCss'
import { authoredDocumentBootstrap } from '../../src/components/web/authoredDocumentBootstrap'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) {
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('auditfonts-')) throw new Error('unexpected font fixture directory')
  rmSync(root, { recursive: true, force: true })
} })
function fontFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'auditfonts-')); roots.push(root); mkdirSync(path.join(root, 'assets'))
  const family = resolveBundledFontDescriptors(path.resolve('node_modules')).find(family => family.family === 'STIX Two Math')!
  const face = family.faces[0]!, finalFile = 'assets/stix-two-math-current.woff2'
  copyFileSync(path.resolve('node_modules', face.specifier), path.join(root, finalFile))
  const manifest = bundledFontOutputManifest([family], [{ fileName: finalFile, names: [face.file], originalFileNames: [face.specifier] }])
  writeFileSync(path.join(root, 'bundled-font-manifest.json'), JSON.stringify(manifest))
  const fonts = new BundledFontRealmResources({ rendererDirectory: root, dependencyDirectory: path.resolve('node_modules') })
  const policy = new PreviewNetworkPolicy(), owner = { processId: 4, frameToken: 'frame', documentToken: 'document' }
  policy.activateDocument(owner)
  const service = new HtmlPreviewService({ async readDocument() { throw new Error('bootstrap uses the existing document owner') },
    networkOwner: () => owner, currentMainFrame: () => ({ webContentsId: 7, processId: 4, frameToken: 'frame' }), networkPolicy: policy,
    registerFrameEntry: () => () => {}, bundledFontResources: fonts })
  return { root, family, face, finalFile, fonts, service, owner }
}

it('CA196: exact production font manifest resources load in real opaque parser realms under the unchanged self-only font CSP', async () => {
  const { family, face, fonts, service, owner } = fontFixture()
  const fontUrl = 'courseware-editor://app/assets/stix-two-math-current.woff2'
  const faces = `/* guoling-bundled-font-faces:start */@font-face{font-family:'STIX Two Math';font-style:normal;font-weight:400;src:url(${fontUrl}) format('woff2')}@font-face{font-family:Unused;src:url(courseware-editor://app/assets/foreign.woff2)}/* guoling-bundled-font-faces:end */`
  const child = '<p style="font-family:STIX Two Math;font-size:24px">∑ ℤ 42</p>'
  const source = authoredDocumentBootstrap({ html: `<html><head></head><body><p style="font-family:STIX Two Math;font-size:24px">∑ ℤ 42</p><iframe sandbox="allow-scripts" srcdoc="${child.replaceAll('"', '&quot;')}"></iframe></body></html>` },
    { nonce: 'loaded-font', instanceId: 'text', resources: {}, themeCss: faces, bridge: () => '' })
  const lease = service.createComponentBootstrap({ leaseId: 'font-lease', html: source }, owner)
  const response = await service.handleProtocolRequest(new Request(lease.url))
  expect(response.headers.get('Content-Security-Policy')).toContain("font-src 'self' data:")
  const body = await response.text()
  expect(body).not.toContain(fontUrl)
  expect(body).toContain(`/bundled-fonts/${face.file}`)
  const browser = await chromium.launch({ headless: true }), requests: string[] = []
  try {
    const context = await browser.newContext()
    await context.route('**/*', async route => {
      requests.push(route.request().url())
      const response = await service.handleProtocolRequest(new Request(route.request().url().replace(/^https:/, 'courseware-preview:')))
      const headers = Object.fromEntries(response.headers), data = Buffer.from(await response.arrayBuffer())
      await route.fulfill({ status: response.status, headers, body: headers['content-type']?.startsWith('text/html')
        ? Buffer.from(data.toString().replaceAll('courseware-preview://', 'https://')) : data })
    })
    const page = await context.newPage()
    await page.goto(lease.url.replace(/^courseware-preview:/, 'https:'))
    await page.evaluate(() => document.fonts.ready)
    const status = await page.evaluate(() => [...document.fonts].filter(face => face.family.includes('STIX')).map(face => face.status))
    expect(status).toEqual(['loaded'])
    const childFrame = page.frames().find(frame => frame !== page.mainFrame())!
    await childFrame.evaluate(() => document.fonts.ready)
    expect(await childFrame.evaluate(() => [...document.fonts].filter(face => face.family.includes('STIX')).map(face => face.status))).toEqual(['loaded'])
    expect(requests.some(url => url.includes('foreign.woff2'))).toBe(false)
    expect(family.family).toBe('STIX Two Math')
  } finally { await browser.close() }
  const invalid = lease.url.replace('component.html', 'bundled-fonts/foreign.woff2')
  expect((await service.handleProtocolRequest(new Request(invalid))).status).toBe(404)
  expect(fonts.project('@font-face{src:url(courseware-editor://app/assets/foreign.woff2)}', path => path).files.size).toBe(0)
  service.releaseComponentBootstrap(lease.leaseId, owner)
  expect((await service.handleProtocolRequest(new Request(lease.url.replace('component.html', `bundled-fonts/${face.file}`)))).status).toBe(404)
  service.dispose()
}, 20_000)

it('CA196: dev fonts match only the current installed descriptor files and preserve byte validation', async () => {
  const { root, face, finalFile, service, owner } = fontFixture(), dependencies = realpathSync(path.resolve('node_modules'))
  const fonts = new BundledFontRealmResources({ rendererDirectory: root, dependencyDirectory: dependencies, developmentOrigin: 'http://127.0.0.1:5173' })
  const actual = realpathSync(path.resolve(dependencies, face.specifier))
  const url = new URL(`/@fs/${actual.replaceAll('\\', '/')}`, 'http://127.0.0.1:5173').href
  expect(fonts.project(`/* guoling-bundled-font-faces:start */@font-face{src:url(${url})}/* guoling-bundled-font-faces:end */`, path => `/lease/${path}`).files.size).toBe(1)
  expect(fonts.project('@font-face{src:url(http://127.0.0.1:5173/@fs/D:/private.woff2)}', path => path).files.size).toBe(0)
  const lease = service.createComponentBootstrap({ leaseId: 'bad-font', html: '/* guoling-bundled-font-faces:start */@font-face{src:url(courseware-editor://app/assets/stix-two-math-current.woff2)}/* guoling-bundled-font-faces:end */' }, owner)
  writeFileSync(path.join(root, finalFile), 'bad font bytes')
  expect((await service.handleProtocolRequest(new Request(lease.url.replace('component.html', `bundled-fonts/${face.file}`)))).status).toBe(404)
  service.dispose()
})

it('CA196: font faces and dynamic theme remain separate projections at every desktop entry', () => {
  const source = readFileSync(path.resolve('src/renderer/components/SandboxComponentImplementation.ts'), 'utf8')
  expect(source).toContain('data-component-bundled-faces')
  // The shared split is the same transport marker consumed by the serialized theme writer.
  const target = { getElementById: () => ({ textContent: '@font-face{font-family:Known;src:url(./font.woff2)}' }), baseURI: 'https://editor.example/' } as unknown as Document
  const faces = installedBundledFontFaceCss(target)
  expect(splitInstalledBundledFontFaceCss(`${faces}p{color:red}`)).toEqual({ faces, theme: 'p{color:red}' })
})
