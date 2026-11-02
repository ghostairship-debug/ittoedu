import { expect, it } from 'vitest'
import type { ToolResult } from '../../src/shared/workbench/tools'
import { projectContentApplyNavigation, projectCurrentToolResult } from '../../src/main/workbench/execution/ExecutionContextProjection'
import type { ProgrammaticJournalEntry } from '../../src/shared/workbench/programmatic'
const operation = (n: number) => ({ kind: 'read', data: { path: 'pages/'+n+'/program.content.html', currentPath: 'pages/'+n+'/program.content.html',
  commit: 'committed', insertedIds: ['i'+n], currentRevision: 5, operationIndex:n, frame:{width:100,height:80}, viewport:{width:100,height:80},
  generatedSource:{complete:true,content:'author();'.repeat(6000),revision:'source-5'},
  diagnostics:['retain diagnostic'], readPaths:['exact/read'],refreshPaths:['exact/refresh'],
  files:Array.from({length:30},(_,i)=>({path:'pages/'+n+'/'+i+'.view.js',type:'source',frame:{width:100,height:80},viewport:{width:100,height:80},
    summary:'repeated metadata',note:'author scope',references:[{path:'references/api.md'}],revision:'source-'+i,customContract:{keep:true}})) } })
it('keeps every real operation path ahead of both model bounds, preserving raw journal and source contracts',()=>{
  const raw={kind:'read',data:{commit:'committed',insertedIds:['a','b','c'],diagnostics:['batch diagnostic'],operations:[operation(0),operation(1),operation(2)]}} as ToolResult
  const before=structuredClone(raw)
  const projected=projectContentApplyNavigation(raw,'tool:run:apply') as any
  expect(raw).toEqual(before)
  expect(projected.data.operations[0].data.generatedSource).toEqual((before as any).data.operations[0].data.generatedSource)
  expect(projected.data.operations[0].data.files[0]).toMatchObject({revision:'source-0',customContract:{keep:true},note:'author scope',references:[{path:'references/api.md'}]})
  expect(projected.data.operations[0].data).toMatchObject({diagnostics:['retain diagnostic'],readPaths:['exact/read'],refreshPaths:['exact/refresh']})
  const tool={callId:'apply',call:{name:'project.apply',input:{}},result:raw,state:'completed'} as unknown as ProgrammaticJournalEntry
  const final=JSON.stringify(projectCurrentToolResult(tool,[],'tool:run:apply'))
  for(let n=0;n<3;n++)expect(final).toContain('pages/'+n+'/program.content.html')
  expect(final).toContain('tool:run:apply')
  expect(final).toContain('complete')
  expect(new TextEncoder().encode(final).length).toBeLessThanOrEqual(24576)
})
it('does not reinterpret errors, arbitrary reads, failed operations or complete source files',()=>{
  const error={kind:'error',code:'conflict',message:'preserve'} as ToolResult
  expect(projectContentApplyNavigation(error,'s')).toBe(error)
  const arbitrary={kind:'read',data:{files:[{path:'user.json',type:'source',content:'keep'}]}} as ToolResult
  expect(projectContentApplyNavigation(arbitrary,'s')).toBe(arbitrary)
  const data={commit:'committed',insertedIds:[],operations:[error,{kind:'read',data:{commit:'failed',path:'bad'}}]} as any
  expect((projectContentApplyNavigation({kind:'read',data},'s') as any).data.targets).toEqual([])
  const source={kind:'read',data:{commit:'committed',insertedIds:[],files:[{path:'exact.view.js',type:'source',complete:true,content:'full',revision:7}]}} as ToolResult
  expect(projectContentApplyNavigation(source,'s')).toEqual(source)
})

