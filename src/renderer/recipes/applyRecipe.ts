import { nanoid } from 'nanoid'
import type { CourseProjectV10, ComponentInstance, JsonObject, JsonValue } from '../../shared/contracts/component-platform/project'
import type { ComponentLibraryEntry } from '../../shared/contracts/component-platform/library'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { prepareComponentLibraryInsertion } from '../../core/components/library'
import { applyComponentOperation, captureComponentOperation } from '../../core/drivers/courseV10Operations'
import { TEXT_DEFINITION } from '../../components/text/adapters'
import { createTextComponentData } from '../../components/text/data'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import { RECIPE_CATALOG, type RecipeInput } from './recipeCatalog'
import { createSortComponentPackage } from './sort-component/package'
export type RecipePlanResult = {ok:true;createdLocationId:string;edits:ComponentEdit[]} | {ok:false;kind:'invalid'|'split-pages'|'switch-layout';reason:string}
const lines=(value:string)=>value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean)
export function planRecipe(project:CourseProjectV10,input:RecipeInput,options:{idFactory?:()=>string;now?:string}={}):RecipePlanResult {
  try {
    if(project.id!==input.target.project.id)throw new Error('配方目标工程已改变。')
    const origin=project.surfaces.find(surface=>surface.id===input.target.surfaceId)
    if(!origin)throw new Error('配方的原页面已不存在。')
    const catalog=RECIPE_CATALOG.find(entry=>entry.id===input.recipeId)
    if(!catalog)throw new Error('未知配方。')
    const slots={...input.slots};for(const field of catalog.fields){if(typeof slots[field.key]!=='string')throw new Error(`缺少${field.label}。`);slots[field.key]=slots[field.key].trim()}
    if(!slots.title)throw new Error('请填写标题。')
    const accent=project.designTokens?.colors.find(token=>token.id===(input.accentTokenId??'accent'))?.color??'#2563eb'
    const id=(prefix:string)=>`${prefix}_${(options.idFactory??nanoid)()}`,surfaceId=id('surface'),instances:ComponentInstance[]=[]
    const size=origin.designSize??{width:1280,height:720},sx=size.width/1280,sy=size.height/720
    const text=(name:string,value:string,x:number,y:number,width:number,height:number,fontSize=28,colored=false)=>{
      const data=createTextComponentData(value);data.appearance={...data.appearance,fontSize:fontSize*Math.min(sx,sy),color:colored?accent:'#1f2937',bold:name==='标题'}
      instances.push({id:id('text'),definitionId:TEXT_DEFINITION.id,name,data:data as unknown as JsonValue,frame:{width:width*sx,height:height*sy,transform:[1,0,0,1,x*sx,y*sy]}})
    }
    text('标题',slots.title,72,46,1136,112,42,true)
    let interactive:JsonObject|undefined
    if(input.recipeId==='cover-v1'){text('副标题',slots.subtitle,80,218,620,132,32);text('署名',slots.author,80,558,620,60,24);text('视觉槽位',slots.visual,766,224,420,260,28,true)}
    else if(input.recipeId==='concept-v1'){text('解释',slots.explanation,72,190,660,210);text('例证',slots.example,72,440,660,190);text('视觉槽位',slots.visual,810,220,360,350,28,true)}
    else if(input.recipeId==='worked-example-v1'){const steps=lines(slots.steps);if(!steps.length)throw new Error('请至少填写一步。');text('步骤',steps.map((value,index)=>`${index+1}. ${value}`).join('\n'),96,176,1060,360);text('结论',slots.conclusion,96,560,1060,58,28,true);text('提示',slots.hint,96,628,1060,48,22)}
    else if(input.recipeId==='step-reveal-v1'){const steps=lines(slots.steps),initial=Number(slots.initialStep);if(!steps.length||!Number.isInteger(initial)||initial<0||initial>steps.length)throw new Error('请填写步骤及有效的初始步数。');interactive={mode:'reveal',steps,initialStep:initial,success:'',failure:''}}
    else if(input.recipeId==='choice-feedback-v1'){const choices=lines(slots.options),correct=Number(slots.correct);if(choices.length<2||!Number.isInteger(correct)||correct<1||correct>choices.length)throw new Error('至少两个选项并指定有效的正确序号。');interactive={mode:'choice',options:choices,correct:correct-1,success:slots.success,failure:slots.failure}}
    else {const items=lines(slots.items).map(line=>{const parts=line.split('|').map(value=>value.trim());return {id:parts[0],text:parts[1],group:parts[2]??''}});if(items.length<2||items.some(item=>!item.id||!item.text)||new Set(items.map(item=>item.id)).size!==items.length)throw new Error('至少两个项目，项目 ID 必须唯一且有文字。');const groups=lines(slots.groups),correctOrder=slots.correctOrder.split(',').map(value=>value.trim());if(slots.mode==='sort'){if(correctOrder.length!==items.length||new Set(correctOrder).size!==items.length||correctOrder.some(value=>!items.some(item=>item.id===value)))throw new Error('正确顺序必须恰好包含全部项目。')}else if(slots.mode!=='classify'||groups.length<2||items.some(item=>!groups.includes(item.group)))throw new Error('请填写至少两个分类组，每个项目归属一个组。');interactive={mode:slots.mode,items,groups,correctOrder,success:slots.success,failure:slots.failure}}
    const edits:ComponentEdit[]=[{type:'surface.insert',index:project.surfaces.indexOf(origin)+1,surface:{id:surfaceId,kind:'slide',title:slots.title,childIds:[],designSize:size,background:{mode:'own',color:'#ffffff'}}}]
    const afterSurface=applyComponentOperation(project,captureComponentOperation(project,edits))
    const textEntry:ComponentLibraryEntry={schemaVersion:1,id:`recipe:${input.recipeId}`,title:slots.title,definitions:{[TEXT_DEFINITION.id]:TEXT_DEFINITION},example:{instances:Object.fromEntries(instances.map(instance=>[instance.id,instance])),rootIds:instances.map(instance=>instance.id)},assets:{},resources:{assets:{},components:{}}}
    edits.push(...prepareComponentLibraryInsertion(afterSurface,textEntry,{container:{kind:'surface',surfaceId},index:0,createId:kind=>id(kind)}).command.edits)
    if(interactive){const working=applyComponentOperation(project,captureComponentOperation(project,edits)),entry=createSortComponentPackage(interactive),sample=entry.example.instances.example;sample.frame={width:1120*sx,height:480*sy,transform:[1,0,0,1,80*sx,180*sy]};edits.push(...prepareComponentLibraryInsertion(working,entry,{container:{kind:'surface',surfaceId},index:instances.length,createId:()=>id('recipe')}).command.edits)}
    return {ok:true,createdLocationId:surfaceId,edits}
  }catch(error){return {ok:false,kind:'invalid',reason:error instanceof Error?error.message:String(error)}}
}
export async function applyRecipe(kernel:EditorStoreKernel,input:RecipeInput):Promise<RecipePlanResult>{
  const result=planRecipe(input.target.project,input);if(!result.ok)return result
  try{await kernel.editCaptured(kernel.capture(result.edits,input.target));if(kernel.readView().activeDocumentId===input.target.documentId)kernel.selectSurface(result.createdLocationId,input.target.documentId);return result}catch(error){return {ok:false,kind:'invalid',reason:error instanceof Error?error.message:String(error)}}
}
