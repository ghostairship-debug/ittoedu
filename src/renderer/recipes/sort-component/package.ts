import type { ComponentLibraryEntry } from '../../../shared/contracts/component-platform/library'
import type { JsonObject } from '../../../shared/contracts/component-platform/project'
import runtimeSource from './runtimeSource'
export const SORT_COMPONENT_ID = 'com.ittoedu.teaching.sort-order'
/** A normal L24 source definition and author-editable example, with no disk package prerequisite. */
export function createSortComponentPackage(data: JsonObject = { mode:'sort', items:[{id:'a',text:'第一步'},{id:'b',text:'第二步'},{id:'c',text:'第三步'}], correctOrder:['a','b','c'],success:'全部正确！',failure:'还需要调整，再试一次。' }): ComponentLibraryEntry {
  const id = data.mode === 'sort' ? SORT_COMPONENT_ID : `com.ittoedu.teaching.${data.mode}`
  return {schemaVersion:1,id,title:data.mode==='sort'?'教学排序':data.mode==='classify'?'教学分类':data.mode==='choice'?'选择与反馈':'逐步揭示',
    definitions:{[id]:{id,role:'content',version:'1.0.0',title:'教学互动',implementation:{kind:'source',language:'javascript',source:runtimeSource},dataSchema:{type:'object',properties:{mode:{title:'互动类型',type:'string'},items:{title:'项目',type:'array'},steps:{title:'步骤',type:'array'},options:{title:'选项',type:'array'},correct:{title:'正确选项（从 0 开始）',type:'number'},initialStep:{title:'初始显示步数',type:'number'},correctOrder:{title:'正确顺序',type:'array'},groups:{title:'分类组',type:'array'},success:{title:'正确反馈',type:'string'},failure:{title:'错误反馈',type:'string'}}}}},
    example:{rootIds:['example'],instances:{example:{id:'example',definitionId:id,name:'教学互动',data,frame:{width:1120,height:480,transform:[1,0,0,1,80,180]}}}},assets:{},resources:{assets:{},components:{}}}
}
