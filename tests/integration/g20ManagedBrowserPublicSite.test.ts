// @vitest-environment node
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'
import { ManagedBrowserMcpService } from '../../src/main/workbench/externalTools/ManagedBrowserMcpService'

it.skipIf(process.env.GUOLING_REAL_BROWSER_WEB !== '1')('uses real public redirects, subresources and screenshot through the run proxy', async () => {
  const base = resolve('output/g20/b23')
  await fs.mkdir(base, { recursive: true })
  const fixture = await fs.mkdtemp(join(base, 'browser-public-site-'))
  const service = new ManagedBrowserMcpService({ scratchRoot: join(fixture, 'runs') })
  const invoke = (operationId: string, name: string, args: Record<string, unknown> = {}) => service.invoke({
    runId: 'public-site', operationId, name: `mcp.browser.${name}`, arguments: args })
  try {
    await service.beginRun('public-site', { permission: 'read-only', allowPublicNavigation: true })
    const redirect = 'https://httpbin.org/redirect-to?url=https%3A%2F%2Fwww.site-example.com%2F'
    const navigation = await invoke('redirect', 'browser_navigate', { url: redirect })
    console.log(JSON.stringify({ navigation: navigation.status,
      reason: navigation.status === 'returned' ? undefined : navigation.reason,
      pageUrl: service.approvalContext('public-site').pageUrl }))
    expect(navigation.status).toBe('returned')
    expect(service.approvalContext('public-site').pageUrl).toBe('https://www.site-example.com/')
    const snapshot = await invoke('snapshot', 'browser_snapshot')
    expect(snapshot.status).toBe('returned')
    if (snapshot.status !== 'returned') throw new Error(snapshot.reason)
    expect(snapshot.content.some(item => item.type === 'text' && item.text.includes('Site Example'))).toBe(true)
    const screenshot = await invoke('screenshot', 'browser_take_screenshot')
    expect(screenshot.status).toBe('returned')
    if (screenshot.status !== 'returned') throw new Error(screenshot.reason)
    const image = screenshot.content.find(item => item.type === 'binary' && item.mimeType === 'image/png')
    expect(image).toBeTruthy()
    if (!image || image.type !== 'binary') throw new Error('真实截图未生成图片资源')
    const bytes = service.readResource('public-site', image.resourceId).bytes
    expect(Buffer.from(bytes).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    const egress = service.egressStats('public-site')
    console.log(JSON.stringify({ screenshotBytes: bytes.byteLength, egress }))
    // Redirect source and final document account for two; the rest are page assets.
    expect(egress.allowedRequests).toBeGreaterThan(2)
    await service.stopRun('public-site')
    expect((await invoke('late', 'browser_snapshot')).status).toBe('rejected')
    expect(await fs.readdir(join(fixture, 'runs'))).toEqual([])
  } finally {
    await service.endRun('public-site')
    await fs.rm(fixture, { recursive: true, force: true })
  }
}, 60_000)
