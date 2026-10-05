import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { DocumentHostService } from '../../../src/main/workbench/DocumentHostService'
import { WEB_DEFINITION } from '../../../src/components/web/data'
import { webContentRealmSource } from '../../../src/components/web/contentRealmImplementation'
import { htmlAssemblyFraming } from '../../../src/main/workbench/contentApply/application/html'
import type { ComponentProjectSnapshot } from '../../../src/core/projectFiles/componentPlatform'
import type { DocumentModel, DocumentSnapshot } from '../../../src/shared/workbench/document'

const output = process.argv[2]!
app.setPath('userData', path.join(output, 'profile'))
app.on('window-all-closed', () => {})
function course(snapshot: DocumentSnapshot): ComponentProjectSnapshot {
  assert.equal(snapshot.model.kind, 'course-v10')
  if (snapshot.model.kind !== 'course-v10') throw new Error('expected V10')
  return { ...snapshot, model: snapshot.model }
}

async function check() {
  await app.whenReady()
  const host = new DocumentHostService(path.join(output, 'recovery'))
  const original: Extract<DocumentModel, { kind: 'course-v10' }> = { kind: 'course-v10',
    resources: { assets: {}, components: {} }, project: { schemaVersion: 10, id: 'h0-css', revision: 0, title: 'CSS 局部重做',
      definitions: { [WEB_DEFINITION.id]: WEB_DEFINITION }, assets: {}, global: { underlay: [], overlay: [] },
      surfaces: [{ id: 'slide', kind: 'slide', title: '卡片', designSize: { width: 960, height: 640 }, childIds: ['neighbor', 'card'] }],
      instances: {
        card: { id: 'card', definitionId: WEB_DEFINITION.id, data: { html: '<section id="card">旧内容</section>' },
          frame: { width: 480, height: 320, transform: [0, 1, -1, 0, 420, 80] } },
        neighbor: { id: 'neighbor', definitionId: WEB_DEFINITION.id, data: { html: '<aside id="neighbor">人工邻居</aside>' },
          frame: { width: 120, height: 80, transform: [0.8, 0.3, -0.2, 1, 700, 300] } },
      },
    } }
  const initial = course(await host.internalAPI.create(original, '局部CSS.h5lesson'))
  await host.tools.beginRun({ runId: 'h0-css', actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }],
    fileAccess: { permission: 'workspace', workspaceRoot: output } })
  const html = '<!doctype html><html lang="zh"><head><title>样式上下文</title><style>'
    + 'body.lesson{margin:0}html[lang="zh"] body.lesson .card{box-sizing:border-box;width:320px;height:96px;padding:12px;font:28px/36px Arial;background:rgb(16,120,60);color:white}'
    + '.accent{color:rgb(20,40,200)}</style></head><body class="lesson">'
    + '<section id="card" class="card">重做 <strong class="accent">内容</strong><input aria-label="输入" value="5"></section>'
    + '<aside id="neighbor"><img src="unrelated.png">不授权的邻居变化</aside></body></html>'
  assert.equal(htmlAssemblyFraming({ intent: 'insert', target: { kind: 'instance', instanceId: 'card' },
    source: { kind: 'html', scope: 'projection', html },
    projection: { html, entries: [{ instanceId: 'card', sourcePath: [0] }] },
  }), 'content', 'retaining the document context must preserve local insertion sizing too')
  const result = await host.tools.applyComponentContent('h0-css', 'redo-css', initial, {
    intent: 'redo', target: { kind: 'instance', instanceId: 'card' }, source: { kind: 'html', scope: 'projection', html },
    projection: { html: '<section id="card">旧内容</section><aside id="neighbor">人工邻居</aside>',
      entries: [{ instanceId: 'card', sourcePath: [0] }, { instanceId: 'neighbor', sourcePath: [1] }] },
  })
  assert.equal(result.commit, 'committed', JSON.stringify(result.diagnostics))
  assert.ok(!result.diagnostics.some(item => item.reference === 'unrelated.png'), 'neighbor body resources must not enter the selected region')
  const current = course(await host.internalAPI.read(initial.documentId))
  assert.deepEqual(current.model.project.instances.neighbor, original.project.instances.neighbor)
  assert.deepEqual(current.model.project.assets, original.project.assets)
  const replacement = current.model.project.instances[result.insertedIds.at(-1)!]!
  assert.deepEqual(current.model.project.surfaces[0]!.childIds, ['neighbor', replacement.id])
  assert.ok(replacement.frame)
  assert.ok(Math.abs(replacement.frame.width - 320) < 0.1, `measured root width ${replacement.frame.width}`)
  assert.ok(Math.abs(replacement.frame.height - 96) < 0.1, `measured root height ${replacement.frame.height}`)
  const card = Object.values(current.model.project.instances).find(instance => instance.id !== 'neighbor'
    && instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data)
    && typeof instance.data.html === 'string' && instance.data.html.includes('id="card"'))!
  assert.ok(card, 'measured selected region must remain editable Web content')
  assert.equal(card.definitionId, WEB_DEFINITION.id)
  const consumer = new BrowserWindow({ show: false, skipTaskbar: true, width: 480, height: 320, useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
  try {
    await consumer.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html><body style="margin:0"></body></html>'))
    const observed = await consumer.webContents.executeJavaScript(`(async()=>{
      const instance=${JSON.stringify(card)};
      const source=${JSON.stringify(webContentRealmSource())};
      const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
      const implementation=(await import(url)).default;
      const root=document.createElement('div');root.style.cssText='width:'+instance.frame.width+'px;height:'+instance.frame.height+'px';document.body.append(root);
      const controller=new AbortController(),cleanups=[];
      const scope={signal:controller.signal,isActive:()=>!controller.signal.aborted,cleanup:fn=>cleanups.push(fn),events:{emit(){},subscribe(){return ()=>{}}}};
      await implementation.mount({instance,root,scope});
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const element=root.querySelector('#card'),accent=root.querySelector('.accent'),style=getComputedStyle(element),rect=element.getBoundingClientRect();
      const result={width:rect.width,height:rect.height,fontSize:style.fontSize,background:style.backgroundColor,accent:getComputedStyle(accent).color,input:root.querySelector('input').value,text:element.textContent};
      URL.revokeObjectURL(url);return result;
    })()`)
    assert.equal(observed.width, 320)
    assert.equal(observed.height, 96)
    assert.equal(observed.fontSize, '28px')
    assert.equal(observed.background, 'rgb(16, 120, 60)')
    assert.equal(observed.accent, 'rgb(20, 40, 200)')
    assert.equal(observed.input, '5')
    assert.ok(observed.text.includes('重做'))
    await host.tools.stop('h0-css')
    await host.operate({ type: 'close', documentId: initial.documentId, discardDirty: true })
    await fs.writeFile(path.join(output, 'consumer.png'), (await consumer.webContents.capturePage()).toPNG())
    await fs.writeFile(path.join(output, 'evidence.json'), JSON.stringify({ status: 'passed', commit: result.commit,
      measured: replacement.frame, observed, diagnostics: result.diagnostics, neighborPreserved: true }, null, 2))
    console.info(JSON.stringify({ status: 'passed', measured: replacement.frame, observed, evidence: output }))
  } finally { consumer.destroy() }
}

check().then(() => app.exit(0), error => { console.error(error); app.exit(1) })
