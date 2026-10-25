import {clamp,prepareStops,sampleColor,createInvalidator} from '../../../assets/continuous-background/runtime-core.js';
export default {apiVersion:5,mount(context){
 const {root,scope,teacherController:tc}=context;if(!root)throw Error('Background requires a visual root');
 const win=root.ownerDocument.defaultView,layer=root.ownerDocument.createElement('div');
 let instance=context.instance,stops,offState=()=>{},dead=false,paints=0,last='';
 Object.assign(root.style,{pointerEvents:'none',overflow:'visible'});
 Object.assign(layer.style,{position:'fixed',inset:'0',pointerEvents:'none'});layer.setAttribute('aria-hidden','true');layer.dataset.runtimeAsset='continuous-background-v1';root.append(layer);
 function stateKey(){return instance.stateBindings?.progress||instance.data.stateKey||''}
 function scalar(){
  const d=instance.data;let raw=d.value??0;
  if(d.mode==='reading')raw=tc?.read()?.reading?.progress??raw;
  if(d.mode==='state'){const incoming=scope.state.get(stateKey());raw=d.field&&incoming&&typeof incoming==='object'?incoming[d.field]:incoming??raw;}
  const n=Number(raw);return Number.isFinite(n)?n:Number(d.value)||0;
 }
 function paint(){
  const value=scalar(),color=sampleColor(stops,value);
  if(color!==last){layer.style.backgroundColor=color;last=color;layer.dataset.paints=String(++paints);}
  layer.dataset.value=String(value);
 }
 const invalidator=createInvalidator(win,scope,paint);
 function configure(){
  const d=instance.data;
  stops=prepareStops(d.stops||[{at:0,color:'#f4efe4'},{at:.5,color:'#1d2525'},{at:1,color:'#dceae4'}]);
  offState();const key=stateKey();offState=key?scope.state.subscribe(key,invalidator.request):()=>{};
  invalidator.request();
 }
 const offTc=tc?.subscribe(invalidator.request);
 function dispose(){if(dead)return;dead=true;offState();offTc?.();invalidator.dispose();layer.remove()}
 scope.cleanup(dispose);configure();
 return{update(next){instance=next;configure()},suspend:invalidator.suspend,resume:invalidator.resume,dispose};
}};
