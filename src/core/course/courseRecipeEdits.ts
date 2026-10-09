import { nanoid } from 'nanoid'
import type { CourseProjectV10, ComponentInstance, JsonObject, JsonValue } from '../../shared/contracts/component-platform/project'
import type { ComponentLibraryEntry } from '../../shared/contracts/component-platform/library'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { prepareComponentLibraryInsertion } from '../components/library'
import { applyComponentOperation, captureComponentOperation } from '../drivers/courseV10Operations'
import { TEXT_DEFINITION } from '../../components/text/adapters'
import { createTextComponentData } from '../../components/text/data'
import runtimeSource from './courseRecipeRuntimeSource'

/** The sole product catalog. UI, Builder and generated capabilities project this value. */
export const RECIPE_CATALOG = [
  { id: 'cover-v1', version: 1, label: '封面', fields: [
    { key: 'title', label: '标题', value: '一起探索新知识' },
    { key: 'subtitle', label: '副标题', value: '观察 · 思考 · 表达' },
    { key: 'author', label: '署名', value: '教师 / 班级' },
    { key: 'visual', label: '视觉槽位说明', value: '在这里放入主题图片' },
  ] },
  { id: 'concept-v1', version: 1, label: '概念讲解', fields: [
    { key: 'title', label: '概念', value: '什么是分数？' },
    { key: 'explanation', label: '解释', value: '把一个整体平均分成若干份，表示其中一份或几份的数叫作分数。' },
    { key: 'example', label: '例证', value: '把一个苹果平均分成四份，其中一份就是四分之一。' },
    { key: 'visual', label: '视觉槽位说明', value: '放入四等分示意图' },
  ] },
  { id: 'worked-example-v1', version: 1, label: '分步例题', fields: [
    { key: 'title', label: '题干', value: '怎样计算 24 × 15？' },
    { key: 'steps', label: '步骤（每行一步）', value: '把 15 拆成 10 + 5\n分别计算 24 × 10 和 24 × 5\n把 240 和 120 相加' },
    { key: 'conclusion', label: '结论', value: '24 × 15 = 360' },
    { key: 'hint', label: '提示', value: '运用乘法分配律，把复杂计算变简单。' },
  ] },
  { id: 'step-reveal-v1', version: 1, label: '逐步揭示', fields: [
    { key: 'title', label: '标题', value: '观察一粒种子的生长' },
    { key: 'steps', label: '步骤（每行一步）', value: '种子吸收水分\n胚根首先突破种皮\n胚芽生长，形成幼苗' },
    { key: 'initialStep', label: '初始显示步数', value: '0' },
  ] },
  { id: 'choice-feedback-v1', version: 1, label: '选择与反馈', fields: [
    { key: 'title', label: '题干', value: '下面哪个数是偶数？' },
    { key: 'options', label: '选项（每行一个）', value: '3\n8\n11' },
    { key: 'correct', label: '正确选项序号（从 1 开始）', value: '2' },
    { key: 'success', label: '正确反馈', value: '答对了！8 能被 2 整除。' },
    { key: 'failure', label: '错误反馈', value: '再想一想：偶数能被 2 整除。' },
  ] },
  { id: 'classify-sort-v1', version: 1, label: '分类 / 排序', fields: [
    { key: 'title', label: '标题', value: '把项目放进合适的组' },
    { key: 'mode', label: '模式（classify 或 sort）', value: 'classify' },
    { key: 'groups', label: '分类组（每行一个）', value: '动物\n植物' },
    { key: 'items', label: '项目（每行：文字 | 分类组名）', value: '小猫 | 动物\n大树 | 植物\n小鸟 | 动物' },
    { key: 'correctOrder', label: '排序正确顺序（项目文字；序号可写“序号：3,1,2”）', value: '大树,小猫,小鸟' },
    { key: 'success', label: '正确反馈', value: '全部正确！' },
    { key: 'failure', label: '错误反馈', value: '还需要调整，再试一次。' },
  ] },
] as const

export type RecipeId = typeof RECIPE_CATALOG[number]['id']
export interface CourseRecipeIntent {
  readonly recipeId: RecipeId
  readonly surfaceId: string | null
  readonly slots: Readonly<Record<string, string>>
  readonly accentTokenId?: string
}
export function recipeDefaults(id: RecipeId): Record<string, string> {
  return Object.fromEntries(RECIPE_CATALOG.find(entry => entry.id === id)!.fields.map(field => [field.key, field.value]))
}

export const SORT_COMPONENT_ID = 'com.ittoedu.teaching.sort-order'
/** A normal L24 source definition and author-editable example, with no disk package prerequisite. */
export function createSortComponentPackage(data: JsonObject = { mode:'sort', items:[{id:'a',text:'第一步'},{id:'b',text:'第二步'},{id:'c',text:'第三步'}], correctOrder:['a','b','c'],success:'全部正确！',failure:'还需要调整，再试一次。' }): ComponentLibraryEntry {
  const id = data.mode === 'sort' ? SORT_COMPONENT_ID : `com.ittoedu.teaching.${data.mode}`
  return {schemaVersion:1,id,title:data.mode==='sort'?'教学排序':data.mode==='classify'?'教学分类':data.mode==='choice'?'选择与反馈':'逐步揭示',
    definitions:{[id]:{id,role:'content',version:'1.0.0',title:'教学互动',implementation:{kind:'source',language:'javascript',source:runtimeSource},dataSchema:{type:'object',properties:{mode:{title:'互动类型',type:'string'},items:{title:'项目',type:'array'},steps:{title:'步骤',type:'array'},options:{title:'选项',type:'array'},correct:{title:'正确选项（从 0 开始）',type:'number'},initialStep:{title:'初始显示步数',type:'number'},correctOrder:{title:'正确顺序',type:'array'},groups:{title:'分类组',type:'array'},success:{title:'正确反馈',type:'string'},failure:{title:'错误反馈',type:'string'}}}}},
    example:{rootIds:['example'],instances:{example:{id:'example',definitionId:id,name:'教学互动',data,frame:{width:1120,height:480,transform:[1,0,0,1,80,180]}}}},assets:{},resources:{assets:{},components:{}}}
}

