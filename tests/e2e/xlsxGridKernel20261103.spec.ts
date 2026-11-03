import { test, expect } from '@playwright/test'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { build } from 'esbuild'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import type { OfficeEditContent } from '../../src/shared/workbench/officeFiles'

test('Excel grid replaces formulas, copies ranges and retains OOXML through offline UI edits', async ({ page }, info) => {
  test.setTimeout(120000)
  const base = resolve('output/office-coedit-20261103/excel-grid-kernel'); mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-')), workbook = join(directory, 'grid-fixture.xlsx')
  const initial = await applyOfficeContent(undefined, { format: 'xlsx', operation: 'create', sheets: [
    { name: '预算', rows: [['项目', '数值'], ['材料', 10], ['合计', { formula: 'SUM(B2:B2)' }]] },
    { name: '保留', rows: [['untouched']] },
  ] })
  const originalParts = unzipSync(initial.bytes)
  originalParts['customXml/opaque.bin'] = Uint8Array.of(0, 255, 47, 13)
  originalParts['xl/worksheets/sheet1.xml'] = strToU8(strFromU8(originalParts['xl/worksheets/sheet1.xml']).replace('</sheetData>', '</sheetData><mergeCells count="1"><mergeCell ref="D8:F9"/></mergeCells>'))
  let bytes: Uint8Array = zipSync(originalParts), past: Uint8Array[] = [], future: Uint8Array[] = []
  const edits: OfficeEditContent[] = [], errors: string[] = [], externalRequests: string[] = []
  writeFileSync(workbook, bytes)
  const version = () => createHash('sha256').update(bytes).digest('hex')
  const snapshot = () => ({ binding: { path: workbook, bindingVersion: 1, fileVersion: version() }, bytes: [], inspection: inspectOfficeContent(bytes, 'xlsx'), history: { undoDepth: past.length, redoDepth: future.length, entries: [] } })
  const appSource = `import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';import{XlsxFileEditor}from'./src/renderer/documentFiles/office/XlsxFileEditor';
    const request=async(path,data)=>{const r=await fetch(path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json'},body:data?JSON.stringify(data):undefined});const value=await r.json();if(!r.ok)throw Error(value.error);return value};
    function App(){const[snapshot,setSnapshot]=useState(null);useEffect(()=>{request('/snapshot').then(setSnapshot)},[]);if(!snapshot)return null;return <XlsxFileEditor snapshot={snapshot} name="grid-fixture.xlsx" onEdit={async(binding,content)=>{const next=await request('/edit',{binding,content});setSnapshot(next);return next}} onUndo={async()=>setSnapshot(await request('/undo',{}))} onRedo={async()=>setSnapshot(await request('/redo',{}))}/>};createRoot(document.getElementById('root')).render(<App/>);`
  await build({ stdin: { contents: appSource, resolveDir: resolve('.'), loader: 'tsx' }, outfile: join(directory, 'app.js'), bundle: true, minify: true, format: 'esm', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } })
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/snapshot') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(snapshot())); return }
      if (req.method === 'POST') {
        const chunks: Uint8Array[] = []; for await (const chunk of req) chunks.push(chunk)
        const input = JSON.parse(Buffer.concat(chunks).toString())
        if (req.url === '/edit') {
          if (input.binding.fileVersion !== version()) throw new Error('version conflict')
          const result = await applyOfficeContent(bytes, { ...input.content, operation: 'edit' })
          past.push(bytes); future = []; bytes = result.bytes; edits.push(input.content)
        } else if (req.url === '/undo' && past.length) { future.push(bytes); bytes = past.pop()! }
        else if (req.url === '/redo' && future.length) { past.push(bytes); bytes = future.pop()! }
        writeFileSync(workbook, bytes); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(snapshot())); return
      }
      if (req.url === '/app.js' || req.url === '/app.css') { res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(readFileSync(join(directory, req.url.slice(1)))); return }
      res.setHeader('Content-Type', 'text/html'); res.end('<html><head><link rel="stylesheet" href="/app.css"><style>html,body,#root{height:100%;margin:0}*{box-sizing:border-box}</style></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>')
    } catch (error) { res.writeHead(409, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: String(error) })) }
  })
  await new Promise<void>(ready => server.listen(0, '127.0.0.1', ready))
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No test server address')
  const origin = `http://127.0.0.1:${address.port}`
  const inspection = () => { const value = inspectOfficeContent(readFileSync(workbook), 'xlsx'); if (value.format !== 'xlsx') throw new Error('Expected XLSX'); return value }
  const cell = (address: string) => page.getByRole('textbox', { name: `预算!${address}`, exact: true })
  const save = async () => { await page.getByRole('button', { name: '保存', exact: true }).click(); await expect(page.locator('.office-leaf-status')).toHaveText('已保存'); await expect(page.locator('.office-sheet-editor')).toHaveAttribute('aria-busy', 'false') }
  try {
    await page.setViewportSize({ width: 1280, height: 850 })
    await page.route('**/*', route => { if (route.request().url().startsWith(origin)) return route.continue(); externalRequests.push(route.request().url()); return route.abort() })
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(origin)
    await expect(cell('B3')).toHaveValue('10')
    await cell('B3').focus()
    await expect(cell('B3')).toHaveValue('10')
    await expect(page.getByRole('textbox', { name: '单元格内容或公式', exact: true })).toHaveValue('=SUM(B2:B2)')
    await cell('B2').fill('21'); await cell('B3').fill('=B2*2')
    await expect(cell('B3')).toHaveValue('=B2*2'); await save()
    expect(edits).toHaveLength(1)
    expect(edits[0]).toEqual({ format: 'xlsx', edits: [{ sheet: '预算', cell: 'B2', value: 21 }, { sheet: '预算', cell: 'B3', value: { formula: 'B2*2' } }] })
    expect(inspection().sheets[0].cells.find(value => value.cell === 'B3')).toMatchObject({ formula: 'B2*2', value: 42 })
    await cell('B3').dblclick(); await expect(cell('B3')).toHaveValue('=B2*2')
    await cell('A4').click()
    await cell('A4').evaluate(node => { const data = new DataTransfer(); data.setData('text/plain', '00123\t=B2+1\r\n"two\nlines"\tFALSE'); node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })) })
    await cell('C4').fill('old')
    await cell('C4').evaluate(node => { const data = new DataTransfer(); data.setData('text/plain', '00100'); node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })) })
    await save()
    expect(inspection().sheets[0].cells.find(value => value.cell === 'A4')?.value).toBe('00123')
    expect(inspection().sheets[0].cells.find(value => value.cell === 'A5')?.value).toBe('two\nlines')
    expect(inspection().sheets[0].cells.find(value => value.cell === 'C4')?.value).toBe('00100')
    expect(inspection().sheets[0].cells.find(value => value.cell === 'B4')).toMatchObject({ formula: 'B2+1', value: 22 })
    await cell('A4').click(); await cell('B5').click({ modifiers: ['Shift'] })
    await expect(page.locator('.office-xlsx-selection-status')).toContainText('A4:B5')
    const copied = await page.locator('.office-xlsx-grid-shell').evaluate(node => { const data = new DataTransfer(); node.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data })); return data.getData('text/plain') })
    expect(copied).toBe('00123\t22\r\n"two\nlines"\tfalse')
    await cell('B2').click(); await page.keyboard.press('Tab')
    await expect(page.locator('.office-xlsx-selection-status')).toContainText('C2')
    await page.keyboard.press('Shift+ArrowDown')
    await expect(page.locator('.office-xlsx-selection-status')).toContainText('C2:C3')
    await page.keyboard.press('PageDown')
    await expect(page.locator('.office-xlsx-selection-status')).toContainText('C')
    const box = await page.getByRole('columnheader', { name: 'B', exact: true }).boundingBox(); if (!box) throw new Error('Missing B header')
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width + 45, box.y + box.height / 2); await page.mouse.up()
    await save()
    const width = inspection().sheets[0].columnWidths?.find(value => value.min === 2)?.width
    expect(width).toBeGreaterThan(20)
    await page.getByRole('button', { name: '撤销', exact: true }).click(); await expect(page.locator('.office-leaf-status')).toHaveText('已保存')
    await expect.poll(() => inspection().sheets[0].columnWidths?.find(value => value.min === 2)?.width).toBeUndefined()
    await page.getByRole('button', { name: '重做', exact: true }).click(); await expect.poll(() => inspection().sheets[0].columnWidths?.find(value => value.min === 2)?.width).toBe(width)
    const jump = page.getByRole('textbox', { name: '转到单元格', exact: true }); await jump.fill('D9'); await jump.press('Enter')
    await expect(page.locator('.office-xlsx-selection-status')).toContainText('D8')
    await expect(cell('D9')).toHaveAttribute('readonly', '')
    const countBefore = edits.length
    await cell('D9').evaluate(node => { const data = new DataTransfer(); data.setData('text/plain', 'bad\tdata'); node.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })) })
    await expect(page.getByRole('alert')).toContainText('合并单元格')
    expect(edits).toHaveLength(countBefore)
    await jump.fill('Z10000'); await jump.press('Enter'); await expect(cell('Z10000')).toBeVisible()
    expect(await page.getByRole('textbox').count()).toBeLessThan(1000)
    await page.screenshot({ path: join(directory, 'grid-virtualized.png'), fullPage: true })
    await page.reload(); await expect(cell('B3')).toHaveValue('42')
    await cell('B3').click(); await expect(page.getByRole('textbox', { name: '单元格内容或公式', exact: true })).toHaveValue('=B2*2')
    const reopened = await page.getByRole('columnheader', { name: 'B', exact: true }).boundingBox(); expect(reopened?.width).toBeGreaterThan(170)
    const after = unzipSync(readFileSync(workbook)); expect(after['customXml/opaque.bin']).toEqual(originalParts['customXml/opaque.bin']); expect(after['xl/worksheets/sheet2.xml']).toEqual(originalParts['xl/worksheets/sheet2.xml'])
    expect(externalRequests).toEqual([]); expect(errors).toEqual([])
    await page.screenshot({ path: join(directory, 'grid-reopened.png'), fullPage: true })
    writeFileSync(join(directory, 'facts.json'), JSON.stringify({ status: 'passed', boundary: 'Actual Chromium renderer and original OOXML transformer; full Electron shared history covered by officeWordExcelCoediting spec.', edits, copied, width, externalRequests, errors }, null, 2))
    await info.attach('Excel grid facts', { path: join(directory, 'facts.json'), contentType: 'application/json' })
  } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
})
