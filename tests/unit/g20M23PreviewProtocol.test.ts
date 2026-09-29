import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { htmlPreviewFileUrl, htmlPreviewOrigin, parseHtmlPreviewProtocolUrl } from '../../src/main/workbench/htmlPreview/htmlPreviewProtocol'
import { htmlPreviewContentSecurityPolicy, htmlPreviewResponse } from '../../src/main/workbench/htmlPreview/htmlPreviewResponse'
import {
  collectHtmlPreviewMediaUrls, normalizeCssPreviewMediaReferences,
  normalizeHtmlPreviewMediaReferences, resolveHtmlPreviewResource,
} from '../../src/main/workbench/htmlPreview/htmlPreviewResources'

const token = 'a'.repeat(64)
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

describe('M23 preview protocol', () => {
  it('accepts only the leased file shape and one decoded relative path', () => {
    const url = htmlPreviewFileUrl(token, '子目录/我的图.png')
    expect(parseHtmlPreviewProtocolUrl(url)).toEqual({ kind: 'file', token, relativePath: '子目录/我的图.png', hasQuery: false })
    expect(parseHtmlPreviewProtocolUrl(`${url}?v=1`)).toEqual({ kind: 'file', token, relativePath: '子目录/我的图.png', hasQuery: true })
    expect(parseHtmlPreviewProtocolUrl(htmlPreviewFileUrl(token, '完成率%.html'))).toEqual({ kind: 'file', token, relativePath: '完成率%.html', hasQuery: false })
    expect(parseHtmlPreviewProtocolUrl(`${htmlPreviewOrigin(token)}/${token}/_agent/html-preview-agent.iife.js`)).toEqual({ kind: 'agent', token })
    for (const candidate of [
      `${htmlPreviewOrigin(token)}/${token}/file/../secret.txt`,
      `${htmlPreviewOrigin(token)}/${token}/file/%2e%2e/secret.txt`,
      `${htmlPreviewOrigin(token)}/${token}/file/%252e%252e/secret.txt`,
      `${htmlPreviewOrigin(token)}/${token}/file/a%2fb.txt`,
      `${htmlPreviewOrigin(token)}/${token}/file/a%5cb.txt`,
      `${htmlPreviewOrigin(token)}/${token}/file/C%3a/secret.txt`,
      `${htmlPreviewOrigin(token)}/${token}/file/%00secret.txt`,
      `${htmlPreviewOrigin(token)}/${token}/file/ok.txt?path=secret/../outside`,
      `courseware-preview://evil/${token}/file/ok.txt`,
    ]) {
      if (candidate.includes('ok.txt?')) expect(parseHtmlPreviewProtocolUrl(candidate)).toMatchObject({ relativePath: 'ok.txt', hasQuery: true })
      else expect(parseHtmlPreviewProtocolUrl(candidate)).toBeNull()
    }
  })

  it('returns an independent restrictive CSP and no reusable cache', async () => {
    const csp = htmlPreviewContentSecurityPolicy(['https://media.example', 'https://media.example', 'https://bad.example/path'])
    expect(csp).toContain("img-src 'self' data: blob: https://media.example")
    expect(csp).not.toContain('https://bad.example')
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("frame-src 'self' blob:")
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:")
    expect(csp).toContain("sandbox allow-scripts allow-same-origin")
    expect(csp).toContain("worker-src 'none'")
    expect(csp).toContain("form-action 'none'")
    const response = htmlPreviewResponse('<h1>draft</h1>', { method: 'HEAD', contentType: 'text/html; charset=utf-8' })
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(response.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin')
    expect(await response.text()).toBe('')
  })

  it('confines ordinary files and rejects a symlink outside the document folder', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'g20-preview-path-'))
    directories.push(base)
    const root = path.join(base, 'root')
    await mkdir(root)
    await writeFile(path.join(root, 'ok.png'), 'image')
    await writeFile(path.join(base, 'secret.png'), 'secret')
    await symlink(path.join(base, 'secret.png'), path.join(root, 'alias.png'), 'file')
    expect(await resolveHtmlPreviewResource(root, 'ok.png')).toBe(path.join(root, 'ok.png'))
    expect(await resolveHtmlPreviewResource(root, 'alias.png')).toBeNull()
    expect(await resolveHtmlPreviewResource(root, '../secret.png')).toBeNull()
  })

  it('grants only M17-classified HTTPS passive media, including a local CSS background', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'g20-preview-css-'))
    directories.push(root)
    await writeFile(path.join(root, 'style.css'), 'body{background-image:url(https://media.example/back.png)}')
    const source = '<link rel="stylesheet" href="style.css"><script src="https://script.example/a.js"></script><img src="https://images.example/a.png">'
    const urls = await collectHtmlPreviewMediaUrls(source, root)
    expect(urls).toContain('https://media.example/back.png')
    expect(urls).toContain('https://images.example/a.png')
    expect(urls).not.toContain('https://script.example/a.js')
    expect(await readFile(path.join(root, 'style.css'), 'utf8')).toContain('media.example')
  })

  it('normalizes classified protocol-relative media in preview responses only', () => {
    const media = ['https://images.example/a.png', 'https://video.example/a.mp4']
    const source = '<!-- //images.example/a.png --><img src="//images.example/a.png" srcset="//images.example/a.png 1x, //images.example/b.png 2x"><style>.hero{background:url(//images.example/a.png)}</style><video src="//video.example/a.mp4"></video>'
    const normalized = normalizeHtmlPreviewMediaReferences(source, media)
    expect(normalized).toContain('<!-- //images.example/a.png -->')
    expect(normalized).toContain('src="https://images.example/a.png"')
    expect(normalized).toContain('srcset="https://images.example/a.png 1x, https://images.example/b.png 2x"')
    expect(normalized).toContain('background:url(https://images.example/a.png)')
    expect(normalized).toContain('src="https://video.example/a.mp4"')
    expect(source).toContain('src="//images.example/a.png"')
    expect(normalizeCssPreviewMediaReferences('div{background:url(//images.example/a.png)}', media)).toContain('url(https://images.example/a.png)')
  })
})


it('M25 binds a transient origin to its lease token and refuses sibling-token substitution', () => {
  const other = 'b'.repeat(64)
  const a = htmlPreviewFileUrl(token, 'one.html'), b = htmlPreviewFileUrl(other, 'two.html')
  expect(new URL(a).host).not.toBe(new URL(b).host)
  expect(parseHtmlPreviewProtocolUrl(a.replace(`/${token}/`, `/${other}/`))).toBeNull()
  expect(parseHtmlPreviewProtocolUrl(`courseware-preview://app/${token}/file/one.html`)).toBeNull()
  expect(parseHtmlPreviewProtocolUrl(a.replace('.app/', '.app.evil/'))).toBeNull()
})
