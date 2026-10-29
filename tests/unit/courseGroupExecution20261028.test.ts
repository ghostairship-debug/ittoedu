import { expect,it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createTextData } from '../../src/components/text'
import { prepareCourseGroup } from '../../src/core/course/courseGroupEdits'
import { frameCorners,composeMatrices,rotationMatrix,scaleMatrix,translationMatrix } from '../../src/core/components/geometry'
import { freeSurfaceTargets } from '../../src/renderer/componentPlatform/surfaces/slide/targets'
import { createV10StoreHost } from '../helpers/courseV10StoreHost'
function fixture(){
 let n=0;const p=createBlankCourseProjectV10('Groups',()=>['project','slide'][n++])
 p.definitions.group={id:'group',role:'content',implementation:{kind:'builtin',key:'guoling.group'}}
 p.definitions.text={id:'text',role:'content',implementation:{kind:'builtin',key:'guoling.text'}}
 p.instances.slide.childIds=['parent']
 p.instances.parent={id:'parent',definitionId:'group',data:{},childIds:['a','b'],frame:{width:700,height:400,transform:[...composeMatrices(translationMatrix(120,40),rotationMatrix(.42),scaleMatrix(1.7,.6))]}}
 for(const [i,id] of ['a','b'].entries())p.instances[id]={id,definitionId:'text',data:JSON.parse(JSON.stringify(createTextData(id))),frame:{width:140,height:50,transform:[...composeMatrices(translationMatrix(20+i*180,30+i*80),rotationMatrix(.3-i*.5))]}}
 return p
}
const corners=(p:ReturnType<typeof fixture>,id:string)=>{const target=freeSurfaceTargets(p,'slide').find(t=>t.instanceId===id)!;return frameCorners(target.frame,target.parentToSurface)}
it('group / ungroup use one formal transaction each and preserve complete affine corners, identities, history and file bytes',async()=>{
 const p=fixture(),h=await createV10StoreHost(p)
 try{
  const before=Object.fromEntries(['a','b'].map(id=>[id,corners(p,id)]))
  const grouped=prepareCourseGroup(p,['a','b'],'group',()=> 'new-group')
  await h.bridge.edit(grouped.edits)
  expect(h.first.read().undoDepth).toBe(1)
  expect(h.model().project.instances['new-group'].childIds).toEqual(['a','b'])
  const compare=()=>{for(const id of ['a','b']){const after=corners(h.model().project,id);after.forEach((point,i)=>{expect(point.x).toBeCloseTo(before[id][i].x,9);expect(point.y).toBeCloseTo(before[id][i].y,9)})}}
  compare()
  // A transformed outer group is deliberately ungrouped, producing a full shear-capable matrix.
  await h.bridge.edit(prepareCourseGroup(h.model().project,['parent'],'ungroup').edits)
  compare();expect(h.model().project.instances.parent).toBeUndefined()
  await h.bridge.undo();expect(h.model().project.instances.parent).toEqual(p.instances.parent ? {...p.instances.parent,childIds:['new-group']}:undefined)
  await h.bridge.redo();compare()
  await h.bridge.edit(prepareCourseGroup(h.model().project,['new-group'],'ungroup').edits)
  compare();expect(h.model().project.instances['new-group']).toBeUndefined()
  expect(h.model().project.instances.a.data).toEqual(p.instances.a.data)
  await h.api.save(h.first.documentId,'group.glx')
  const loaded=await h.driver.load(h.disk.get('group.glx')!)
  if(loaded.kind!=='course-v10')throw Error('wrong reopened model')
  expect(loaded.project.instances).toEqual(h.model().project.instances)
 }finally{h.bridge.dispose()}
})
it('common effects, external references and locked members are retained instead of being silently deleted',()=>{
 const p=fixture()
 p.instances.parent.style={opacity:.5}
 expect(()=>prepareCourseGroup(p,['parent'],'ungroup')).toThrow(/opacity/)
 p.instances.parent.style={};p.instances.a.locked=true
 expect(()=>prepareCourseGroup(p,['parent'],'ungroup')).toThrow(/锁定/)
 p.instances.a.locked=false;p.instances.b.data={...p.instances.b.data as object,chapterCopyIds:['parent']}
 expect(()=>prepareCourseGroup(p,['parent'],'ungroup')).toThrow(/引用/)
})
it('ungroup materializes inherited typography only where needed and leaves explicit child formatting intact',async()=>{
 const p=fixture();p.instances.parent.style={color:'#234','font-family':'serif','--accent':'#abc'};p.instances.a.style={color:'#567'}
 const h=await createV10StoreHost(p)
 try{await h.bridge.edit(prepareCourseGroup(p,['parent'],'ungroup').edits)
  expect(h.model().project.instances.a.style).toEqual({color:'#567','font-family':'serif','--accent':'#abc'})
  expect(h.model().project.instances.b.style).toMatchObject({color:'#234','font-family':'serif'})
 }finally{h.bridge.dispose()}
})

it('ungroup preserves shorthand paint and relative typography by declining only their unsupported cases',()=>{
 const p=fixture()
 p.instances.parent.style={background:'#fff'};const ungroup=prepareCourseGroup(p,['parent'],'ungroup');expect(ungroup.edits.some(edit=>edit.type==='instance.insert'&&edit.instances.some(instance=>instance.name==='组合背景'))).toBe(true)
 p.instances.parent.style={border:'1px solid #aaa'};expect(()=>prepareCourseGroup(p,['parent'],'ungroup')).toThrow(/border/)
 p.instances.parent.style={'font-size':'24px'};p.instances.a.style={'font-size':'0.8em'}
 expect(()=>prepareCourseGroup(p,['parent'],'ungroup')).toThrow(/相对排印/)
})
