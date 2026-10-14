import { nanoid } from 'nanoid'
import type { CourseProjectV10, ComponentInstance, JsonObject, JsonValue } from '../../shared/contracts/component-platform/project'
import type { ComponentLibraryEntry } from '../../shared/contracts/component-platform/library'
import type { ComponentEdit } from '../../shared/contracts/component-platform/operations'
import { prepareComponentLibraryInsertion } from '../components/library'
import { applyComponentOperation, captureComponentOperation, equalComponentValue } from '../drivers/courseV10Operations'
import { TEXT_DEFINITION } from '../../components/text/adapters'
import { createTextComponentData } from '../../components/text/data'
import { IMAGE_DEFINITION, createImageData } from '../../components/image'
import { teacherControllerReferenceSize } from '../../shared/teacherControllerViewportGeometry'
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
    { key: 'selectionMode', label: '选择方式（single 或 multiple）', value: 'single' },
    { key: 'options', label: '选项（每行一个）', value: '3\n8\n11' },
    { key: 'correct', label: '正确选项序号（从 1 开始，多选用逗号分隔）', value: '2' },
    { key: 'success', label: '正确反馈', value: '答对了！8 能被 2 整除。' },
    { key: 'failure', label: '错误反馈', value: '再想一想：偶数能被 2 整除。' },
  ] },
  { id: 'classify-sort-v1', version: 1, label: '拖拽匹配 / 分类 / 排序', fields: [
    { key: 'title', label: '标题', value: '把项目放进合适的组' },
    { key: 'mode', label: '模式（classify、match 或 sort）', value: 'classify' },
    { key: 'groups', label: '分类组（每行一个）', value: '动物\n植物' },
    { key: 'items', label: '项目（每行：文字 | 分类组名）', value: '小猫 | 动物\n大树 | 植物\n小鸟 | 动物' },
    { key: 'correctOrder', label: '排序正确顺序（项目文字；序号可写“序号：3,1,2”）', value: '大树,小猫,小鸟' },
    { key: 'success', label: '正确反馈', value: '全部正确！' },
    { key: 'failure', label: '错误反馈', value: '还需要调整，再试一次。' },
  ] },
  { id: 'continuous-variable-v1', version: 1, label: '连续变量联动', fields: [
    { key: 'title', label: '标题', value: '改变长度，观察面积' },
    { key: 'variableLabel', label: '变量名称', value: '长度' },
    { key: 'resultLabel', label: '结果名称', value: '面积' },
    { key: 'unit', label: '变量单位', value: 'cm' },
    { key: 'resultUnit', label: '结果单位', value: 'cm²' },
    { key: 'min', label: '最小值', value: '1' },
    { key: 'max', label: '最大值', value: '8' },
    { key: 'step', label: '调整步长', value: '0.5' },
    { key: 'value', label: '初始值', value: '4' },
    { key: 'multiplier', label: '固定倍数（结果 = 变量 × 倍数）', value: '3' },
    { key: 'stateKey', label: '共享状态名称（留空为本组件独立值）', value: '' },
  ] },
  { id: 'static-background-v1', version: 1, label: '渐变 / 纹理背景', fields: [
    { key: 'title', label: '背景名称', value: '柔和渐变' },
    { key: 'colorStart', label: '起始颜色', value: '#dbeafe' },
    { key: 'colorEnd', label: '结束颜色', value: '#f8fafc' },
    { key: 'pattern', label: '纹理（gradient、grid 或 dots）', value: 'gradient' },
    { key: 'intensity', label: '纹理强度（0—1）', value: '0.3' },
    { key: 'assetId', label: '替换背景图片（已有素材名称，留空保留图形）', value: '' },
    { key: 'scope', label: '适用范围（current、all、include 或 exclude）', value: 'current' },
    { key: 'pages', label: '包括 / 排除的页面标题（每行一个）', value: '' },
  ] },
  { id: 'dynamic-background-v1', version: 1, label: '轻量动态背景', fields: [
    { key: 'title', label: '背景名称', value: '流动光色' },
    { key: 'colorStart', label: '起始颜色', value: '#dbeafe' },
    { key: 'colorEnd', label: '结束颜色', value: '#ede9fe' },
    { key: 'pattern', label: '纹理（gradient、grid 或 dots）', value: 'gradient' },
    { key: 'intensity', label: '运动强度（0—1）', value: '0.3' },
    { key: 'stateKey', label: '联动共享状态名称（0—1，留空不联动）', value: '' },
    { key: 'eventName', label: '联动事件名称（留空不订阅）', value: '' },
    { key: 'scope', label: '适用范围（current、all、include 或 exclude）', value: 'current' },
    { key: 'pages', label: '包括 / 排除的页面标题（每行一个）', value: '' },
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
  const title=data.mode==='sort'?'拖拽排序':data.mode==='classify'?'拖拽分类':data.mode==='match'?'拖拽匹配':data.mode==='choice'?'选择与反馈':data.mode==='variable'?'连续变量联动':data.mode==='background'?'图形与动态背景':'逐步揭示'
  return {schemaVersion:1,id,title,
    definitions:{[id]:{id,role:'content',version:'1.0.0',title:'可编辑互动与背景',implementation:{kind:'source',language:'javascript',source:runtimeSource},dataSchema:{type:'object',properties:{mode:{title:'机制类型',type:'string'},items:{title:'项目',type:'array'},steps:{title:'步骤',type:'array'},options:{title:'选项',type:'array'},selectionMode:{title:'单选 / 多选',type:'string',enum:['single','multiple']},correct:{title:'单选正确序号（从 0 开始）',type:'number'},correctIndices:{title:'多选正确序号（从 0 开始）',type:'array',items:{type:'number'}},initialStep:{title:'初始显示步数',type:'number'},correctOrder:{title:'正确顺序',type:'array'},groups:{title:'分类 / 匹配目标',type:'array'},success:{title:'正确反馈',type:'string'},failure:{title:'错误反馈',type:'string'},variableLabel:{title:'变量名称',type:'string'},resultLabel:{title:'结果名称',type:'string'},unit:{title:'变量单位',type:'string'},resultUnit:{title:'结果单位',type:'string'},min:{title:'最小值',type:'number'},max:{title:'最大值',type:'number'},step:{title:'调整步长',type:'number'},value:{title:'初始值',type:'number'},multiplier:{title:'固定倍数',type:'number'},stateKey:{title:'共享状态名称',type:'string'},eventName:{title:'联动事件名称',type:'string'},dynamic:{title:'动态背景',type:'boolean'},colorStart:{title:'起始颜色',type:'string'},colorEnd:{title:'结束颜色',type:'string'},pattern:{title:'纹理',type:'string',enum:['gradient','grid','dots']},intensity:{title:'背景强度',type:'number',minimum:0,maximum:1}}}}},
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
    const slots={...input.slots};if(input.recipeId==='classify-sort-v1'){slots.groups??='';slots.correctOrder??=''};if(input.recipeId==='choice-feedback-v1')slots.selectionMode??='single';for(const field of catalog.fields){if(typeof slots[field.key]!=='string')throw new Error(`缺少${field.label}。`);slots[field.key]=slots[field.key].trim()}
    if(!slots.title)throw new Error('请填写标题。')
    const accent=project.designTokens?.colors.find(token=>token.id===(input.accentTokenId??'accent'))?.color??'#2563eb'
    const id=(prefix:string)=>`${prefix}_${(options.createId??nanoid)()}`,surfaceId=id('surface'),instances:ComponentInstance[]=[]
    const size=origin.designSize??{width:1280,height:720},sx=size.width/1280,sy=size.height/720
    const text=(name:string,value:string,x:number,y:number,width:number,height:number,fontSize=28,colored=false)=>{
      const data=createTextComponentData(value);data.appearance={...data.appearance,fontSize:fontSize*Math.min(sx,sy),color:colored?accent:'#1f2937',bold:name==='标题'}
      instances.push({id:id('text'),definitionId:TEXT_DEFINITION.id,name,data:data as unknown as JsonValue,frame:{width:width*sx,height:height*sy,transform:[1,0,0,1,x*sx,y*sy]}})
    }
    if(input.recipeId==='static-background-v1'||input.recipeId==='dynamic-background-v1'){
      const intensity=Number(slots.intensity)
      if(!Number.isFinite(intensity)||intensity<0||intensity>1)throw new Error('背景强度应在 0—1 之间。')
      if(!['gradient','grid','dots'].includes(slots.pattern))throw new Error('请选择渐变、网格或点状纹理。')
      const scope=slots.scope
      if(!['current','all','include','exclude'].includes(scope))throw new Error('请选择有效的背景适用范围。')
      const surfaceIds=scope==='current'?[origin.id]:lines(slots.pages).map(title=>{
        const identity=project.surfaces.find(surface=>surface.id===title)
        const matches=identity?[identity]:project.surfaces.filter(surface=>surface.title===title)
        if(matches.length!==1)throw new Error(`页面标题“${title}”${matches.length?'重复，请先明确页面名称':'不存在'}。`)
        return matches[0].id
      })
      if((scope==='include'||scope==='exclude')&&!surfaceIds.length)throw new Error('请指定包括或排除的页面。')
      const imageName=slots.assetId??'',matches=imageName?Object.values(project.assets).filter(asset=>asset.id===imageName||asset.filename===imageName):[]
      if(imageName&&matches.length!==1)throw new Error('请指定已有背景图片的唯一素材名称。')
      const entry=createSortComponentPackage({mode:'background',dynamic:input.recipeId==='dynamic-background-v1',colorStart:slots.colorStart,colorEnd:slots.colorEnd,pattern:slots.pattern,intensity,stateKey:slots.stateKey??'',eventName:slots.eventName??''})
      const backgroundSize=teacherControllerReferenceSize(project)
      const sample=entry.example.instances.example
      sample.name=slots.title;sample.frame={...backgroundSize,transform:[1,0,0,1,0,0]};sample.viewportPinned=true
      sample.childIds=[]
      sample.style={pointerEvents:'none'};sample.visibility={mode:scope==='current'?'include':scope as 'all'|'include'|'exclude',surfaceIds:scope==='all'?[]:[...new Set(surfaceIds)]}
      const insertion=prepareComponentLibraryInsertion(project,entry,{container:{kind:'global',plane:'underlay'},index:project.global.underlay.length,surfaceBindings:Object.fromEntries(surfaceIds.map(surfaceId=>[surfaceId,surfaceId])),createId:()=>id('background')})
      if(imageName){
        const existing=project.definitions[IMAGE_DEFINITION.id]
        const definitionId=!existing||equalComponentValue(existing,IMAGE_DEFINITION)?IMAGE_DEFINITION.id:id('background-image-definition')
        if(!existing||definitionId!==IMAGE_DEFINITION.id)insertion.command.edits.push({type:'definition.set',definition:{...IMAGE_DEFINITION,id:definitionId}})
        const image=createImageData(matches[0].id,slots.title);image.fit='cover'
        const imageId=id('background-image')
        insertion.command.edits.push({type:'instance.insert',container:{kind:'instance',instanceId:insertion.rootIds[0]},index:0,rootIds:[imageId],instances:[{id:imageId,definitionId,name:'背景图片',data:image as unknown as JsonValue,style:{pointerEvents:'none'},frame:{...backgroundSize,transform:[1,0,0,1,0,0]}}]})
      }
      return {ok:true,createdLocationId:origin.id,edits:insertion.command.edits}
    }
    text('标题',slots.title,72,46,1136,112,42,true)
    let interactive:JsonObject|undefined
    if(input.recipeId==='cover-v1'){text('副标题',slots.subtitle,80,218,620,132,32);text('署名',slots.author,80,558,620,60,24);text('视觉槽位',slots.visual,766,224,420,260,28,true)}
    else if(input.recipeId==='concept-v1'){text('解释',slots.explanation,72,190,660,210);text('例证',slots.example,72,440,660,190);text('视觉槽位',slots.visual,810,220,360,350,28,true)}
    else if(input.recipeId==='worked-example-v1'){const steps=lines(slots.steps);if(!steps.length)throw new Error('请至少填写一步。');text('步骤',steps.map((value,index)=>`${index+1}. ${value}`).join('\n'),96,176,1060,360);text('结论',slots.conclusion,96,560,1060,58,28,true);text('提示',slots.hint,96,628,1060,48,22)}
    else if(input.recipeId==='step-reveal-v1'){const steps=lines(slots.steps),initial=Number(slots.initialStep);if(!steps.length||!Number.isInteger(initial)||initial<0||initial>steps.length)throw new Error('请填写步骤及有效的初始步数。');interactive={mode:'reveal',steps,initialStep:initial,success:'',failure:''}}
    else if(input.recipeId==='choice-feedback-v1'){
      const choices=lines(slots.options),selectionMode=slots.selectionMode??'single',correct=slots.correct.split(/[,，\s]+/).filter(Boolean).map(Number)
      if(choices.length<2||!['single','multiple'].includes(selectionMode)||!correct.length||new Set(correct).size!==correct.length||correct.some(index=>!Number.isInteger(index)||index<1||index>choices.length)||selectionMode==='single'&&correct.length!==1)throw new Error('至少两个选项；单选指定一个正确序号，多选指定不重复的正确序号。')
      interactive={mode:'choice',selectionMode,options:choices,correct:correct[0]-1,correctIndices:correct.map(index=>index-1),success:slots.success,failure:slots.failure}
    }
    else if(input.recipeId==='continuous-variable-v1'){
      const min=Number(slots.min),max=Number(slots.max),step=Number(slots.step),value=Number(slots.value),multiplier=Number(slots.multiplier)
      if(![min,max,step,value,multiplier].every(Number.isFinite)||min>=max||step<=0||value<min||value>max)throw new Error('请填写有限的范围、正步长以及范围内初始值。')
      interactive={mode:'variable',min,max,step,value,multiplier,variableLabel:slots.variableLabel,resultLabel:slots.resultLabel,unit:slots.unit,resultUnit:slots.resultUnit,stateKey:slots.stateKey}
    }
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
      } else if (!['classify','match'].includes(slots.mode) || groups.length < 2 || items.some(item => !groups.includes(item.group))) throw new Error('请填写至少两个目标组，每个项目归属一个组。')
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

