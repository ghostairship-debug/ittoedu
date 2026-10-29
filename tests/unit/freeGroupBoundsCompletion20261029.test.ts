import {expect,it} from 'vitest'
import {createBlankCourseProjectV10} from '../../src/core/course/createCourseProjectV10'
import {createTextData} from '../../src/components/text'
import {createV10StoreHost} from '../helpers/courseV10StoreHost'
import {frameCorners,composeMatrices,rotationMatrix,scaleMatrix,translationMatrix} from '../../src/core/components/geometry'
import {freeSurfaceTargets} from '../../src/renderer/componentPlatform/surfaces/slide/targets'
import {captureComponentOperation,applyComponentOperation} from '../../src/core/drivers/courseV10Operations'
import {prepareCourseGroup} from '../../src/core/course/courseGroupEdits'
function fixture(){let n=0;const p=createBlankCourseProjectV10('Bounds',()=>['project','slide'][n++]);p.definitions.group={id:'group',role:'content',implementation:{kind:'builtin',key:'guoling.group'}};p.definitions.text={id:'text',role:'content',implementation:{kind:'builtin',key:'guoling.text'}};p.instances.slide.childIds=['group'];p.instances.group={id:'group',definitionId:'group',data:{},childIds:['a','b'],frame:{width:300,height:200,transform:[...composeMatrices(translationMatrix(400,200),rotationMatrix(.4),scaleMatrix(1.7,.6))]}};for(const [i,id]of ['a','b'].entries())p.instances[id]={id,definitionId:'text',data:JSON.parse(JSON.stringify(createTextData(id))),frame:{width:80,height:40,transform:[1,0,0,1,20+i*120,30]}};return p}
const corners=(p:ReturnType<typeof fixture>,id:string)=>{const t=freeSurfaceTargets(p,'slide').find(t=>t.instanceId===id)!;return frameCorners(t.frame,t.parentToSurface)}
const sameCorners=(a:readonly {x:number;y:number}[],b:readonly {x:number;y:number}[])=>a.forEach((p,i)=>{expect(p.x).toBeCloseTo(b[i].x,8);expect(p.y).toBeCloseTo(b[i].y,8)})
it('negative/outside member motion expands its transformed group and compensates even a locked sibling without changing visual coordinates',async()=>{
 const p=fixture();p.instances.b.locked=true;const h=await createV10StoreHost(p)
 try{
  const beforeB=corners(p,'b'),desired={...p.instances.a.frame!,transform:[1,0,0,1,-95,-60] as [number,number,number,number,number,number]},expected=structuredClone(p);expected.instances.a.frame=desired
  await h.bridge.edit([{type:'frame.set',instanceId:'a',frame:desired}])
  const changed=h.model().project;sameCorners(corners(changed,'b'),beforeB);sameCorners(corners(changed,'a'),corners(expected,'a'))
  expect(changed.instances.group.frame!.width).toBe(395);expect(changed.instances.group.frame!.height).toBe(260)
  expect(changed.instances.b.data).toEqual(p.instances.b.data);expect(changed.instances.b.locked).toBe(true)
  expect(h.first.read().undoDepth).toBe(1);await h.bridge.undo();expect(h.model().project.instances).toEqual(p.instances)
  await h.bridge.redo();await h.api.save(h.first.documentId,'bounds.glx');const reopened=await h.driver.load(h.disk.get('bounds.glx')!);expect(reopened).toMatchObject({project:{instances:changed.instances}})
 }finally{h.bridge.dispose()}
})
it('outside motion preserves painted group background as an editable shape, without stretching the original painted region',async()=>{
 const p=fixture();p.instances.group.style={background:'#f4d7b1','border-radius':'12px'};const h=await createV10StoreHost(p)
 try{
  const oldBackground=corners(p,'group');await h.bridge.edit([{type:'frame.set',instanceId:'a',frame:{...p.instances.a.frame!,transform:[1,0,0,1,-80,-40]}}])
  const changed=h.model().project,background=Object.values(changed.instances).find(i=>!p.instances[i.id])!
  expect(background.name).toBe('组合背景');expect(background.style).toMatchObject({background:'#f4d7b1','border-radius':'12px'});sameCorners(corners(changed,background.id),oldBackground)
  expect(changed.instances.group.style).not.toHaveProperty('background');expect(changed.instances.group.childIds?.[0]).toBe(background.id)
  await h.bridge.edit(prepareCourseGroup(changed,['group'],'ungroup').edits);sameCorners(corners(h.model().project,background.id),oldBackground)
 }finally{h.bridge.dispose()}
})
it('a malicious same-size frame on a locked member cannot use coordinate compensation to move it',()=>{
 const p=fixture();p.instances.b.locked=true
 const command=captureComponentOperation(p,[{type:'frame.set',instanceId:'b',frame:{...p.instances.b.frame!,transform:[1,0,0,1,141,30]}}])
 expect(()=>applyComponentOperation(p,command,{assets:{},components:{}})).toThrow(/锁定/)
})
it('state-specific, composite and old persistent layout owners are not silently normalized',()=>{
 for(const style of [{overflow:'hidden'},{display:'flex'}]){const p=fixture();p.instances.group.style=JSON.parse(JSON.stringify(style))
 const command=captureComponentOperation(p,[{type:'frame.set',instanceId:'a',frame:{...p.instances.a.frame!,transform:[1,0,0,1,-60,-40]}}])
 expect(command.edits).toHaveLength(1)
 }
})
