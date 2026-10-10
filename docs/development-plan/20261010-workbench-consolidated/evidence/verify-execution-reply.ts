// Baseline reproduction, not a passing regression test. See REVIEW_FACTS.md.
import { ExecutionDesktopService } from '../../../../src/main/workbench/execution/ExecutionDesktopService'
async function main() {
 const service=Object.create(ExecutionDesktopService.prototype) as any
 for(const kind of ['historical','progress','truncated']) {
  let current={workspaceId:'ws',conversationId:'c',revision:1,messages:[{role:'user',text:'本次请求'}]}
  service.conversations={listWorkspaces:async()=>[{workspaceId:'ws'}],readConversation:async()=>current,updateConversation:async ({patch}:any)=>{current={...current,...patch};return current}}
  const messages:any[]=[{role:'assistant',content:'上一轮已修改完成'},{role:'user',content:'本次请求'}]
  if(kind==='progress')messages.push({role:'assistant',content:'正在修改，请稍等',tool_calls:[{id:'t',type:'function',function:{name:'text.replace',arguments:'{}'}}]})
  if(kind==='truncated')messages.push({role:'assistant',content:'结论有三点：第一点是'})
  await service.collectReply({runId:'new-'+kind,input:{conversationId:'c'},messages,initialMessageCount:2,status:'failed',requests:[{finishReason:kind==='truncated'?'length':undefined}]})
  console.log(kind,JSON.stringify(current.messages))
 }
}
main().catch(error=>{console.error(error);process.exitCode=1})
