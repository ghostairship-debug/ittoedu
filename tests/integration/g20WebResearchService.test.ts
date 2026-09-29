import { describe, expect, it, vi } from 'vitest'
import { WebResearchService } from '../../src/main/workbench/network/WebResearchService'
import { fetchPublicResource, isPublicAddress, parsePublicUrl, resolveWithSyntheticFallback } from '../../src/main/workbench/network/publicHttp'

const html = (body: string) => new TextEncoder().encode(body)

describe('M29 public research boundary', () => {
  it('blocks literal, resolved, and special-use private targets before a socket is opened', async () => {
    for (const address of ['127.0.0.1', '10.2.3.4', '169.254.169.254', '192.168.1.2', '::1', '2001:db8::1'])
      expect(isPublicAddress(address)).toBe(false)
    expect(isPublicAddress('1.1.1.1')).toBe(true)
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
    expect(() => parsePublicUrl('http://localhost/private')).toThrow()
    expect(() => parsePublicUrl('https://user:password@example.com')).toThrow()
    await expect(fetchPublicResource('https://example.com', {
      resolve: async () => [{ address: '127.0.0.1', family: 4 }],
    })).rejects.toMatchObject({ code: 'private-target' })
    const publicResolve = vi.fn().mockResolvedValue([{ address: '104.20.23.154', family: 4 }])
    expect(await resolveWithSyntheticFallback('example.com', async () => [{ address: '198.18.0.9', family: 4 }], publicResolve))
      .toEqual([{ address: '104.20.23.154', family: 4 }])
    expect(publicResolve).toHaveBeenCalledOnce()
    expect(await resolveWithSyntheticFallback('private.example', async () => [{ address: '10.0.0.2', family: 4 }], publicResolve))
      .toEqual([{ address: '10.0.0.2', family: 4 }])
    expect(publicResolve).toHaveBeenCalledOnce()
  })

  it('keeps search snippets separate from the opened source body and supports versioned paging', async () => {
    const search = vi.fn().mockResolvedValue({ provider: 'authorized-search', results: [{ title: 'Source', url: 'https://example.com/article', snippet: 'Only a snippet' }] })
    const fetch = vi.fn().mockResolvedValue({ url: 'https://example.com/article', status: 200, contentType: 'text/html', bytes: html(
      '<html><head><title>Real source</title><meta property="article:published_time" content="2026-08-01"></head>'
      + '<body><nav>menu</nav><main><h1>Evidence</h1><p>Actual body text with enough detail.</p><table><tr><td>A</td><td>B</td></tr></table></main></body></html>',
    ) })
    const service = new WebResearchService({ searchProvider: { search }, fetch, now: () => new Date('2026-09-29T00:00:00Z') })
    service.beginRun('run')
    const found = await service.search({ runId: 'run', query: 'evidence', limit: 1 })
    expect(found).toMatchObject({ status: 'results', provider: 'authorized-search', results: [{ snippet: 'Only a snippet' }] })
    const opened = await service.open({ runId: 'run', url: 'https://example.com/article', limit: 200 })
    expect(opened.status).toBe('opened')
    if (opened.status !== 'opened') return
    expect(opened.source).toMatchObject({ title: 'Real source', url: 'https://example.com/article', publishedAt: '2026-08-01', bodyComplete: true })
    expect(opened.text).toContain('Actual body text')
    expect(opened.text).not.toContain('Only a snippet')
    expect(opened.text).not.toContain('menu')
    const reread = await service.open({ runId: 'run', sourceId: opened.source.sourceId, version: opened.source.version, offset: 0, limit: 200 })
    expect(reread).toMatchObject({ status: 'opened', source: { version: opened.source.version } })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reports missing search connection, login pages, and binary files without false full-text results', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ url: 'https://example.com/login', status: 200, contentType: 'text/html', bytes: html('<form><input type="password"></form>') })
      .mockResolvedValueOnce({ url: 'https://example.com/file.pdf', status: 200, contentType: 'application/pdf', bytes: html('%PDF') })
    const service = new WebResearchService({ fetch })
    service.beginRun('run')
    expect(await service.search({ runId: 'run', query: 'evidence' })).toMatchObject({ status: 'not-configured' })
    expect(await service.open({ runId: 'run', url: 'https://example.com/login' })).toMatchObject({ status: 'access-required' })
    expect(await service.open({ runId: 'run', url: 'https://example.com/file.pdf' })).toMatchObject({ status: 'needs-material-reader' })
    await service.stopRun('run')
    expect(await service.open({ runId: 'run', url: 'https://example.com/article' })).toMatchObject({ status: 'rejected' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
