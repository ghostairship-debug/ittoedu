// Baseline reproduction, not a passing regression test. See REVIEW_FACTS.md.
import { tmpdir } from 'node:os'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { AgentFileText } from '../../../../src/main/workbench/execution/AgentFileText'
async function main() {
 const root = await mkdtemp(path.join(tmpdir(), 'gpt-plan-file-race-'))
 try {
  for (const mode of ['write', 'patch'] as const) {
   const filename=path.join(root, mode+'.txt'); await writeFile(filename,'before')
   const host=new DocumentHostService(path.join(root,'journal-'+mode)); const snapshot=await host.open(filename)
   const session=host.registry.get(snapshot.documentId); const files=new AgentFileText(host)
   const runId='race-'+mode; await host.tools.beginRun({runId,actor:'agent',documents:[]})
   const observed='document:'+snapshot.documentId+':'+snapshot.epoch+':'+snapshot.revision
   const attach=host.tools.attachRunDocument.bind(host.tools)
   let changed=false
   host.tools.attachRunDocument=async (...args) => {
    if (!changed) {changed=true; const now=session.read(); const res=await session.execute({documentId:now.documentId,epoch:now.epoch,baseRevision:now.revision,operationId:'human-'+mode,actor:'human',mutation:{type:'command',command:{type:'markdown.replace',source:'HUMAN!'}}}); console.log(mode,'human',JSON.stringify(res))}
    return attach(...args)
   }
   const context={runId,workspaceRoot:root,permission:'workspace' as const}
   const outcome=mode==='write'?await files.write(context,filename,'AI draft','replace',observed,'ai-'+mode):await files.patch(context,filename,observed,'before','AI draft',undefined,'ai-'+mode)
   console.log(mode,'AI',JSON.stringify(outcome.data),'FINAL',JSON.stringify(session.read().model))
  }
 } finally {await rm(root,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1})
