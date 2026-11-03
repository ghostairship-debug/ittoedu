import { _electron as electron, test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { unzipSync } from 'fflate'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { complexPptxFixture } from '../helpers/officeComplexFixture20261103'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createCourseProjectV10Archive } from '../../src/core/drivers/codecs/courseProjectV10Archive'
import { chooseM20Workspace, m20Row, closeM20, m20Evidence } from './helpers/g20M20Harness'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
const terminal = new Set(['completed','partial','failed','stopped','interrupted'])
const canonicalPath=(filename:string)=>process.platform==='win32'?resolve(filename).toLowerCase():resolve(filename)
const ppt = (filename: string) => {
 const data=inspectOfficeContent(readFileSync(filename),'pptx');if(data.format!=='pptx')throw new Error('format');return data
}
async function replaceTitle(page: Page, from: string, to: string, save = true, probes?: Array<Record<string, unknown>>) {
 const stage=page.getByTestId('pptx-edit-surface').filter({visible:true})
 await expect(stage).toContainText(from,{timeout:45000})
 const probe:Record<string,unknown>={from,to,save,status:'running'};probes?.push(probe)
 await stage.evaluate(root=>{
  const ids=new WeakMap<Node,number>();let nextId=1
  const brief=(value:EventTarget|null):unknown=>{
   if(value===window)return 'window'
   if(!(value instanceof Node))return String(value)
   if(!ids.has(value))ids.set(value,nextId++)
   return value instanceof Element?{id:ids.get(value),tag:value.tagName,cls:value.getAttribute('class'),editId:value.getAttribute('data-edit-id'),label:value.getAttribute('aria-label'),connected:value.isConnected,text:value.textContent?.slice(0,100)}:{id:ids.get(value),type:value.nodeType}
  }
  const state=()=>({at:performance.now(),documentFocus:document.hasFocus(),active:brief(document.activeElement),roots:[...root.children].map(brief),editable:[...root.querySelectorAll('[contenteditable="true"]')].map(brief)})
  const events:unknown[]=[],mutations:unknown[]=[]
  const receive=(event:Event)=>{
   if(events.length>=120)return
   const mouse=event as MouseEvent
   events.push({at:performance.now(),type:event.type,trusted:event.isTrusted,detail:mouse.detail,x:mouse.clientX,y:mouse.clientY,target:brief(event.target),path:event.composedPath().slice(0,8).map(brief),state:state()})
  }
  const names=['pointerdown','pointerup','click','dblclick','focus','blur','focusin','focusout']
  names.forEach(name=>window.addEventListener(name,receive,true))
  const containsEditor=(node:Node)=>node instanceof Element&&(node.hasAttribute('contenteditable')||Boolean(node.querySelector('[contenteditable]')))
  const observer=new MutationObserver(records=>records.forEach(record=>{
   if(mutations.length>=80)return
   if(record.target!==root&&record.attributeName!=='contenteditable'&&![...record.addedNodes,...record.removedNodes].some(containsEditor))return
   mutations.push({at:performance.now(),target:brief(record.target),attribute:record.attributeName,added:[...record.addedNodes].map(brief),removed:[...record.removedNodes].map(brief),state:state()})
  }))
  observer.observe(root,{subtree:true,childList:true,attributes:true,attributeFilter:['contenteditable']})
  const initial=state()
  ;(window as any).__officeTitleProbe={finish:()=>{
   observer.disconnect();names.forEach(name=>window.removeEventListener(name,receive,true))
   return {initial,events,mutations,final:state()}
  }}
 })
 try{
  const title=stage.getByText(from,{exact:true}).first()
  probe.before=await title.evaluate(element=>{
   const rect=(value:DOMRect)=>({x:value.x,y:value.y,width:value.width,height:value.height})
   const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT),ranges=[];let node:Node|null
   while(node=walker.nextNode()){if(!node.textContent?.trim())continue;const range=document.createRange();range.selectNodeContents(node);ranges.push({text:node.textContent,rect:rect(range.getBoundingClientRect())})}
   return {at:performance.now(),html:element.outerHTML,rect:rect(element.getBoundingClientRect()),ranges}
  })
  await title.dblclick()
  probe.afterDoubleClick=await stage.evaluate((root,text)=>{
   const rect=(value:DOMRect)=>({x:value.x,y:value.y,width:value.width,height:value.height})
   const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),ranges=[];let node:Node|null
   while(node=walker.nextNode()){if(node.textContent!==text)continue;const range=document.createRange();range.selectNodeContents(node);ranges.push({html:node.parentElement?.outerHTML,rect:rect(range.getBoundingClientRect())})}
   return {at:performance.now(),editable:root.querySelectorAll('[contenteditable="true"]').length,roots:root.children.length,documentFocus:document.hasFocus(),ranges}
  },from)
  await expect(stage.locator('[contenteditable="true"]').filter({visible:true}).first()).toBeVisible()
  await page.keyboard.press('Control+A');await page.keyboard.insertText(to);await page.keyboard.press('Escape')
  if(save)await page.locator('.pptx-editor').filter({visible:true}).getByRole('button',{name:'保存',exact:true}).click()
  probe.status='passed'
 }finally{
  if(probe.status!=='passed')probe.status='failed'
  probe.trace=await page.evaluate(()=>{const active=(window as any).__officeTitleProbe;delete (window as any).__officeTitleProbe;return active?.finish()}).catch(error=>({captureError:String(error)}))
 }
}
test.use({trace:'off',video:'off'})
test('real model and human alternate on PPT while discovering other open Office and GLX files',async ({},info)=>{
 test.skip(process.platform!=='win32'||process.env.GUOLING_OFFICE_REAL_API!=='1','Explicit actual-provider acceptance')
 test.setTimeout(720000)
 const key=process.env.TEAMOROUTER_API_KEY||execFileSync('powershell.exe',['-NoProfile','-Command',"[Environment]::GetEnvironmentVariable('TEAMOROUTER_API_KEY','User')"],{encoding:'utf8'}).trim()
 if(!key)throw new Error('Authorized test provider credential unavailable')
 const base=resolve('output/office-coedit-20261103/real-model');mkdirSync(base,{recursive:true})
 const directory=mkdtempSync(join(base,'run-')),workspace=join(directory,'workspace');mkdirSync(workspace)
 const fixture={directory,workspace,profile:join(directory,'profile')}
 const presentation=join(workspace,'项目汇报.pptx'),document=join(workspace,'会议记录.docx'),book=join(workspace,'预算.xlsx')
 const native=resolve('output/office-coedit-20261103/native/powerpoint-authored.pptx')
 writeFileSync(presentation,existsSync(native)?readFileSync(native):await complexPptxFixture())
 writeFileSync(book,(await applyOfficeContent(undefined,{format:'xlsx',operation:'create',sheets:[{name:'预算',rows:[['项目','数值'],['A',10],['合计',{formula:'SUM(B2:B2)'}]]}]})).bytes)
 const nativeProject=createBlankCourseProjectV10('教学')
 writeFileSync(join(workspace,'教学.glx'),createCourseProjectV10Archive({project:nativeProject,resources:{assets:{},components:{}}}))
 const initialParts=unzipSync(readFileSync(presentation)),original=ppt(presentation)
 const titleEditProbes:Array<Record<string,unknown>>=[]
 const facts:Record<string,unknown>={status:'running',phase:'launch',directory,provider:'teamorouter',model:'deepseek-flash',nativeSource:existsSync(native),rounds:[],titleEditProbes}
 const childEnv=Object.fromEntries(Object.entries(process.env).filter(([name])=>!['TEAMOROUTER_API_KEY','DEEPSEEK_API_KEY'].includes(name.toUpperCase())))
 const start=Date.now()
 const executablePath=process.env.COURSEWARE_E2E_PACKAGED_EXECUTABLE?.trim()
 if(executablePath&&!existsSync(executablePath))throw new Error('Requested packaged executable is absent')
 delete childEnv.ELECTRON_RUN_AS_NODE
 const launch=()=>electron.launch({cwd:executablePath?directory:resolve('.'),args:[...(executablePath?[]:['.']), '--user-data-dir='+fixture.profile],
  env:{...childEnv,VITE_DEV_SERVER_URL:'',[BACKGROUND_E2E_ENV]:executablePath?'0':'1',...(executablePath?{COURSEWARE_COMPONENTS_DIR:join(directory,'missing-packaged-components')}: {})},
  ...(executablePath?{executablePath:resolve(executablePath),timeout:45000}:{})})
 let app=await launch()
 let page=await app.firstWindow();page.setDefaultTimeout(20000)
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]?.setContentSize(1700,1000))
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 try{
  facts.launchMs=Date.now()-start
  const runtime=await app.evaluate(({app})=>({packaged:app.isPackaged,appPath:app.getAppPath(),execPath:process.execPath,cwd:process.cwd(),userData:app.getPath('userData'),configuredComponentDirectory:process.env.COURSEWARE_COMPONENTS_DIR??''}))
  facts.runtime=runtime
  expect(canonicalPath(runtime.userData)).toBe(canonicalPath(fixture.profile))
  expect(canonicalPath(runtime.cwd)).toBe(canonicalPath(executablePath?directory:resolve('.')))
  if(executablePath){expect(runtime.packaged).toBe(true);expect(canonicalPath(runtime.execPath)).toBe(canonicalPath(executablePath));expect(canonicalPath(runtime.appPath)).toBe(canonicalPath(join(dirname(resolve(executablePath)),'resources','app.asar')))}
  facts.phase='first-connection-ui'
  const initialSettings=await page.evaluate(()=>window.desktopAPI.executionSettings!.read())
  expect(initialSettings.connections).toHaveLength(0)
  expect(initialSettings.profile.roles.conversation).toBeNull()
  await page.getByRole('button',{name:'切换模型',exact:true}).click()
  await page.getByRole('button',{name:'管理模型与连接…',exact:true}).click()
  await page.getByText('连接详情',{exact:true}).click()
  await page.getByLabel('供应商标识',{exact:true}).fill('teamorouter')
  await page.getByLabel('账号标识',{exact:true}).fill('office-coedit-acceptance')
  await page.getByLabel('API 地址',{exact:true}).fill('https://api.teamorouter.com/v1')
  await page.getByLabel('API Key',{exact:true}).fill(key)
  await page.getByRole('button',{name:'保存连接',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'连接设置已保存'})).toBeVisible()
  const settings=await page.evaluate(()=>window.desktopAPI.executionSettings!.read())
  const connection=settings.connections.find(entry=>entry.connection.accountId==='office-coedit-acceptance')!
  expect(connection.hasCredential).toBe(true)
  await page.getByRole('button',{name:'读取模型目录',exact:true}).click()
  await page.getByLabel('主力模型连接',{exact:true}).selectOption(connection.connection.id)
  await expect(page.getByLabel('主力模型',{exact:true}).locator('option[value="deepseek-flash"]')).toHaveCount(1,{timeout:45000})
  const modelCount=await page.getByLabel('主力模型',{exact:true}).locator('option').count()
  await page.getByLabel('主力模型',{exact:true}).selectOption('deepseek-flash')
  await page.getByRole('button',{name:'保存模型角色',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'模型角色已保存'})).toBeVisible()
  await page.getByRole('button',{name:'关闭模型连接设置',exact:true}).click()
  facts.firstConnection={cleanProfile:true,uiConfigured:true,existingAuthorizedApiKey:true,newOAuthLogin:false,catalogModelPresent:true,modelCount}
  await chooseM20Workspace(app,page,workspace)
  const assistant=page.getByRole('region',{name:'创作助手',exact:true})
  await assistant.getByRole('button',{name:/^权限：/}).click()
  await assistant.getByRole('menuitemradio',{name:/^完全访问（工作空间）/}).click()
  const scope=await page.evaluate(async folder=>{
   const space=await window.desktopAPI.execution!.workspace(folder),conversation=space.conversations[0]
   if(!conversation)throw new Error('visible workspace conversation missing')
   return {workspaceId:space.workspace.workspaceId,conversationId:conversation.conversationId}
  },workspace)
  facts.phase='first-model-creation'
  await assistant.getByRole('textbox',{name:'给果铃AI发消息',exact:true}).fill('请在当前工作空间根目录新建并保存“会议记录.docx”，正文只有两个普通段落，第一段准确写“会议原稿”，第二段准确写“保留段落”。不要改变其他文件。请用office.create创建真实可编辑Word文档，保存成功后简短结束。')
  await assistant.getByRole('button',{name:'发送',exact:true}).click()
  let creationRunId=''
  await expect.poll(async()=>{const submissions=await page.evaluate(s=>window.desktopAPI.execution!.submissions(s),scope);creationRunId=submissions.at(-1)?.runId??'';return creationRunId},{timeout:45000}).not.toBe('')
  await expect.poll(async()=>{const run=await page.evaluate(id=>window.desktopAPI.execution!.run(id),creationRunId);return run&&terminal.has(run.status)?run.status:null},{timeout:180000,intervals:[1000,2000]}).not.toBeNull()
  const creation=await page.evaluate(id=>window.desktopAPI.execution!.run(id),creationRunId)
  facts.firstCreation={runId:creationRunId,status:creation?.status,tools:creation?.tools.map(tool=>({name:tool.call.name,input:tool.call.input,result:tool.result})),failure:creation?.failure}
  expect(creation?.status).toBe('completed')
  expect(creation?.tools.some(tool=>tool.call.name==='office.create'&&tool.result?.kind==='read')).toBe(true)
  const created=inspectOfficeContent(readFileSync(document),'docx')
  expect(created.format==='docx'&&created.paragraphs.map(paragraph=>paragraph.text)).toEqual(['会议原稿','保留段落'])
  facts.firstCreation={runId:creationRunId,status:creation?.status,toolNames:creation?.tools.map(tool=>tool.call.name),editableDocx:true}
  for(const name of ['教学.glx','预算.xlsx','会议记录.docx','项目汇报.pptx'])await m20Row(page,name).dblclick()
  await expect(page.locator('.workspace-document-tabs').getByRole('tab')).toHaveCount(4)
  facts.phase='human-before-ai'
  await page.locator('.workspace-document-tabs').getByRole('tab',{name:/会议记录.docx/}).click()
  await page.locator('.office-word-editor').filter({visible:true}).getByRole('textbox',{name:'第 1 段',exact:true}).fill('人工会议稿')
  await page.locator('.workspace-document-tabs').getByRole('tab',{name:/预算.xlsx/}).click()
  await page.locator('.office-sheet-editor').filter({visible:true}).getByRole('textbox',{name:'预算!B2',exact:true}).fill('21')
  await page.locator('.workspace-document-tabs').getByRole('tab',{name:/项目汇报.pptx/}).click()
  await replaceTitle(page,'Complex original title','人工阶段标题',false,titleEditProbes)
  expect(ppt(presentation).slides[0].shapes.find(s=>s.name==='title')?.text).toBe('Complex original title')
  const humanParts=unzipSync(readFileSync(presentation))
  for(const [name,bytes]of Object.entries(initialParts))if(/\/(charts|embeddings)\//.test(name))expect(humanParts[name],name).toEqual(bytes)
  expect(ppt(presentation).slides[0].animations).toEqual(original.slides[0].animations)
  const refs=assistant.getByLabel('本条消息的文件引用',{exact:true})
  await expect(refs).toContainText('项目汇报')
  await expect(refs).toContainText('第 1 页')
  await assistant.getByRole('button',{name:'添加',exact:true}).click()
  await assistant.getByRole('menuitem',{name:'引用当前页',exact:true}).click()
  await expect(refs.getByRole('button',{name:'取消固定 项目汇报.pptx',exact:true})).toBeVisible()
  await page.locator('.workspace-document-tabs').getByRole('tab',{name:/预算.xlsx/}).click()
  await expect(refs).toContainText('项目汇报')
  await expect(refs).not.toContainText('预算.xlsx')
  await page.locator('.workspace-document-tabs').getByRole('tab',{name:/项目汇报.pptx/}).click()
  await refs.getByRole('button',{name:'取消固定 项目汇报.pptx',exact:true}).click()
  const before=(await page.evaluate(s=>window.desktopAPI.execution!.submissions(s),scope)).length
  facts.phase='actual-model'
  await assistant.getByRole('textbox',{name:'给果铃AI发消息',exact:true}).fill('请直接修改已打开的文件并保存：当前演示文稿第1页标题改为“AI接续标题”，把该页Revenue图表第二个数值改为97，把标题已有的淡入动画时长改为1.25秒；把“会议记录.docx”第一段改为“AI整理会议记录”，保持第二段；把“预算.xlsx”预算工作表B2改为25，保持合计公式。保留教学.glx以及所有未指定内容。通过office.inspect定位再office.edit定点修改，全部保存成功后简短结束。')
  await assistant.getByRole('button',{name:'发送',exact:true}).click()
  await expect.poll(async()=> (await page.evaluate(s=>window.desktopAPI.execution!.submissions(s),scope)).length,{timeout:45000}).toBeGreaterThan(before)
  const submitted=(await page.evaluate(s=>window.desktopAPI.execution!.submissions(s),scope)).at(-1)!
  let runId=''
  await expect.poll(async()=>{runId=(await page.evaluate(s=>window.desktopAPI.execution!.submission(s),{...scope,submissionId:submitted.submissionId}))?.runId??'';return runId},{timeout:45000}).not.toBe('')
  facts.runId=runId
  expect(submitted.fileContext?.openFiles).toHaveLength(4)
  expect(submitted.fileContext?.references[0]?.path).toBe(presentation)
  expect(submitted.fileContext?.references[0]?.focus?.page).toBe(0)
  expect(submitted.fileContext?.references[0]?.focus?.shapeIds).toContain(original.slides[0].shapes.find(shape=>shape.name==='title')!.shapeId)
  expect(JSON.stringify(submitted.fileContext)).not.toContain('人工阶段标题')
  expect(JSON.stringify(submitted.fileContext)).not.toContain('人工会议稿')
  facts.submittedFileContext=submitted.fileContext
  await expect.poll(async()=>{const run=await page.evaluate(id=>window.desktopAPI.execution!.run(id),runId);return run&&terminal.has(run.status)?run.status:null},{timeout:300000,intervals:[1000,2000]}).not.toBeNull()
  const run=await page.evaluate(id=>window.desktopAPI.execution!.run(id),runId)
  facts.modelStatus=run?.status;facts.tools=run?.tools.map(t=>({name:t.call.name,input:t.call.input,state:t.state,result:t.result}));facts.failure=run?.failure
  writeFileSync(join(directory,'model-evidence.json'),JSON.stringify(facts,null,2))
  expect(run?.status).toBe('completed')
  expect(run?.input.permission).toBe('workspace')
  expect(run?.tools.some(t=>t.call.name==='office.inspect')).toBe(true)
  expect(run?.tools.some(t=>t.call.name==='office.inspect'&&JSON.stringify(t.result).includes('人工阶段标题'))).toBe(true)
  expect(run?.tools.some(t=>t.call.name==='office.inspect'&&JSON.stringify(t.result).includes('人工会议稿'))).toBe(true)
  expect(run?.tools.some(t=>t.call.name==='office.inspect'&&JSON.stringify(t.result).includes('"cell":"B2","value":21'))).toBe(true)
  expect(run?.tools.filter(t=>t.call.name==='office.edit').length).toBeGreaterThanOrEqual(3)
  await expect.poll(()=>ppt(presentation).slides[0].shapes.find(s=>s.name==='title')?.text).toBe('AI接续标题')
  expect(ppt(presentation).slides[0].shapes.find(s=>s.chart)?.chart?.series[0].values[1].value).toBe(97)
  expect(ppt(presentation).slides[0].animations?.some(a=>a.kind==='animEffect'&&a.duration==='1250')).toBe(true)
  const word=inspectOfficeContent(readFileSync(document),'docx'),excel=inspectOfficeContent(readFileSync(book),'xlsx')
  expect(word.format==='docx'&&word.paragraphs[0].text).toBe('AI整理会议记录')
  expect(word.format==='docx'&&word.paragraphs[1].text).toBe('保留段落')
  expect(excel.format==='xlsx'&&excel.sheets[0].cells.find(c=>c.cell==='B2')?.value).toBe(25)
  expect(excel.format==='xlsx'&&excel.sheets[0].cells.find(c=>c.cell==='B3')?.formula).toBe('SUM(B2:B2)')
  facts.phase='human-after-ai'
  const aiParts=unzipSync(readFileSync(presentation))
  await replaceTitle(page,'AI接续标题','用户接续标题',true,titleEditProbes)
  await expect.poll(()=>ppt(presentation).slides[0].shapes.find(s=>s.name==='title')?.text).toBe('用户接续标题')
  const editor=page.locator('.pptx-editor').filter({visible:true})
  await editor.getByRole('button',{name:'撤销',exact:true}).click()
  await expect.poll(()=>ppt(presentation).slides[0].shapes.find(s=>s.name==='title')?.text).toBe('AI接续标题')
  await editor.getByRole('button',{name:'重做',exact:true}).click()
  await expect.poll(()=>ppt(presentation).slides[0].shapes.find(s=>s.name==='title')?.text).toBe('用户接续标题')
  const finalParts=unzipSync(readFileSync(presentation))
  for(const [name,bytes]of Object.entries(aiParts))if(/\/(charts|embeddings)\//.test(name))expect(finalParts[name],name).toEqual(bytes)
  facts.phase='word-excel-human-after-ai'
  await page.locator('.workspace-document-tabs').getByRole('tab',{name:/会议记录.docx/}).click()
  const wordEditor=page.locator('.office-word-editor').filter({visible:true})
  await expect(wordEditor.getByRole('textbox',{name:'第 1 段',exact:true})).toHaveText('AI整理会议记录')
  await wordEditor.getByRole('textbox',{name:'第 1 段',exact:true}).fill('人工接续会议记录')
  await wordEditor.getByRole('button',{name:'保存',exact:true}).click()
  await expect(wordEditor.locator('.office-leaf-status')).toHaveText('已保存')
  await wordEditor.getByRole('button',{name:'撤销',exact:true}).click()
  await expect(wordEditor.getByRole('textbox',{name:'第 1 段',exact:true})).toHaveText('AI整理会议记录')
  await wordEditor.getByRole('button',{name:'重做',exact:true}).click()
  await expect(wordEditor.getByRole('textbox',{name:'第 1 段',exact:true})).toHaveText('人工接续会议记录')
  await page.locator('.workspace-document-tabs').getByRole('tab',{name:/预算.xlsx/}).click()
  const excelEditor=page.locator('.office-sheet-editor').filter({visible:true})
  await expect(excelEditor.getByRole('textbox',{name:'预算!B2',exact:true})).toHaveValue('25')
  await excelEditor.getByRole('textbox',{name:'预算!B3',exact:true}).fill('=B2*2')
  await excelEditor.getByRole('button',{name:'保存',exact:true}).click()
  await expect(excelEditor.locator('.office-leaf-status')).toHaveText('已保存')
  await expect(excelEditor.getByRole('textbox',{name:'预算!B3',exact:true})).toHaveValue('50')
  await excelEditor.getByRole('button',{name:'撤销',exact:true}).click()
  await expect(excelEditor.getByRole('textbox',{name:'预算!B3',exact:true})).toHaveValue('25')
  await excelEditor.getByRole('button',{name:'重做',exact:true}).click()
  await expect(excelEditor.getByRole('textbox',{name:'预算!B3',exact:true})).toHaveValue('50')
  await page.locator('.workspace-document-tabs').getByRole('tab',{name:/项目汇报.pptx/}).click()
  facts.phase='automatic-reference-next-input'
  await refs.getByRole('button',{name:'移除文件引用 项目汇报.pptx',exact:true}).click()
  await expect(refs).toHaveCount(0)
  const acceptedBefore=(await page.evaluate(s=>window.desktopAPI.execution!.submissions(s),scope)).length
  await assistant.getByRole('textbox',{name:'给果铃AI发消息',exact:true}).fill('简要列出刚才完成的修改，不再修改任何文件。')
  await assistant.getByRole('button',{name:'发送',exact:true}).click()
  await expect.poll(async()=> (await page.evaluate(s=>window.desktopAPI.execution!.submissions(s),scope)).length,{timeout:30000}).toBeGreaterThan(acceptedBefore)
  const summarySubmission=(await page.evaluate(s=>window.desktopAPI.execution!.submissions(s),scope)).at(-1)!
  expect(summarySubmission.fileContext?.references).toEqual([])
  await expect(refs).toContainText('项目汇报',{timeout:30000})
  let summaryRunId=''
  await expect.poll(async()=>{summaryRunId=(await page.evaluate(s=>window.desktopAPI.execution!.submission(s),{...scope,submissionId:summarySubmission.submissionId}))?.runId??'';return summaryRunId},{timeout:30000}).not.toBe('')
  await expect.poll(async()=>{const next=await page.evaluate(id=>window.desktopAPI.execution!.run(id),summaryRunId);return next&&terminal.has(next.status)?next.status:null},{timeout:120000}).not.toBeNull()
  const summaryRun=await page.evaluate(id=>window.desktopAPI.execution!.run(id),summaryRunId)
  expect(summaryRun?.status).toBe('completed')
  expect(summaryRun?.tools.some(tool=>tool.call.name==='office.edit')).toBe(false)
  facts.referenceReset={summaryRunId,status:summaryRun?.status,restored:true}
  facts.phase='cold-reopen-with-persisted-history'
  const previousPid=app.process().pid
  await closeM20(app);app=await launch();page=await app.firstWindow();page.setDefaultTimeout(20000)
  page.on('pageerror',e=>errors.push(e.message))
  expect(app.process().pid).not.toBe(previousPid)
  const coldRuntime=await app.evaluate(({app})=>({packaged:app.isPackaged,appPath:app.getAppPath(),execPath:process.execPath,cwd:process.cwd(),userData:app.getPath('userData'),configuredComponentDirectory:process.env.COURSEWARE_COMPONENTS_DIR??''}))
  expect(coldRuntime).toEqual(runtime);facts.coldRuntime=coldRuntime
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0]?.setContentSize(1700,1000))
  await chooseM20Workspace(app,page,workspace)
  for(const name of ['教学.glx','预算.xlsx','会议记录.docx','项目汇报.pptx'])await m20Row(page,name).dblclick()
  await expect(page.locator('.workspace-document-tabs').getByRole('tab')).toHaveCount(4)
  const reopened=page.locator('.pptx-editor').filter({visible:true})
  await expect(reopened.getByTestId('pptx-edit-surface')).toContainText('用户接续标题',{timeout:45000})
  await reopened.getByRole('button',{name:'撤销',exact:true}).click()
  await expect.poll(()=>ppt(presentation).slides[0].shapes.find(s=>s.name==='title')?.text).toBe('AI接续标题')
  await reopened.getByRole('button',{name:'重做',exact:true}).click()
  await expect.poll(()=>ppt(presentation).slides[0].shapes.find(s=>s.name==='title')?.text).toBe('用户接续标题')
  await page.locator('.workspace-document-tabs').getByRole('tab',{name:/会议记录.docx/}).click()
  const reopenedWord=page.locator('.office-word-editor').filter({visible:true})
  await expect(reopenedWord.getByRole('textbox',{name:'第 1 段',exact:true})).toHaveText('人工接续会议记录')
  await expect(reopenedWord.getByRole('button',{name:'撤销',exact:true})).toBeEnabled()
  await page.locator('.workspace-document-tabs').getByRole('tab',{name:/预算.xlsx/}).click()
  const reopenedExcel=page.locator('.office-sheet-editor').filter({visible:true})
  await expect(reopenedExcel.getByRole('textbox',{name:'预算!B2',exact:true})).toHaveValue('25')
  await expect(reopenedExcel.getByRole('textbox',{name:'预算!B3',exact:true})).toHaveValue('50')
  await expect(reopenedExcel.getByRole('button',{name:'撤销',exact:true})).toBeEnabled()
  facts.coldReopen={newProcess:true,pptSharedHistory:true,wordAndExcelHistoryRecovered:true}
  facts.processMetrics=await app.evaluate(({app})=>app.getAppMetrics().map(p=>({type:p.type,memory:p.memory})))
  expect(errors).toEqual([]);facts.status='passed';facts.phase='complete';facts.errors=errors
  await m20Evidence(info,fixture,page,facts)
 }catch(error){const safeError=new Error((error instanceof Error?error.message:String(error)).replaceAll(key,'[redacted]'));facts.errors=errors.map(message=>message.replaceAll(key,'[redacted]'));facts.alerts=(await page.getByRole('alert').allTextContents().catch(()=>[])).map(message=>message.replaceAll(key,'[redacted]'));await m20Evidence(info,fixture,page,facts,safeError);throw safeError}
 finally{await closeM20(app)}
})
