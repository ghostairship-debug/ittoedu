// @vitest-environment node
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { extractHtmlResources } from '../../src/main/workbench/htmlImport/extractHtmlResources'

// Exact program from the saved rev17 MCP experiment; only its surrounding DOM
// is reduced to the controls and SVG objects used by that program.
const originalProgram = "function setOpen(open){const w=document.getElementById('wire'),s=document.getElementById('switchLine'),a=document.getElementById('lampA'),b=document.getElementById('lampB');w.setAttribute('class','wire '+(open?'open':'closed'));s.setAttribute('stroke',open?'#97a7a3':'#168477');s.setAttribute('d',open?'M300 95 L392 55':'M300 95 L420 95');for(const l of [a,b])l.setAttribute('class',open?'dark':'bulb');document.getElementById('state').textContent=open?'开关断开 · 两灯都灭':'回路闭合 · 两灯都亮';document.getElementById('explain').textContent=open?'断开处让唯一通路中断，电流无法走完一圈，所以两只灯都灭。':'电路重新连成一圈，唯一通路完整，两只灯同时亮起。';document.getElementById('on').setAttribute('aria-pressed',String(!open));document.getElementById('off').setAttribute('aria-pressed',String(open))}"

it('retains the actual SVG color state program without resource warnings and runs open/reset repeatedly', async () => {
  const html = `<html><body><svg><path id="wire" class="wire closed"/><path id="switchLine" stroke="#168477"/><circle id="lampA" class="bulb"/><circle id="lampB" class="bulb"/></svg><button id="on" onclick="setOpen(false)">闭合</button><button id="off" onclick="setOpen(true)">断开</button><button id="reset" onclick="setOpen(false)">复位</button><p id="state"></p><p id="explain"></p><script>${originalProgram}</script></body></html>`
  const prepared = extractHtmlResources({ html })
  expect(prepared.diagnostics).toEqual([])
  expect(prepared.html).toContain(originalProgram)
  expect(prepared.resources).toEqual([])
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage(); await page.setContent(prepared.html)
    for (const action of ['off', 'reset', 'off', 'on']) {
      await page.locator(`#${action}`).click()
      const open = action === 'off'
      expect(await page.locator('#switchLine').getAttribute('stroke')).toBe(open ? '#97a7a3' : '#168477')
      expect(await page.locator('#lampA').getAttribute('class')).toBe(open ? 'dark' : 'bulb')
      expect(await page.locator('#lampB').getAttribute('class')).toBe(open ? 'dark' : 'bulb')
      expect(await page.locator('#state').textContent()).toBe(open ? '开关断开 · 两灯都灭' : '回路闭合 · 两灯都亮')
    }
  } finally { await browser.close() }
})

it('localizes a real conditional paint URL at its CSS consumer while retaining shared text and unknown inputs', () => {
  const source = 'const paint="url(picture.svg)";label.textContent=paint;function update(active){shape.setAttribute("fill",active?paint:"#168477");shape.setAttribute("stroke",unknownPaint)}'
  const prepared = extractHtmlResources({ html: `<script>${source}</script>`, siblingFiles: new Map([
    ['picture.svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')],
  ]) })
  expect(prepared.html).toContain('const paint="url(picture.svg)";label.textContent=paint')
  expect(prepared.html).toContain('cw-resource:')
  expect(prepared.resources).toHaveLength(1)
  expect(prepared.html).toContain('shape.setAttribute("stroke",unknownPaint)')
  expect(prepared.diagnostics).toEqual([expect.objectContaining({ code: 'unsupported-dynamic-url-sink', message: '无法静态解析 stroke 的资源内容' })])
})