export type RecipePlanResult = {ok:true;createdLocationId:string;edits:ComponentEdit[]} | {ok:false;kind:'invalid'|'split-pages'|'switch-layout';reason:string}
const lines=(value:string)=>value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean)
export function planCourseRecipeEdits(project:CourseProjectV10,input:CourseRecipeIntent,options:{createId?:()=>string}={}):RecipePlanResult {
  try {
    const origin=project.surfaces.find(surface=>surface.id===input.surfaceId)
    if(!origin)throw new Error('配方的原页面已不存在。')
    const catalog=RECIPE_CATALOG.find(entry=>entry.id===input.recipeId)
    if(!catalog)throw new Error('未知配方。')
    const slots={...input.slots};if(input.recipeId==='classify-sort-v1'){slots.groups??='';slots.correctOrder??=''};for(const field of catalog.fields){if(typeof slots[field.key]!=='string')throw new Error(`缺少${field.label}。`);slots[field.key]=slots[field.key].trim()}
    if(!slots.title)throw new Error('请填写标题。')
    const accent=project.designTokens?.colors.find(token=>token.id===(input.accentTokenId??'accent'))?.color??'#2563eb'
    const id=(prefix:string)=>`${prefix}_${(options.createId??nanoid)()}`,surfaceId=id('surface'),instances:ComponentInstance[]=[]
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
    else {
      const items = lines(slots.items).map(line => {
        const parts = line.split('|').map(value => value.trim())
        if (parts.length > 2) throw new Error('项目只需填写文字及分类组名，不填写内部 ID。')
        return { id: id('item'), text: parts[0], group: parts[1] ?? '' }
      })
      if (items.length < 2 || items.some(item => !item.text)) throw new Error('请至少填写两个项目的文字。')
      const groups = lines(slots.groups)
      let correctOrder: string[] = []
      if (slots.mode === 'sort') {
        const explicitOrdinal = /^序号\s*[:：]/.test(slots.correctOrder)
        const order = slots.correctOrder.replace(/^序号\s*[:：]/, '').split(/\r?\n|[,，]/).map(value => value.trim()).filter(Boolean)
        if (!order.length && !explicitOrdinal) correctOrder = items.map(item => item.id)
        else {
          const matches = order.map(value => items.filter(item => item.text === value))
          const textOrder = matches.every(values => values.length === 1) ? matches.map(values => values[0].id) : []
          const completeTextOrder = textOrder.length === items.length && new Set(textOrder).size === items.length
          if (!explicitOrdinal && completeTextOrder) correctOrder = textOrder
          else if ((explicitOrdinal || matches.every(values => !values.length)) && order.every(value => /^[1-9]\d*$/.test(value))) {
            correctOrder = order.map(value => items[Number(value) - 1]?.id ?? '')
          } else throw new Error('正确顺序请完整填写项目文字；使用序号时请写“序号：3,1,2”，以免与数字文字混淆。')
          if (correctOrder.length !== items.length || new Set(correctOrder).size !== items.length || correctOrder.some(value => !value)) throw new Error('正确顺序必须恰好包含全部项目。')
        }
      } else if (slots.mode !== 'classify' || groups.length < 2 || items.some(item => !groups.includes(item.group))) throw new Error('请填写至少两个分类组，每个项目归属一个组。')
      interactive = { mode: slots.mode, items, groups, correctOrder, success: slots.success, failure: slots.failure }
    }
    const edits:ComponentEdit[]=[{type:'surface.insert',index:project.surfaces.indexOf(origin)+1,surface:{id:surfaceId,kind:'slide',title:slots.title,childIds:[],designSize:size,background:{mode:'own',color:'#ffffff'}}}]
    const afterSurface=applyComponentOperation(project,captureComponentOperation(project,edits))
    const textEntry:ComponentLibraryEntry={schemaVersion:1,id:`recipe:${input.recipeId}`,title:slots.title,definitions:{[TEXT_DEFINITION.id]:TEXT_DEFINITION},example:{instances:Object.fromEntries(instances.map(instance=>[instance.id,instance])),rootIds:instances.map(instance=>instance.id)},assets:{},resources:{assets:{},components:{}}}
    edits.push(...prepareComponentLibraryInsertion(afterSurface,textEntry,{container:{kind:'surface',surfaceId},index:0,createId:kind=>id(kind)}).command.edits)
    if(interactive){const working=applyComponentOperation(project,captureComponentOperation(project,edits)),entry=createSortComponentPackage(interactive),sample=entry.example.instances.example;sample.frame={width:1120*sx,height:480*sy,transform:[1,0,0,1,80*sx,180*sy]};edits.push(...prepareComponentLibraryInsertion(working,entry,{container:{kind:'surface',surfaceId},index:instances.length,createId:()=>id('recipe')}).command.edits)}
    return {ok:true,createdLocationId:surfaceId,edits}
  }catch(error){return {ok:false,kind:'invalid',reason:error instanceof Error?error.message:String(error)}}
}
