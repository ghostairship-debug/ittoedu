// @vitest-environment node
import { chromium } from '@playwright/test'
import { expect, it } from 'vitest'
import { createServer } from 'vite'

it('keeps the authored stroke width for a Flow global shape with an observation transform', async () => {
  const server = await createServer({ configFile: false, root: process.cwd(), appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: ['react', 'react/jsx-runtime'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null }, logLevel: 'error' })
  server.middlewares.use('/shape-test', (_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><script type="module">
      import { shapeRuntimeImplementation } from '/src/components/shape/render.ts';
      import { defaultShapeData } from '/src/components/shape/data.ts';
      window.shapeTest = { shapeRuntimeImplementation, defaultShapeData };
    </script>`)
  })
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
  try {
    await server.listen()
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${(server.httpServer!.address() as { port: number }).port}/shape-test`)
    await page.waitForFunction(() => Reflect.has(window, 'shapeTest'))
    const result = await page.evaluate(() => {
      const api = Reflect.get(window, 'shapeTest')
      const outer = document.createElement('div')
      outer.dataset.componentInstance = 'shape'
      outer.dataset.componentPlacement = 'free'
      outer.style.transform = 'var(--flow-observation-transform, translate(0px, 0px)) matrix(2, 0, 0, 1, 0, 0)'
      const root = document.createElement('div')
      outer.append(root); document.body.append(outer)
      const data = api.defaultShapeData()
      const handle = api.shapeRuntimeImplementation.mount({ instance: { id: 'shape', definitionId: 'shape', data,
        frame: { width: 100, height: 80, transform: [2, 0, 0, 1, 0, 0] } }, root,
        scope: { isActive: () => true, cleanup: () => {} } })
      const canvas = root.querySelector('canvas')!
      const transform = canvas.style.transform
      handle.dispose()
      return transform
    })
    expect(result).toMatch(/^matrix\(0\.5, 0, 0, 1,/)
  } finally {
    await browser?.close()
    await server.close()
  }
}, 30000)
