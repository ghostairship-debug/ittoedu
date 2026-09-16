import { test, expect } from '@playwright/test'
import { createServer, transformWithEsbuild, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'

let server: ViteDevServer
test.beforeAll(async () => {
  server = await createServer({ configFile: false, cacheDir: resolve('output/.vite-shared-document-e2e'), optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client'] }, server: { port: 5197, strictPort: true, hmr: false, watch: { ignored: ['**/dist-renderer/**', '**/output/**', '**/test-results/**'] }, fs: { allow: [process.cwd(), realpathSync(resolve('node_modules'))] } }, plugins: [react(), {
    name: 'shared-document-test-host',
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (req.url !== '/document-test') return next(); res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml('/document-test', '<!doctype html><html><body><div id="root"></div><script type="module" src="/document-test.tsx"></script></body></html>')) }) },
    resolveId(id) { if (id === '/document-test.tsx') return '\0document-test.tsx' },
    async load(id) { if (id !== '\0document-test.tsx') return; return (await transformWithEsbuild(`
      import React, {useState,useRef} from 'react'; import {createRoot} from 'react-dom/client';
      import {SharedDocumentEditor} from '/src/renderer/document/SharedDocumentEditor.tsx';
      const initial={content:{blocks:[{id:'p1',type:'paragraph',content:{inlines:[{type:'text',text:'中文正文 '},{type:'math',formulaId:'f1',latex:'x^2',accessibleText:'x的平方'}]}},{id:'p2',type:'paragraph',content:{inlines:[{type:'text',text:'第二段'}]}},{id:'t1',type:'table',columns:[{id:'c1',header:{inlines:[{type:'text',text:'表头'}]}}],rows:[{id:'r1',cells:{c1:{inlines:[{type:'text',text:'单元格'}]}}}]}]},resources:{assets:[],components:[]}};
      function App(){const [doc,setDoc]=useState(initial),[revision,setRevision]=useState(0); const history=useRef([]),group=useRef('');return <SharedDocumentEditor document={doc} revision={String(revision)} onDraft={()=>{}} onChange={(next,operation)=>{if(group.current!==operation.historyGroup){history.current.push(doc);group.current=operation.historyGroup}setDoc(next);setRevision(x=>x+1)}} onUndo={()=>{const previous=history.current.pop();if(previous){setDoc(previous);setRevision(x=>x+1);group.current=''}}} onRedo={()=>{}}/>};createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
    `, 'document-test.tsx', { loader: 'tsx', jsx: 'automatic' })).code },
  }] })
  await server.listen()
})
test.afterAll(async () => { await server?.close() })
test('sharedDocumentEditor real mixed UI input, table, source and owner undo', async ({ page }) => {
  page.on('pageerror', error => console.error(error.message))
  await page.goto('http://localhost:5197/document-test')
  const editor = page.getByRole('textbox', { name: '正文排版编辑' })
  await expect(editor).toContainText('中文正文')
  await expect(editor.locator('table th')).toHaveText('表头')
  await editor.locator('p').first().click()
  await page.keyboard.press('Home')
  await page.keyboard.insertText('输入')
  await expect(editor).toContainText('输入中文正文')
  await page.getByRole('button', { name: '源文', exact: true }).click()
  await expect(page.getByLabel('正文源文编辑')).toContainText('输入中文正文')
  await page.getByRole('button', { name: '排版', exact: true }).click()
  await expect(editor).toContainText('输入中文正文')
  await expect(editor).toBeFocused()
  expect(await editor.evaluate(() => window.getSelection()?.anchorOffset)).toBe(2)
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(editor).not.toContainText('输入中文正文')
  await editor.locator('td [data-document-slot]').click()
  await page.keyboard.press('End')
  await page.keyboard.insertText('编辑')
  await expect(editor.locator('td')).toHaveText('单元格编辑')
  await page.getByRole('button', { name: '源文', exact: true }).click()
  const source = page.getByLabel('正文源文编辑')
  await source.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText('未闭合 $x')
  await expect(page.getByRole('alert')).toBeVisible()
  await page.getByRole('button', { name: '排版', exact: true }).click()
  await expect(source).toContainText('未闭合 $x')
  await page.getByRole('button', { name: '丢弃待修草稿' }).click()
  await expect(editor.locator('td')).toHaveText('单元格编辑')
})



