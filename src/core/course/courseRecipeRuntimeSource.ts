/** Shared behavior; ordinary data and the existing Runtime scope own configuration and transient state. */
export default String.raw`
export default {
  mount({root,instance,scope,interactions}) {
    if (!root) throw new Error('互动需要内容根元素')
    const doc=root.ownerDocument
    let data=instance.data, disposed=false, order=[], assignments={}, selected='', chosen=new Set(), progress=0, feedback='', value=0, dragId='', pointer=null, playing=true, background=null, variableView=null, bindings=[]
    const make=(tag,text)=>{const element=doc.createElement(tag);if(text!==undefined)element.textContent=String(text);return element}
    const active=()=>!disposed&&scope.isActive(),progressKey='component:'+instance.id+':progress'
    const variableKey=()=>data.stateKey||'component:'+instance.id+':value',clamp=(n,min=0,max=1)=>Math.max(min,Math.min(max,n)),precision=n=>Number(Number(n).toFixed(8))
    function reset(resetVariable=true){order=(data.items||[]).map(item=>item.id);assignments={};selected='';chosen=new Set();progress=Number(data.initialStep||0);feedback='';scope.state.set(progressKey,progress);if(data.mode==='variable'){const retained=resetVariable?undefined:scope.state.get(variableKey());value=clamp(typeof retained==='number'&&Number.isFinite(retained)?retained:Number(data.value??data.min??0),Number(data.min),Number(data.max));scope.state.set(variableKey(),value)}}
    function button(text,action,focusId,direction){const element=make('button',text);element.type='button';element.addEventListener('click',()=>{if(active()){action();render(focusId,direction)}});return element}
    function answer(correct){feedback=correct?data.success:data.failure;scope.state.set(progressKey,correct?1:0);scope.events.emit('answer',{correct,progress:correct?1:0})}
    function applyDrop(itemId,target){
      if(!active()||!(data.items||[]).some(item=>item.id===itemId))return
      if(data.mode==='sort'){
        const from=order.indexOf(itemId),to=target==='__end'?order.length:order.indexOf(target)
        if(from<0||to<0||itemId===target)return
        order.splice(from,1);order.splice(target==='__end'?order.length:order.indexOf(target),0,itemId)
        feedback='已调整顺序';scope.events.emit('interaction.change',{mode:'sort',order:[...order]})
      }else{
        if(!(data.groups||[]).includes(target))return
        assignments[itemId]=target;selected='';feedback='已匹配：'+(data.items.find(item=>item.id===itemId)?.text||'')+' → '+target
        scope.events.emit('interaction.change',{mode:data.mode,itemId,target})
      }
      render()
    }
    function draggable(element,itemId){
      element.draggable=true;element.dataset.dragItem=itemId;element.style.touchAction='none'
      element.addEventListener('dragstart',event=>{if(!active()){event.preventDefault();return}pointer=null;dragId=itemId;event.dataTransfer?.setData('text/plain',itemId);if(event.dataTransfer)event.dataTransfer.effectAllowed='move';element.dataset.dragging='true'})
      element.addEventListener('dragend',()=>{dragId='';delete element.dataset.dragging})
    }
    function dropTarget(element,target){
      element.dataset.dropTarget=target
      element.addEventListener('dragover',event=>{if(active()&&(dragId||event.dataTransfer?.types.includes('text/plain'))){event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move'}})
      element.addEventListener('drop',event=>{event.preventDefault();event.stopPropagation();const id=dragId||event.dataTransfer?.getData('text/plain');dragId='';if(id)applyDrop(id,target)})
    }
    function pointerDown(event){
      if(!active()||event.button!==0&&event.button!==undefined||!['sort','match','classify'].includes(data.mode))return
      const element=event.target.closest?.('[data-drag-item]')
      if(!element||!root.contains(element)||event.target.closest?.('button')&&event.target!==element)return
      pointer={id:event.pointerId,itemId:element.dataset.dragItem,x:event.clientX,y:event.clientY,moved:false,element}
      element.setPointerCapture?.(event.pointerId)
    }
    function pointerMove(event){if(!pointer||pointer.id!==event.pointerId||!active())return;if(Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>8){pointer.moved=true;pointer.element.dataset.dragging='true';event.preventDefault()}}
    function pointerEnd(event){
      if(!pointer||pointer.id!==event.pointerId)return
      const current=pointer;pointer=null;delete current.element.dataset.dragging
      if(current.element.hasPointerCapture?.(event.pointerId))current.element.releasePointerCapture(event.pointerId)
      if(event.type!=='pointercancel'&&current.moved&&active()){
        event.preventDefault();const element=doc.elementFromPoint?.(event.clientX,event.clientY),target=element?.closest?.('[data-drop-target]')
        if(target&&root.contains(target))applyDrop(current.itemId,target.dataset.dropTarget)
      }
    }
    root.addEventListener('pointerdown',pointerDown);doc.addEventListener('pointermove',pointerMove,{passive:false});doc.addEventListener('pointerup',pointerEnd);doc.addEventListener('pointercancel',pointerEnd)
    function variableChanged(emit=true){
      const multiplier=Number(data.multiplier??1),result=precision(value*multiplier),normalized=(value-Number(data.min))/(Number(data.max)-Number(data.min)),scale=Math.min(440/Math.max(Math.abs(Number(data.min)),Math.abs(Number(data.max)),1),120/Math.max(Math.abs(multiplier),1))
      if(variableView){variableView.input.value=String(value);variableView.current.textContent=value+' '+(data.unit||'');variableView.result.textContent=result+' '+(data.resultUnit||'');variableView.shape.setAttribute('width',String(Math.abs(value)*scale));variableView.shape.setAttribute('height',String(Math.abs(multiplier)*scale));variableView.caption.textContent=(data.resultLabel||'结果')+' = '+value+' × '+multiplier+' = '+result}
      if(emit){scope.state.set(variableKey(),value);scope.events.emit('variable.change',{value,result,progress:normalized,stateKey:variableKey()})}
    }
    function paintBackground(strength=Number(data.intensity??0.3)){
      if(!background||!active())return
      const intensity=clamp(Number.isFinite(Number(strength))?Number(strength):Number(data.intensity??0.3)),start=data.colorStart||'#dbeafe',end=data.colorEnd||'#f8fafc',base='linear-gradient(135deg,'+start+','+end+')'
      background.style.backgroundImage=data.pattern==='grid'?'linear-gradient(transparent 95%,rgba(30,64,175,'+intensity/3+') 95%),linear-gradient(90deg,transparent 95%,rgba(30,64,175,'+intensity/3+') 95%),'+base:data.pattern==='dots'?'radial-gradient(rgba(30,64,175,'+intensity/2+') 1px,transparent 1.5px),'+base:base
      background.style.backgroundSize=data.pattern==='grid'?'36px 36px,36px 36px,100% 100%':data.pattern==='dots'?'22px 22px,100% 100%':'100% 100%'
      background.style.setProperty('--background-travel',intensity*36+'px');background.style.setProperty('--background-duration',20-intensity*12+'s')
      background.style.animationPlayState=playing&&data.dynamic&&intensity>0?'running':'paused';background.dataset.backgroundIntensity=String(intensity)
    }
    function connectBindings(){
      bindings.forEach(off=>off());bindings=[]
      if(data.mode==='background'){
        if(data.stateKey){bindings.push(scope.state.subscribe(data.stateKey,next=>paintBackground(Number(next))));const existing=scope.state.get(data.stateKey);if(existing!==undefined)paintBackground(Number(existing))}
        if(data.eventName)bindings.push(scope.events.subscribe(data.eventName,payload=>{const strength=typeof payload==='number'?payload:payload&&typeof payload==='object'?(payload.intensity??payload.progress??(typeof payload.correct==='boolean'?Number(payload.correct):undefined)):undefined;if(strength!==undefined)paintBackground(Number(strength))}))
      }else if(data.mode==='variable'&&data.stateKey){bindings.push(scope.state.subscribe(data.stateKey,next=>{if(typeof next==='number'&&Number.isFinite(next)){value=clamp(next,Number(data.min),Number(data.max));variableChanged(false)}}))}
    }
    function render(focusId,direction){
      if(!active())return
      root.replaceChildren();background=null;variableView=null
      const style=make('style');style.textContent='.teaching-interaction{height:100%;box-sizing:border-box;overflow:auto;padding:20px;border-radius:16px;background:#f1f5f9;font:22px sans-serif;color:#172554}.teaching-interaction button{font:inherit;background:white;border:1px solid #94a3b8;border-radius:6px;padding:8px 14px;margin:6px;cursor:pointer}.teaching-interaction button:focus-visible,.teaching-interaction input:focus-visible{outline:3px solid #2563eb}.teaching-interaction .row{display:flex;align-items:center;gap:10px;padding:8px;border:1px solid transparent}.teaching-interaction .label{flex:1}.teaching-interaction .status{min-height:32px;margin-top:12px}.teaching-interaction [data-drag-item]{cursor:grab}.teaching-interaction [data-dragging]{opacity:.55}.teaching-interaction .targets{display:flex;flex-wrap:wrap;gap:12px;margin:12px 0}.teaching-interaction .target{min-width:140px;min-height:70px;padding:12px;border:2px dashed #64748b;border-radius:12px}.teaching-interaction button[aria-pressed=true]{background:#dbeafe;border-color:#2563eb}.teaching-interaction input[type=range]{width:min(100%,560px)}.teaching-interaction svg{display:block;width:min(100%,600px);height:160px}.recipe-background{width:100%;height:100%;pointer-events:none;position:relative;overflow:hidden;background-position:center}.recipe-background.dynamic:after{content:"";position:absolute;inset:-40px;background:radial-gradient(ellipse at 30% 25%,rgba(255,255,255,.8),transparent 65%);animation:recipe-background-drift var(--background-duration,16s) ease-in-out infinite alternate;animation-play-state:inherit;pointer-events:none}@keyframes recipe-background-drift{from{transform:translate(calc(-1 * var(--background-travel,12px)),-8px)}to{transform:translate(var(--background-travel,12px),12px)}}@media(prefers-reduced-motion:reduce){.recipe-background.dynamic:after{animation:none}}'
      if(data.mode==='background'){background=make('div');background.className='recipe-background'+(data.dynamic?' dynamic':'');background.setAttribute('aria-hidden','true');root.style.pointerEvents='none';root.append(style,background);paintBackground();return}
      root.style.pointerEvents=''
      const shell=make('div');shell.className='teaching-interaction'
      if(data.mode==='reveal'){
        ;(data.steps||[]).slice(0,progress).forEach((step,index)=>shell.append(make('p',(index+1)+'. '+step)))
        const next=button('下一步 →',()=>{progress=Math.min((data.steps||[]).length,progress+1);scope.state.set(progressKey,progress);scope.events.emit('reveal.change',{step:progress,total:(data.steps||[]).length,progress:progress/(data.steps||[]).length})})
        next.disabled=progress>=(data.steps||[]).length;shell.append(next)
      }else if(data.mode==='choice'){
        const multiple=data.selectionMode==='multiple'
        ;(data.options||[]).forEach((text,index)=>{const choice=button(String.fromCharCode(65+index)+'. '+text,()=>{if(multiple){chosen.has(index)?chosen.delete(index):chosen.add(index);feedback=''}else{chosen=new Set([index]);answer(index===data.correct)}});choice.setAttribute('aria-pressed',String(chosen.has(index)));shell.append(choice)})
        if(multiple){const submit=button('提交选择',()=>{const correct=data.correctIndices||[data.correct];answer(chosen.size===correct.length&&correct.every(index=>chosen.has(index)))});submit.disabled=!chosen.size;shell.append(submit)}
      }else if(data.mode==='classify'||data.mode==='match'){
        shell.append(make('p','拖动项目到目标；也可以先选择项目，再选择目标。'))
        ;(data.items||[]).forEach(item=>{const choice=button(item.text+(assignments[item.id]?' → '+assignments[item.id]:''),()=>{selected=item.id;feedback='已选：'+item.text});choice.setAttribute('aria-pressed',String(selected===item.id));draggable(choice,item.id);shell.append(choice)})
        const targets=make('div');targets.className='targets'
        ;(data.groups||[]).forEach(group=>{const target=make('div');target.className='target';dropTarget(target,group);target.append(button(group,()=>{if(selected)applyDrop(selected,group)}));const names=(data.items||[]).filter(item=>assignments[item.id]===group).map(item=>item.text);target.append(make('p',names.join('、')||'放到这里'));targets.append(target)});shell.append(targets)
        shell.append(button('检查答案',()=>answer((data.items||[]).every(item=>assignments[item.id]===item.group))))
      }else if(data.mode==='variable'){
        const label=make('label',data.variableLabel||'变量'),input=make('input');input.type='range';input.min=String(data.min);input.max=String(data.max);input.step=String(data.step);input.value=String(value);input.setAttribute('aria-label',data.variableLabel||'变量')
        const current=make('output'),result=make('output');current.dataset.variableValue='';result.dataset.variableResult='';label.append(input,current);shell.append(label,make('p',(data.resultLabel||'结果')+'：'));shell.append(result)
        const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 520 160');svg.setAttribute('role','img');svg.setAttribute('aria-label',(data.variableLabel||'变量')+'与'+(data.resultLabel||'结果')+'联动图形')
        const shape=doc.createElementNS('http://www.w3.org/2000/svg','rect');shape.dataset.variableShape='';shape.setAttribute('x','20');shape.setAttribute('y','20');shape.setAttribute('height','100');shape.setAttribute('rx','4');shape.setAttribute('fill','#2563eb');svg.append(shape);const caption=make('p');shell.append(svg,caption)
        variableView={input,current,result,shape,caption};input.addEventListener('input',()=>{if(active()){value=precision(Number(input.value));variableChanged()}});variableChanged(false)
      }else{
        shell.append(make('p','拖动项目调整顺序；也可以使用上移、下移按钮。'))
        order.forEach((id,index)=>{const item=data.items.find(value=>value.id===id),row=make('div');row.className='row';draggable(row,id);dropTarget(row,id);const label=make('span',(index+1)+'. '+item.text);label.className='label';row.append(label)
          ;[-1,1].forEach(delta=>{const move=button(delta<0?'上移':'下移',()=>{[order[index],order[index+delta]]=[order[index+delta],order[index]];feedback='';scope.events.emit('interaction.change',{mode:'sort',order:[...order]})},id,delta);move.setAttribute('aria-label',item.text+(delta<0?'上移':'下移'));move.disabled=index+delta<0||index+delta>=order.length;row.append(move)
            if(focusId===id&&direction===delta)queueMicrotask(()=>{if(active()&&move.isConnected){if(!move.disabled)move.focus();else row.querySelector('button:not(:disabled)')?.focus()}})
          });shell.append(row)})
        const end=make('div','拖到这里放在最后');end.className='target';dropTarget(end,'__end');shell.append(end)
        shell.append(button('检查答案',()=>answer(order.length===(data.correctOrder||[]).length&&order.every((id,index)=>id===data.correctOrder[index]))))
      }
      shell.append(button('重置',()=>{reset();if(data.mode==='variable')variableChanged();feedback='已重置'}));const status=make('div',feedback);status.className='status';status.setAttribute('role','status');shell.append(status);root.append(style,shell)
    }
    const offPlaying=scope.events.subscribe('__runtime.playing',next=>{playing=next===true;if(background)paintBackground(Number(background.dataset.backgroundIntensity))})
    reset(false);render();connectBindings()
    const offEnter=interactions?.subscribeTrigger({type:'scene.enter'},()=>{if(data.mode==='reveal'&&active()){reset();render()}})
    const dispose=()=>{if(disposed)return;disposed=true;bindings.forEach(off=>off());offPlaying();offEnter?.();root.removeEventListener('pointerdown',pointerDown);doc.removeEventListener('pointermove',pointerMove);doc.removeEventListener('pointerup',pointerEnd);doc.removeEventListener('pointercancel',pointerEnd);pointer=null;root.style.pointerEvents='';root.replaceChildren()}
    scope.cleanup(dispose)
    return {update(next){const resetVariable=next.data.value!==data.value;data=next.data;reset(resetVariable);render();connectBindings()},dispose}
  }
}
`
