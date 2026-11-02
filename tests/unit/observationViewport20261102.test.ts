import { expect, it } from 'vitest'
import { viewObserveInputSchema } from '../../src/shared/workbench/viewObservation'
import { htmlActionToolSchemas } from '../../src/core/tools/HtmlActionTools'
import { executeViewObserveTool } from '../../src/core/tools/ViewObserveTools'
it('accepts only bounded complete CSS viewports, separate from cursor paging',()=>{
 for(const viewport of [{width:400,height:300},{width:1280,height:720}])expect(viewObserveInputSchema.safeParse({path:'page',viewport}).success).toBe(true)
 for(const viewport of [{width:400},{width:'400',height:300},{width:0,height:300},{width:400.5,height:300},{width:4096,height:4096},{width:400,height:300,scale:2}]){
  expect(viewObserveInputSchema.safeParse({path:'page',viewport}).success).toBe(false)
  expect(htmlActionToolSchemas['html.observe'].safeParse({viewport}).success).toBe(false)
 }
 expect(viewObserveInputSchema.safeParse({path:'page',viewport:{width:400,height:300},cursor:'old'}).success).toBe(false)
})
it('forwards explicit dimensions through the public course tool without changing authorized identity',async()=>{
 const seen:any[]=[]
 const target={documentId:'d',epoch:'e',revision:3,projectId:'p',locationId:'second'}
 await executeViewObserveTool({observe:async input=>{seen.push(input);throw Error('controlled capture')},readResource:async()=>{throw Error('unused')}},
 {runId:'run',operationId:'observe',resolveTarget:async()=>target},{target:'authorized',viewport:{width:400,height:300}})
 expect(seen).toEqual([{...target,runId:'run',requestId:'observe',viewport:{width:400,height:300}}])
})

