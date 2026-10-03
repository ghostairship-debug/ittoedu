// @vitest-environment node
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'

it('F05 prevents ancestor rotation from writing gesture coordinates while positive scale and zoom remain editable', async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    const bundle = (await build({ stdin: { contents: `
      export {createElement} from 'react';export {createRoot} from 'react-dom/client';export {flushSync} from 'react-dom';
      export {WebCompositionAuthoringContent} from './src/renderer/composition/WebCompositionAuthoringContent';
      export {compositionViewportGestureIssue} from './src/renderer/composition/compositionLayout';
      export {applyCompositionContentEdit} from './src/core/tools/compositionContent';
      export {waitForPublishedObservationReady} from './src/player/surfaces/publishedCapture';
    `, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'ViewportGestures',
      loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl', '.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl' }, define: { 'process.env.NODE_ENV': '"test"' } })).outputFiles[0]!.text
    await page.setContent('<style>body{margin:0}#outer{margin:80px;transform:rotate(12deg);transform-origin:0 0;width:400px;height:260px}</style><div id="outer"><div id="host"></div></div>')
    await page.addScriptTag({ content: bundle })
    await page.evaluate(async () => {
      const w = window as any, api = w.ViewportGestures, root = api.createRoot(document.getElementById('host'))
      const h: any = { root, edits: [], selections: 0, props: { layerItemId: 'viewport', width: 400, height: 260, assetUrls: {}, selectedNodeId: 'free', content: {
        assets: {}, root: { kind: 'element', id: 'html', tagName: 'html', attributes: {}, children: [
          { kind: 'element', id: 'body', tagName: 'body', attributes: { style: 'margin:0;position:relative;height:260px' }, children: [
            { kind: 'element', id: 'free', tagName: 'div', attributes: { style: 'position:absolute;left:40px;top:40px;width:100px;height:80px;background:#def' }, children: [{ kind: 'text', id: 'label', text: 'Editable' }] },
          ] },
        ] },
      } } }
      h.render = () => api.flushSync(() => root.render(api.createElement(api.WebCompositionAuthoringContent, h.props)))
      h.props.onSelection = () => { h.selections++ }
      h.props.onEdit = async (edit: any) => { const result = api.applyCompositionContentEdit(h.props.content, edit); if (!result.ok) throw new Error(result.diagnostic.message); h.edits.push(edit); h.props.content = result.content; h.render() }
      w.__viewportHarness = h; h.render(); await api.waitForPublishedObservationReady(document.getElementById('host'))
    })
    const drag = page.getByRole('button', { name: '拖动内容', exact: true })
    await expect.poll(() => drag.isDisabled()).toBe(true)
    expect(await page.getByRole('status').filter({ hasText: '旋转' }).count()).toBe(1)
    const node = page.frameLocator('iframe[data-web-composition]').locator('[data-composition-node="free"]'), rotated = await node.boundingBox()
    if (!rotated) throw new Error('Missing actual rotated node')
    await page.mouse.move(rotated.x + rotated.width / 2, rotated.y + rotated.height / 2); await page.mouse.down()
    await page.mouse.move(rotated.x + rotated.width / 2 + 20, rotated.y + rotated.height / 2 + 10); await page.mouse.up()
    await node.click()
    expect(await page.evaluate(() => (window as any).__viewportHarness.edits.length)).toBe(0)
    expect(await page.evaluate(() => (window as any).__viewportHarness.selections)).toBeGreaterThan(0)

    await page.evaluate(() => {
      const outer = document.getElementById('outer')!; outer.style.transform = 'translate(20px,10px) scale(.75)'; outer.style.zoom = '1.25'
      const h = (window as any).__viewportHarness; h.props.content = { ...h.props.content }; h.render()
    })
    await expect.poll(() => drag.isDisabled()).toBe(false)
    const handle = await drag.boundingBox(), iframe = page.locator('iframe[data-web-composition]'), frameBox = await iframe.boundingBox()
    if (!handle || !frameBox) throw new Error('Missing scaled gesture geometry')
    const scale = frameBox.width / 400, start = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
    await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x + 50 * scale, start.y + 25 * scale, { steps: 4 }); await page.mouse.up()
    await expect.poll(() => page.evaluate(() => (window as any).__viewportHarness.edits.length)).toBe(1)
    expect(await page.evaluate(() => (window as any).__viewportHarness.edits[0])).toMatchObject({ type: 'style', nodeId: 'free', patch: { left: '90px', top: '65px' } })
    expect(await node.evaluate(element => ({ x: element.getBoundingClientRect().x, y: element.getBoundingClientRect().y }))).toEqual({ x: 90, y: 65 })

    // A rotation appearing after preview must also prevent the release from committing.
    await page.evaluate(async () => {
      await (window as any).ViewportGestures.waitForPublishedObservationReady(document.getElementById('host'))
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    })
    const handleAfter = await drag.boundingBox(); if (!handleAfter) throw new Error('Missing live handle')
    await page.mouse.move(handleAfter.x + handleAfter.width / 2, handleAfter.y + handleAfter.height / 2); await page.mouse.down()
    await page.mouse.move(handleAfter.x + handleAfter.width / 2 + 20 * scale, handleAfter.y + handleAfter.height / 2 + 10 * scale)
    await page.evaluate(() => { document.getElementById('outer')!.style.transform = 'rotate(18deg)' })
    await page.mouse.up()
    expect(await page.evaluate(() => (window as any).__viewportHarness.edits.length)).toBe(1)
    expect(await page.getByRole('status').filter({ hasText: '旋转' }).count()).toBe(1)
    await page.close()
  } finally { await browser.close() }
}, 20_000)
