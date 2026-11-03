// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { OfficeFileService } from '../../src/main/workbench/office/OfficeFileService'
import { applyOfficeContent, inspectOfficeContent } from '../../src/main/workbench/office/OfficeContentService'
import { readPptxPreview } from '../../src/main/workbench/officePreviewDesktopService'
import { operateOfficeDocument } from '../../src/main/workbench/officeDocumentDesktopService'
import type { OfficeContentRequest } from '../../src/shared/workbench/officeFiles'
const runtime = vi.hoisted(() => ({ host: null as unknown as DocumentHostService }))
vi.mock('electron', () => ({ app: { getPath: () => '', getAppPath: () => '', isPackaged: false }, net: {} }))
vi.mock('../../src/main/workbench/documentHost', () => ({ documentHost: () => runtime.host }))
vi.mock('../../src/main/workbench/workspaceFilesDesktopService', () => ({ assertAuthorizedWorkspacePath: async (filename: string) => filename }))
const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root,{recursive:true,force:true}) })
describe('Office IPC receipts stay pinned to the version that actually committed', () => {
 it.each(['pptx','docx','xlsx'] as const)('does not acknowledge a later writer as the %s human save', async format => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'office-receipt-'));roots.push(directory)
  const workspace=path.join(directory,'workspace');await fs.mkdir(workspace)
  const source:OfficeContentRequest=format==='pptx'?{format,operation:'create',slides:[{title:'Before'}]}:
    format==='docx'?{format,operation:'create',blocks:[{type:'paragraph',text:'Before'}]}:{format,operation:'create',sheets:[{name:'Sheet1',rows:[['Before']]}]}
  const filename=path.join(workspace,'race.'+format),original=(await applyOfficeContent(undefined,source)).bytes
  await fs.writeFile(filename,original)
  const host=new DocumentHostService(path.join(directory,'owner'));runtime.host=host;await host.files.registerRoot(workspace)
  const binding=await host.artifacts.bind(filename)
  const edit=(text:string):Extract<OfficeContentRequest,{operation:'edit'}>=>format==='pptx'?{format,operation:'edit',edits:[{slide:0,shape:'title',text}]}:
    format==='docx'?{format,operation:'edit',edits:[{type:'paragraph',index:0,text}]}:{format,operation:'edit',edits:[{sheet:'Sheet1',cell:'A1',value:text}]}
  const originalEdit=OfficeFileService.prototype.edit
  if(format==='pptx'){
   const originalCommit=OfficeFileService.prototype.commitCandidate
   vi.spyOn(OfficeFileService.prototype,'commitCandidate').mockImplementationOnce(async function(this:OfficeFileService,...args){
    const accepted=await originalCommit.apply(this,args)
    await originalEdit.call(this,accepted.binding,edit('Later AI'),{actor:'ai'})
    return accepted
   })
   const candidate=(await applyOfficeContent(original,edit('Human'))).bytes
   await expect(readPptxPreview({type:'pptx-preview.commit',binding,bytes:Uint8Array.from(candidate)})).rejects.toThrow(/绑定已失效|磁盘文件已改变/)
  }else{
   vi.spyOn(OfficeFileService.prototype,'edit').mockImplementationOnce(async function(this:OfficeFileService,...args){
    const accepted=await originalEdit.apply(this,args)
    await originalEdit.call(this,accepted.binding,edit('Later AI'),{actor:'ai'})
    return accepted
   })
   await expect(operateOfficeDocument({type:'office-document.edit',binding,content:edit('Human')})).rejects.toThrow(/绑定已失效|磁盘文件已改变/)
  }
  const latest=await host.artifacts.bind(filename),read=inspectOfficeContent(await host.artifacts.read(latest),format)
  expect(JSON.stringify(read)).toContain('Later AI')
  expect((await new OfficeFileService(host).history(latest)).entries.map(e=>e.actor)).toEqual(['human','ai'])
 }, 20000)
})
