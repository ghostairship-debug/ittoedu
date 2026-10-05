/** Runs in the content realm; all transient interaction state belongs to its mount. */
export default String.raw`
export default {
  mount({root,instance,scope,interactions}) {
    if (!root) throw new Error('教学互动需要内容根元素')
    let data=instance.data, disposed=false, order=[], assignments={}, selected='', progress=0, feedback=''
    const make=(tag,text)=>{const element=root.ownerDocument.createElement(tag);if(text!==undefined)element.textContent=String(text);return element}
    const active=()=>!disposed&&scope.isActive()
    function reset(){order=(data.items||[]).map(item=>item.id);assignments={};selected='';progress=Number(data.initialStep||0);feedback=''}
    function button(text,action,focusId,direction){const element=make('button',text);element.type='button';element.addEventListener('click',()=>{if(active()){action();render(focusId,direction)}});return element}
    function answer(correct){feedback=correct?data.success:data.failure;scope.events.emit('answer',{correct})}
    function render(focusId,direction){
      if(!active())return
      root.replaceChildren()
      const style=make('style');style.textContent='.teaching-interaction{height:100%;box-sizing:border-box;overflow:auto;padding:20px;border-radius:16px;background:#f1f5f9;font:22px sans-serif;color:#172554}.teaching-interaction button{font:inherit;background:white;border:1px solid #94a3b8;border-radius:6px;padding:8px 14px;margin:6px;cursor:pointer}.teaching-interaction button:focus-visible{outline:3px solid #2563eb}.teaching-interaction .row{display:flex;align-items:center;gap:10px;padding:8px}.teaching-interaction .label{flex:1}.teaching-interaction .status{min-height:32px;margin-top:12px}'
      const shell=make('div');shell.className='teaching-interaction'
      if(data.mode==='reveal'){
        (data.steps||[]).slice(0,progress).forEach((step,index)=>shell.append(make('p',(index+1)+'. '+step)))
        const next=button('下一步 →',()=>{progress=Math.min((data.steps||[]).length,progress+1);scope.state.set('progress',progress)})
        next.disabled=progress>=(data.steps||[]).length;shell.append(next)
      }else if(data.mode==='choice'){
        (data.options||[]).forEach((text,index)=>shell.append(button(String.fromCharCode(65+index)+'. '+text,()=>answer(index===data.correct))))
      }else if(data.mode==='classify'){
        ;(data.items||[]).forEach(item=>shell.append(button(item.text+(assignments[item.id]?' → '+assignments[item.id]:''),()=>{selected=item.id;feedback='已选：'+item.text})))
        ;(data.groups||[]).forEach(group=>shell.append(button(group,()=>{if(selected){assignments[selected]=group;feedback='已归入：'+group}})))
        shell.append(button('检查答案',()=>answer((data.items||[]).every(item=>assignments[item.id]===item.group))))
      }else{
        order.forEach((id,index)=>{const item=data.items.find(value=>value.id===id),row=make('div');row.className='row';const label=make('span',(index+1)+'. '+item.text);label.className='label';row.append(label)
          ;[-1,1].forEach(delta=>{const move=button(delta<0?'上移':'下移',()=>{[order[index],order[index+delta]]=[order[index+delta],order[index]]},id,delta);move.setAttribute('aria-label',item.text+(delta<0?'上移':'下移'));move.disabled=index+delta<0||index+delta>=order.length;row.append(move)
            if(focusId===id&&direction===delta)queueMicrotask(()=>{if(active()&&move.isConnected){if(!move.disabled)move.focus();else row.querySelector('button:not(:disabled)')?.focus()}})
          });shell.append(row)})
        shell.append(button('检查答案',()=>answer(order.every((id,index)=>id===(data.correctOrder||[])[index]))))
      }
      shell.append(button('重置',()=>{reset();feedback='已重置'}));const status=make('div',feedback);status.className='status';status.setAttribute('role','status');shell.append(status);root.append(style,shell)
    }
    reset();render()
    const offEnter=interactions?.subscribeTrigger({type:'scene.enter'},()=>{if(data.mode==='reveal'&&active()){reset();scope.state.set('progress',progress);render()}})
    if(offEnter)scope.cleanup(offEnter)
    return {update(next){data=next.data;reset();render()},dispose(){disposed=true;offEnter?.();root.replaceChildren()}}
  }
}
`
