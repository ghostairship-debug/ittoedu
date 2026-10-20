import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { registerPrivilegedSchemes } from '../../../src/main/protocols'
import { createBlankCourseProjectV10 } from '../../../src/core/course/createCourseProjectV10'
import { componentProjectFiles } from '../../../src/core/projectFiles/componentPlatform'
import { DocumentHostService } from '../../../src/main/workbench/DocumentHostService'
import { patchHtmlAuthoringRecords } from '../../../src/shared/html/htmlAuthoringRecords'

const directory = process.env.C_PROBE_DIR!
app.setPath('userData', path.join(directory, 'profile'))
app.on('window-all-closed', () => {})
registerPrivilegedSchemes()
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
const shell = (body: string) => `<!doctype html><html><head><style>html,body{margin:0;width:100%;height:100%;font:24px Arial}h1{margin:0}p{margin:12px 0}img{width:120px;height:80px}iframe{display:block;width:520px;height:200px;border:0}#stage{width:520px;height:200px;display:grid;grid-template-rows:auto 1fr auto}</style></head><body>${body}</body></html>`
const fixtures = {
  ordinary: shell(`<h1>Independent title</h1><p>Ordinary body</p><img alt="Figure" src="data:image/png;base64,${png}">`),
  mixed: shell(`<h1>Independent title</h1><p>Ordinary body</p><img alt="Figure" src="data:image/png;base64,${png}"><iframe title="Local activity" src="activity.html"></iframe>`),
  operations: '',
  srcdoc: shell(`<h1>Independent title</h1><iframe title="Local activity" srcdoc="&lt;button onclick=&quot;this.nextElementSibling.value++&quot;&gt;Add&lt;/button&gt;&lt;output&gt;0&lt;/output&gt;"></iframe>`),
  global: shell('<h1 id="title">Global title</h1><button id="add">Add</button><output id="count">0</output><script>let count=0;document.getElementById("add").onclick=()=>{document.getElementById("count").value=++count;document.getElementById("title").textContent="Global "+count}</script>'),
  stage: shell('<h1>Independent title</h1><section id="stage" data-gl-layout="stage" data-gl-variants="wide compact"><header data-gl-slot="heading">Local heading</header><div data-gl-slot="body">Body</div><div data-gl-slot="feedback">Feedback</div><nav data-gl-slot="actions"><button>Apply</button></nav></section>'),
  json: shell('<h1>JSON document</h1><script type="application/json">{"hello":"world"}</script><p>Ordinary body</p>'),
  headJson: shell('<h1>Head JSON document</h1><p>Ordinary body</p>').replace('</head>', '<script type="application/ld+json" id="metadata">{"name":"Head data"}</script></head>'),
  form: shell('<h1>Form title</h1><form id="activity"><label>Answer<input name="answer" required></label><button>Check</button></form>'),
  css: shell('<h1>CSS activity</h1><section><input id="toggle" type="checkbox"><label for="toggle">Show feedback</label><p class="feedback">Shared CSS feedback</p><style>#toggle:not(:checked)~.feedback{display:none}</style></section>'),
  records: patchHtmlAuthoringRecords(shell('<p id="recorded">Baseline</p>'), { text: { kind: 'text', binding: { kind: 'dom', path: [{ tag: 'body', index: 1 }, { tag: 'p', index: 0, attributes: { id: 'recorded' } }], textIndex: 0, baseline: 'Baseline' }, overrides: { text: 'Human text', geometry: { translateX: 12 } } } }),
}
async function run() {
  await app.whenReady()
  const facts: Record<string, unknown> = {}
  await fs.mkdir(directory, { recursive: true })
  await fs.writeFile(path.join(directory, 'activity.html'), '<!doctype html><html><body><button id="add">Add</button><output>0</output><script>let n=0;document.querySelector("button").onclick=()=>document.querySelector("output").value=++n</script></body></html>')
  for (const [name, content] of Object.entries(fixtures)) {
    const root = path.join(directory, name)
    await fs.mkdir(root, { recursive: true })
    const host = new DocumentHostService(path.join(root, 'recovery'))
    const project = createBlankCourseProjectV10(name)
    const initial = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, `${name}.glx`)
    await host.tools.beginRun({ runId: name, actor: 'agent', documents: [{ documentId: initial.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: directory } })
    await host.tools.loadToolFamilies(name, ['content'])
    let serial = 0
    const call = (tool: string, input: unknown) => host.tools.execute(name, `call-${++serial}`, { name: tool, input })
    const page = componentProjectFiles(project, { assets: {}, components: {} }).find(file => file.kind === 'page')!
    await call('project.read', { path: page.path })
    await fs.writeFile(path.join(directory, `${name}.html`), content)
    const applied = name === 'operations' ? await call('project.apply', { operations: [
      { path: page.path, intent: 'insert', content: '<h1>Independent ordinary text</h1>', region: { width: 800, height: 100, transform: [1, 0, 0, 1, 30, 30] } },
      { path: page.path, intent: 'insert', content: '<button>Add</button><output>0</output><script>let n=0;document.querySelector("button").onclick=()=>document.querySelector("output").value=++n</script>', region: { width: 520, height: 200, transform: [1, 0, 0, 1, 30, 180] } },
    ] }) : await call('project.apply', { path: page.path, intent: 'insert', from: `${name}.html` })
    let next: unknown
    let snapshot = await host.internalAPI.read(initial.documentId)
    if (snapshot.model.kind !== 'course-v10') throw new Error('Not V10')
    let model = snapshot.model
    const beforeInstances = structuredClone(model.project.instances)
    let edits: unknown, runtime: unknown
    if (['mixed', 'srcdoc', 'global', 'json', 'headJson', 'form', 'css', 'operations'].includes(name)) {
      const program = Object.values(model.project.instances).find(instance => instance.data && typeof instance.data === 'object' && !Array.isArray(instance.data)
        && typeof instance.data.html === 'string')!
      const data = program.data as { html: string; resourceBindings?: Record<string, string> }
      let html = data.html
      for (const [reference, id] of Object.entries(data.resourceBindings ?? {})) html = html.split(reference).join(`data:${model.project.assets[id]!.mimeType};base64,${Buffer.from(model.resources.assets[id]!).toString('base64')}`)
      const viewport = { width: Math.ceil(program.frame!.width), height: Math.ceil(program.frame!.height) }
      const window = new BrowserWindow({ show: false, width: viewport.width, height: viewport.height, useContentSize: true,
        webPreferences: { sandbox: true, contextIsolation: true } })
      try {
        await window.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`)
        window.webContents.enableDeviceEmulation({ screenPosition: 'desktop', screenSize: viewport,
          viewPosition: { x: 0, y: 0 }, deviceScaleFactor: 1, viewSize: viewport, scale: 1 })
        const script = name === 'json' || name === 'headJson' ? `JSON.parse(document.querySelector('script[type]').textContent)`
          : name === 'form' ? `(()=>{const input=document.querySelector('input'),form=document.querySelector('form');const invalid=!form.checkValidity();input.value='Filled';return {owner:input.form.id,label:document.querySelector('label').control===input,invalid,valid:form.checkValidity()}})()`
          : name === 'css' ? `(()=>{const feedback=document.querySelector('.feedback'),before=getComputedStyle(feedback).display;document.querySelector('input').click();return {before,after:getComputedStyle(feedback).display,text:feedback.textContent}})()`
          : `(async()=>{const frame=document.querySelector('iframe');if(frame)await new Promise(resolve=>frame.contentDocument?.readyState==='complete'?resolve():frame.addEventListener('load',resolve,{once:true}));const doc=frame?frame.contentDocument:document;doc.querySelector('button').click();return {output:doc.querySelector('output').value,title:doc.querySelector('h1')?.textContent,iframe:!!frame,viewport:frame?{width:frame.contentWindow.innerWidth,height:frame.contentWindow.innerHeight}:{width:innerWidth,height:innerHeight}}})()`
        runtime = await window.webContents.executeJavaScript(script)
        try { await fs.writeFile(path.join(root, 'runtime.png'), (await window.webContents.capturePage()).toPNG()) }
        catch (error) { await fs.writeFile(path.join(root, 'runtime-capture-error.txt'), String(error)) }
      } finally { window.destroy() }
    }
    if (name === 'ordinary' || name === 'global' || name === 'records') {
      const target = componentProjectFiles(model.project, model.resources).find(file => name === 'ordinary' ? file.kind === 'page' : file.kind === 'html' && file.target?.kind === 'instance')!
      const id = name === 'ordinary' ? Object.values(model.project.instances).find(instance => JSON.stringify(instance.data).includes('Independent title'))!.id
        : target.target!.kind === 'instance' ? target.target!.instanceId : ''
      const before = structuredClone(model.project.instances[id]!)
      await call('project.read', { path: target.path })
      const content = name === 'global' ? shell('<h1>Global edited without script</h1><p>New ordinary body</p>')
        : name === 'records' ? shell('<p id="recorded">Changed baseline</p>') : target.content!.replace('Independent title', 'Edited title')
      const changed = await call('project.apply', { path: target.path, intent: name === 'records' ? 'redo' : 'content', content })
      snapshot = await host.internalAPI.read(initial.documentId)
      if (snapshot.model.kind !== 'course-v10') throw new Error('Not V10')
      model = snapshot.model
      const afterContent = structuredClone(model.project.instances[id]!)
      let redone: unknown, afterRedo: unknown, unresolved: unknown
      if (name === 'global') {
        await call('project.read', { path: target.path })
        redone = await call('project.apply', { path: target.path, intent: 'redo', content })
        const redoneSnapshot = await host.internalAPI.read(initial.documentId)
        if (redoneSnapshot.model.kind !== 'course-v10') throw new Error('Not V10')
        afterRedo = { instance: redoneSnapshot.model.project.instances[id], definitions: redoneSnapshot.model.project.definitions }
      } else if (name === 'records') {
        const revision = snapshot.revision
        await call('project.read', { path: target.path })
        const receipt = await call('project.apply', { path: target.path, intent: 'redo', content: shell('<p>Removed binding</p>') })
        const retained = await host.internalAPI.read(initial.documentId)
        unresolved = { receipt, sameRevision: retained.revision === revision, instance: retained.model.kind === 'course-v10' ? retained.model.project.instances[id] : undefined }
      } else {
        await host.internalAPI.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision, operationId: randomUUID(), actor: 'human', mutation: { type: 'undo' } })
        const undone = await host.internalAPI.read(initial.documentId)
        unresolved = { undoRestored: undone.model.kind === 'course-v10' && JSON.stringify(undone.model.project.instances[id]) === JSON.stringify(before), neighborUnchanged: Object.entries(model.project.instances).every(([other, instance]) => other === id || JSON.stringify(instance) === JSON.stringify(beforeInstances[other])) }
      }
      edits = { before, changed, afterContent, redone, afterRedo, unresolved }
      snapshot = await host.internalAPI.read(initial.documentId)
      if (snapshot.model.kind !== 'course-v10') throw new Error('Not V10')
      model = snapshot.model
    }
    if (name === 'ordinary') {
      next = await call('object.insert', { path: page.path, kind: 'text', text: 'Next', x: 700, y: 600, width: 150, height: 70, click: { action: 'scene.next' } })
      snapshot = await host.internalAPI.read(initial.documentId)
      if (snapshot.model.kind !== 'course-v10') throw new Error('Not V10')
      model = snapshot.model
    }
    await fs.writeFile(path.join(root, 'formal.json'), JSON.stringify(model, null, 2))
    await host.saveToPath(initial.documentId, path.join(root, `${name}.glx`))
    const cold = await new DocumentHostService(path.join(root, 'cold-recovery')).open(path.join(root, `${name}.glx`))
    const coldReopened = cold.model.kind === 'course-v10' && JSON.stringify(cold.model.project.instances) === JSON.stringify(model.project.instances)
    facts[name] = { applied, next, edits, runtime, revision: snapshot.revision, undoDepth: snapshot.undoDepth, roots: model.project.surfaces[0]!.childIds,
      coldReopened,
      instances: Object.values(model.project.instances).map(instance => ({ id: instance.id, implementation: instance.implementationOverride ?? model.project.definitions[instance.definitionId]?.implementation,
        children: instance.childIds, frame: instance.frame, data: instance.data })) }
    await host.tools.stop(name)
  }
  await fs.writeFile(path.join(directory, 'facts.json'), JSON.stringify(facts, null, 2))
}
run().then(() => app.exit(0), async error => { await fs.writeFile(path.join(directory, 'error.txt'), String(error.stack ?? error)); app.exit(1) })
