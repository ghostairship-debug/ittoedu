import {Plugin,PluginKey,type EditorState} from 'prosemirror-state'
import {Decoration,DecorationSet,type EditorView} from 'prosemirror-view'
export interface FlowObjectDropPreview {sourceId:string;targetId:string;side:'before'|'after'|'inside';wrap:'none'|'left'|'right';widthPercent:number;height:number}
const key=new PluginKey<{value:FlowObjectDropPreview|null;decorations:DecorationSet}>('flow-object-drop-preview')
function decorations(state:EditorState,value:FlowObjectDropPreview|null):DecorationSet {
 if(!value)return DecorationSet.empty
 let source:{pos:number;size:number}|undefined,target:{pos:number;size:number}|undefined
 state.doc.descendants((node,pos)=>{if(node.attrs.id===value.sourceId)source={pos,size:node.nodeSize};if(node.attrs.id===value.targetId)target={pos,size:node.nodeSize}})
 if(!source||!target||source.pos===target.pos)return DecorationSet.empty
 const position=value.side==='inside'?target.pos+1:value.side==='after'?target.pos+target.size:target.pos
 const preview=Decoration.widget(position,view=>{
  const ghost=view.dom.ownerDocument.createElement('div');ghost.dataset.flowLayoutPreview='';ghost.contentEditable='false';ghost.setAttribute('aria-hidden','true')
  ghost.textContent=value.wrap==='none'?'放在正文中':value.wrap==='left'?'居左，文字绕排':'居右，文字绕排'
  Object.assign(ghost.style,{boxSizing:'border-box',pointerEvents:'none',width:value.widthPercent+'%',height:Math.max(32,value.height)+'px',float:value.wrap,margin:value.wrap==='left'?'8px 20px 8px 0':value.wrap==='right'?'8px 0 8px 20px':'16px auto',border:'2px dashed #2563eb',background:'#eff6ff',color:'#1d4ed8',padding:'10px',font:'14px sans-serif',overflow:'hidden'})
  return ghost
 },{side:-1,key:JSON.stringify(value),ignoreSelection:true})
 return DecorationSet.create(state.doc,[Decoration.node(source.pos,source.pos+source.size,{style:'display:none', 'data-flow-preview-source':''}),preview])
}
export function flowObjectDropPreviewPlugin():Plugin {
 return new Plugin<{value:FlowObjectDropPreview|null;decorations:DecorationSet}>({key,state:{init:()=>({value:null,decorations:DecorationSet.empty}),apply(transaction,previous,_old,state){
  const meta=transaction.getMeta(key)
  const value=meta!==undefined?meta as FlowObjectDropPreview|null:transaction.docChanged?null:previous.value
  return meta!==undefined||transaction.docChanged?{value,decorations:decorations(state,value)}:previous
 }},props:{decorations:state=>key.getState(state)?.decorations??DecorationSet.empty}})
}
export function showFlowObjectDropPreview(view:EditorView,value:FlowObjectDropPreview|null):void {
 if(JSON.stringify(key.getState(view.state)?.value)===JSON.stringify(value))return
 view.dispatch(view.state.tr.setMeta(key,value).setMeta('addToHistory',false))
}
