const fs=require('fs'),vm=require('vm');
const input=fs.readFileSync(process.argv[2]||require('node:path').join(__dirname,'../background-runtime.js'),'utf8');
function probe(patch){
 let now=10000,id=0,cleanup,sub,off=0;const queue=new Map(),images=[],listeners={};
 const grad={addColorStop(){}};
 const context=new Proxy({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),createPattern:()=>({}),createLinearGradient:()=>grad,createRadialGradient:()=>grad,globalAlpha:1},{get:(o,k)=>k in o?o[k]:()=>{}});
 const media={matches:false,addEventListener:(n,f)=>listeners.media=f,removeEventListener:()=>delete listeners.media};
 class Image {constructor(){this.complete=true;images.push(this)}set src(v){this._src=v}}
 const win={devicePixelRatio:1,matchMedia:()=>media,Image};
 const doc={defaultView:win,hidden:false,createElement:()=>({style:{},getContext:()=>context,setAttribute(){}}),addEventListener:(n,f)=>listeners[n]=f,removeEventListener:n=>delete listeners[n]};
 const root={ownerDocument:doc,clientWidth:1000,clientHeight:800,dataset:{},style:{},append(){},replaceChildren(){}};
 const state={locationId:'flow',scenes:[{id:'flow',targets:[{id:'a'},{id:'b'},{id:'c'}]}],reading:{activeInstanceId:'a'}};
 const port={read:()=>state,subscribe:f=>{sub=f;return()=>{off++;sub=null}}};
 const sandbox={module:{exports:{}},Path2D:class {},ResizeObserver:class {observe(){}disconnect(){}},performance:{now:()=>now},requestAnimationFrame:f=>{queue.set(++id,f);return id},cancelAnimationFrame:i=>queue.delete(i),Uint8ClampedArray};
 let source=input.replace('export default','module.exports =').replace('if(!disposed&&!raf)render(performance.now(),false)','if(!disposed)render(performance.now(),false)');
 if(patch)source=source.replace('if(!disposed)render(performance.now(),false)','if(!disposed&&!raf)render(performance.now(),false)');
 vm.runInNewContext(source,sandbox);
 const runtime=sandbox.module.exports.mount({root,teacherController:port,instance:{data:{chapters:[{targetId:'a'},{targetId:'b'},{targetId:'c'}],symbols:['<svg/>','<svg/>','<svg/>']}},scope:{cleanup:f=>cleanup=f}});
 const facts={initialIdle:root.dataset.idle,initialRaf:queue.size};
 const go=x=>{state.reading.activeInstanceId=x;sub()};
 const frame=t=>{now=t;const jobs=[...queue.values()];queue.clear();for(const f of jobs)f(t)};
 go('b');frame(10016);facts.transitionRaf=queue.size;
 images[0].onload();facts.afterImageLoadRaf=queue.size;
 go('c');facts.afterRetargetRaf=queue.size;
 frame(12000);facts.finalStage=root.dataset.stage;facts.finalIdle=root.dataset.idle;facts.finalRaf=queue.size;
 go('a');runtime.suspend();facts.suspendRaf=queue.size;runtime.resume();frame(14000);facts.resumeIdle=root.dataset.idle;
 runtime.dispose();cleanup();facts.disposedOff=off;facts.disposedRaf=queue.size;facts.listeners=Object.keys(listeners);
 return facts;
}
console.log(JSON.stringify({before:probe(false),withImageLoadGuard:probe(true)},null,2));
