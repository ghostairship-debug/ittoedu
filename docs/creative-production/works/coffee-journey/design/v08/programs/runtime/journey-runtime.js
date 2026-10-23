/* v08: one visible subject; native Flow owns layout and the existing controller owns reading.
 * Slots report only their own projection. No fixed document offsets, host DOM queries or new scroll controller.
 * Photography and local experiments remain the resident owners between the short journeys. */
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x)),mix=(a,b,t)=>a+(b-a)*t;
const ease=x=>{x=clamp(x);return x*x*(3-2*x)};
const slots=['cup','fruit','sorting','hand','u03','bag','u05','u06','end'];
const photo={cup:[1536,1024,.61,.48],sorting:[1371,2048,.5,.43],hand:[1440,1080,.5,.48],bag:[1440,958,.5,.5],end:[1536,1024,.64,.55]};
const FRUIT='942e61c7-e691-4fac-b4c0-a09dd872b314';
export default {
 mount(c){
  const root=c.root,doc=root.ownerDocument,win=doc.defaultView,port=c.teacherController;
  let instance=c.instance,dead=false,queued=0,ticks=0,desiredOpacity=1,writtenOpacity=null,opacityWrite=null,opacityTask=null,releaseOpacity=null,opacityPump=null,arrivalOverride=null;
  const role=instance.data.visualRole||'paper';
  Object.assign(root.style,{display:'block',width:'100%',height:'100%',overflow:'hidden',pointerEvents:'none'});
  if(role==='paper'){root.style.background='#eeece2';root.dataset.coffeeUnderlay='journey-v08-native-paper';return{update(next){instance=next},dispose(){root.replaceChildren()}}}
  root.dataset.coffeeJourney='v08';root.setAttribute('aria-hidden','true');
  const canvas=doc.createElement('canvas');canvas.style.cssText='display:block;width:100%;height:100%;pointer-events:none';root.append(canvas);const g=canvas.getContext('2d');
  const images={},textures={},crops={},ready=new Set();let W=1,H=1;
  const assets=instance.data.assets||{};
  const u05Frames=['u05green','u05gold','u05roast'];
  function removeBeanBackdrop(frame,context){
   const {width:w,height:h,data:d}=frame,n=w*h,outside=new Uint8Array(n),queue=new Int32Array(n);let head=0,tail=0;
   const dark=i=>d[i*4+3]<=8||Math.max(d[i*4],d[i*4+1],d[i*4+2])<35;
   const visit=i=>{if(!outside[i]&&dark(i)){outside[i]=1;queue[tail++]=i}};
   for(let x=0;x<w;x++){visit(x);visit((h-1)*w+x)}
   for(let y=1;y<h-1;y++){visit(y*w);visit(y*w+w-1)}
   // Only dark pixels connected to the outer border are removed. Dark bean
   // fissures enclosed by the body keep their original pixels and full opacity.
   while(head<tail){const i=queue[head++],x=i%w,y=(i/w)|0;if(x)visit(i-1);if(x<w-1)visit(i+1);if(y)visit(i-w);if(y<h-1)visit(i+w)}
   for(let i=0;i<n;i++){
    if(outside[i]){d[i*4+3]=0;continue}
    const x=i%w,y=(i/w)|0;
    if((x&&outside[i-1])||(x<w-1&&outside[i+1])||(y&&outside[i-w])||(y<h-1&&outside[i+w]))d[i*4+3]=Math.round(d[i*4+3]*.72);
   }
   context.putImageData(frame,0,0);
  }
  function prepareImage(key,im){
   const masked=u05Frames.includes(key),u03=key.startsWith('u03');
   if(masked||u03||['sourcecup','sourcecherry','green','gold','roast','section'].includes(key)){
    const tmp=doc.createElement('canvas');tmp.width=im.naturalWidth;tmp.height=im.naturalHeight;
    const cg=tmp.getContext('2d',{willReadFrequently:true});cg.drawImage(im,0,0);
    const frame=cg.getImageData(0,0,tmp.width,tmp.height);
    if(masked){removeBeanBackdrop(frame,cg);textures[key]=tmp}
    const d=frame.data,threshold=masked||u03?8:20;let x0=tmp.width,y0=tmp.height,x1=0,y1=0;
    for(let y=0;y<tmp.height;y++)for(let x=0;x<tmp.width;x++)if(d[(y*tmp.width+x)*4+3]>threshold){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y)}
    if(x1<x0||y1<y0)throw new Error('Empty actor image');crops[key]=[x0,y0,x1-x0+1,y1-y0+1];
    if(masked){root.dataset.u05Mask='border-maxRGB<35;inward-feather=1px';root.dataset.u05Bounds=JSON.stringify(Object.fromEntries(u05Frames.filter(k=>crops[k]).map(k=>[k,crops[k]])))}
   }
   ready.add(key);schedule();
  }
  for(const [key,url] of Object.entries(assets)){
   const im=new win.Image();images[key]=im;
   im.onload=()=>{try{prepareImage(key,im)}catch(error){root.dataset.assetError=key;schedule()}};
   im.onerror=()=>{root.dataset.assetError=key;schedule()};im.src=url;
  }
  const media=win.matchMedia('(prefers-reduced-motion: reduce)');
  const pixelRect=r=>r&&typeof r==='object'&&['x','y','w','h'].every(k=>Number.isFinite(r[k]))&&r.w>0&&r.h>0?
   {...r,x:r.x*W,y:r.y*H,w:r.w*W,h:r.h*H}:null;
  const read=()=>Object.fromEntries(slots.map(key=>{
   const a=c.scope.state.get('coffee.v08.slot.'+key),rect=pixelRect(a);
   return[key,rect?{...rect,liquid:pixelRect(a.liquid)}:null];
  }));
  const center=r=>r&&({x:r.x+r.w/2,y:r.y+r.h/2,w:r.w,h:r.h,rect:r});
  function nativeFruit(r){
   if(!r)return null;
   // Original native image: 1254 square, object-fit:cover. The cutout's 896x1036
   // canvas contains margins; its actual body is this registered original crop.
   const scale=Math.max(r.w/1254,r.h/1254),ix=r.x+(r.w-1254*scale)/2,iy=r.y+(r.h-1254*scale)/2;
   return{x:ix+643*scale,y:iy+606*scale,w:712*scale,h:852*scale,rect:r};
  }
  function photoCropPose(r,key){
   const im=images[key],b=crops[key];if(!r||!ready.has(key)||!im||!b)return null;
   const sx=r.w/im.naturalWidth,sy=r.h/im.naturalHeight;
   return{x:r.x+(b[0]+b[2]/2)*sx,y:r.y+(b[1]+b[3]/2)*sy,w:b[2]*sx,h:b[3]*sy,rect:r,reference:key};
  }
  function object(r,key,u,v,bw=0,bh=0){if(!r)return null;const [nw,nh,px,py]=photo[key],s=Math.max(r.w/nw,r.h/nh),x=r.x+(r.w-nw*s)*px,y=r.y+(r.h-nh*s)*py;return{x:x+u*nw*s,y:y+v*nh*s,w:bw*s,h:bh*s,rect:r,map:{x,y,w:nw*s,h:nh*s}}}
  // A single held lease can move 0 -> 1 -> 0 on reverse scroll. Writes are serialized;
  // a late write from an earlier frame cannot overwrite the newest desired opacity.
  function flushOpacity(){
   if(opacityPump)return opacityPump;
   if(!opacityWrite)return Promise.resolve();
   opacityPump=(async()=>{while(opacityWrite&&writtenOpacity!==desiredOpacity){
    const next=desiredOpacity;await opacityWrite({opacity:next});writtenOpacity=next;
   }})().catch(()=>{root.dataset.opacityError='native-subject-write'}).finally(()=>{opacityPump=null});
   return opacityPump;
  }
  function nativeOpacity(value){
   desiredOpacity=clamp(value);
   if(!opacityTask){
    // Resident mode does not need a motion owner until the first actual takeover.
    if(desiredOpacity===1)return Promise.resolve();
    const target=c.scope.target({kind:'instance',instanceId:FRUIT});if(!target?.motion)return Promise.resolve();
    opacityTask=target.motion.replace('coffee-v08-subject-lease',async ctx=>{
     if(dead)return;
     const released=new Promise(resolve=>{releaseOpacity=resolve});
     opacityWrite=values=>ctx.write(values);
     await flushOpacity();await released;
    });
   }
   return flushOpacity();
  }
  let lastHandoff='';
  function handoff(active){
   const sig=JSON.stringify(active);if(sig===lastHandoff)return;lastHandoff=sig;
   for(const key of ['u03','u05','u06']){
    const opacity=active?.slot===key?clamp(active.opacity??0):1;
    c.scope.events.emit('coffee.v08.handoff',{slot:key,active:active?.slot===key,visible:opacity>0,opacity,progress:active?.progress||0});
   }
  }
  const u05Material=s=>['green','gold','roast'].includes(s?.material)?s.material:
   (Number(s?.value)||0)<30?'green':(Number(s?.value)||0)<75?'gold':'roast';
  const actorReady=keys=>keys.every(key=>ready.has(key)&&images[key]?.naturalWidth>0);
  function sprite(key,x,y,w,angle=0,alpha=1,filter='none'){
   const im=images[key];if(!im?.complete||!im.naturalWidth||w<=0||alpha<=.001)return;const b=crops[key]||[0,0,im.naturalWidth,im.naturalHeight],h=w*b[3]/b[2];
   g.save();g.translate(x,y);g.rotate(angle);g.globalAlpha=alpha;g.filter=filter;g.drawImage(textures[key]||im,...b,-w/2,-h/2,w,h);g.restore();
  }
  let u05Composite=null,u05CompositeValue=null;
  function u05Blend(value,reference,x,y,w,angle,alpha){
   const ref=crops[reference],im=images[reference];if(!ref||!im||alpha<=.001)return;
   value=clamp(Number(value)||0,0,100);
   if(!u05Composite){u05Composite=doc.createElement('canvas');u05Composite.width=im.naturalWidth;u05Composite.height=im.naturalHeight}
   if(u05CompositeValue!==value){
    const cg=u05Composite.getContext('2d'),q=value/50,weights=q<=1?[1,q,0]:[0,1,q-1];
    cg.clearRect(0,0,u05Composite.width,u05Composite.height);
    u05Frames.forEach((key,i)=>{if(weights[i]>0){cg.globalAlpha=weights[i];cg.drawImage(textures[key]||images[key],0,0)}});
    cg.globalAlpha=1;u05CompositeValue=value;
   }
   // Composite in the original 1254-square registration first, then apply group
   // opacity once, just like .roast-pictures. This preserves slider midpoints too.
   const scale=w/ref[2];g.save();g.translate(x,y);g.rotate(angle);g.globalAlpha=alpha;g.filter='none';
   g.drawImage(u05Composite,-(ref[0]+ref[2]/2)*scale,-(ref[1]+ref[3]/2)*scale,u05Composite.width*scale,u05Composite.height*scale);g.restore();
  }
  function clippedPhotoActor(route,key,x,y,w,angle,progress){
   const end=route.b,photoKey=route.photoKey,im=images[photoKey==='sorting'?'sortingphoto':'bagphoto'];
   if(progress<.84){sprite(key,x,y,w,angle,1,route.filter);return}
   const rr=end.rect,sorting=photoKey==='sorting';
   // Side entry must remain visible outside the photo until it crosses the edge.
   // Lift the clipping line smoothly from below the object into the foreground.
   const entered=sorting?ease((rr.x+rr.w-x)/(Math.max(1,w)*.9)):1;
   const q=ease((progress-.84)/.16)*entered,cut=end.y+w*(sorting?mix(.8,.10,q):.10);
   if(sorting&&q<=.001){sprite(key,x,y,w,angle,1,route.filter);return}
   g.save();g.beginPath();g.rect(sorting?0:rr.x,sorting?56:rr.y,sorting?W:rr.w,Math.max(0,cut-(sorting?56:rr.y)));g.clip();sprite(key,x,y+q*w*.95,w,angle,1,route.filter);g.restore();
   // Restore a matching piece of the original foreground pile over the entering object.
   // It is the same photograph at the same object-fit transform, so the seam has no foreign texture.
   if(im?.complete&&im.naturalWidth&&q>0){const m=end.map;g.save();g.beginPath();g.ellipse(end.x,cut+w*.18,w*.62,w*.27,0,0,Math.PI*2);g.clip();g.drawImage(im,m.x,m.y,m.w,m.h);g.restore()}
  }
  function travel(a,b,type,opts={}){
   if(!a||!b)return null;const phone=W<700,anchor=opts.endY??(phone?H*.37:H*.34),begin=opts.begin==='exit'?a.y+a.h/2-58:a.y-(phone?190:240),end=b.y-anchor,den=end-begin;
   if(den<35)return null;const t=-begin/den;if(t<0||t>1)return null;return{a,b,type,t,begin,end,...opts};
  }
  function paint(){
   queued=0;if(dead)return;W=Math.max(1,root.clientWidth);H=Math.max(1,root.clientHeight);const dpr=Math.min(win.devicePixelRatio||1,2);
   if(canvas.width!==Math.round(W*dpr)||canvas.height!==Math.round(H*dpr)){canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr)}g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,W,H);
   const state=port?.read(),s=read(),phone=W<700,interactive=state?.interactive!==false;
   const u03Key='u03'+(['natural','washed','honey'].includes(s.u03?.material)?s.u03.material:'natural');
   const u05Key='u05'+u05Material(s.u05),u05Value=clamp(Number(s.u05?.value)||0,0,100);
   const a={cup:object(s.cup,'cup',978/1536,438/1024,619,459),fruit:nativeFruit(s.fruit),sorting:object(s.sorting,'sorting',.82,.79,22,25),hand:object(s.hand,'hand',.55,.50,155,130),u03:center(s.u03),bag:object(s.bag,'bag',.67,.77,30,40),u05:photoCropPose(s.u05,u05Key),u06:center(s.u06),u06Liquid:center(s.u06?.liquid),end:object(s.end,'end',.617,.335,95,38)};
   root.dataset.slotCount=String(Object.values(s).filter(Boolean).length);root.dataset.reading=String(state?.reading?.progress||0);root.dataset.reduced=String(media.matches);root.dataset.tick=String(++ticks);
   if(media.matches||!interactive){nativeOpacity(1);handoff(null);root.dataset.stage='resident';return}
   const routes=[
    travel(a.cup,a.fruit,'cup-fruit',{begin:'exit',endY:phone?220:275}),
    travel(a.fruit,a.sorting,'fruit-sorting',{photoKey:'sorting',filter:'saturate(.82) brightness(.92)',endY:phone?H*.40:H*.34}),
    travel(a.hand,a.u03,'hand-specimen',{begin:'exit',local:'u03'}),
    travel(a.u03,a.bag,'specimen-bag',{begin:'exit',photoKey:'bag',filter:'saturate(.55) contrast(.88) brightness(1.03)',endY:phone?H*.42:H*.38}),
    travel(a.bag,a.u05,'bag-roast',{begin:'exit',local:'u05'}),
    travel(a.u05,a.u06,'roast-filter',{begin:'exit',local:'u06',endY:phone?H*.40:H*.38}),
    travel(a.u06Liquid,a.end,'liquid-cup',{begin:'exit',endY:phone?H*.42:H*.40})
   ].filter(Boolean);
   let r=routes.at(-1);
   // Chapter navigation is a semantic match cut to the resident scene. The
   // existing navigation controller still owns the scroll. A direct visit must
   // not leave an empty scientific diagram while a tiny travelling actor waits
   // in the margin for another scroll gesture.
   if(arrivalOverride){
    if(r?.type===arrivalOverride.route){arrivalOverride.seen=true;r=null}
    else if(arrivalOverride.seen&&r)arrivalOverride=null;
   }
   // Once the local experiment owns liquid, changing its layout or mode must
   // not replay the incoming bean. The liquid-to-cup exit remains available.
   if(r?.type==='roast-filter'&&(s.u06?.mode==='dilute'||s.u06?.material==='coffee-liquid'))r=null;
   const requirements={
    'cup-fruit':['sourcecup','sourcecherry'],'fruit-sorting':['sourcecherry','sortingphoto'],
    'hand-specimen':['sourcecherry',u03Key],'specimen-bag':[u03Key,'green','bagphoto'],
    'bag-roast':['green',...u05Frames],'roast-filter':[...u05Frames,'roast'],'liquid-cup':[]
   };
   // Until the moving texture and any matching foreground are ready, native/local
   // owners remain visible. Image errors therefore cannot leave empty subject slots.
   if(r&&!actorReady(requirements[r.type]||[])){root.dataset.waitingForActor=r.type;r=null}else delete root.dataset.waitingForActor;
   root.dataset.stage=r?.type||'resident';root.dataset.progress=String(r?.t??0);
   const fruitOpacity=r?.type==='cup-fruit'?ease((r.t-.92)/.08):r?.type==='fruit-sorting'?0:1;
   nativeOpacity(fruitOpacity);
   handoff(r?.local&&r.type!=='roast-filter'?{slot:r.local,progress:r.t,opacity:ease((r.t-.90)/.10)}:null);
   if(!r){root.dataset.pose='';return}
   const t=r.t,p=ease(t);let x=mix(r.a.x,r.b.x,p),y=mix(r.a.y,r.b.y,p),size=0,key='sourcecherry',alpha=1,angle=mix(-.10,.17,p);
   g.save();g.beginPath();g.rect(0,56,W,Math.max(0,H-56));g.clip();
   if(r.type==='cup-fruit'){
    // A conservative match cut: the photograph's cup has already left the reading
    // viewport before this route starts. Reintroduce that exact cutout in the
    // destination's visual column, rather than changing material above the screen.
    const entrySize=Math.min(r.a.w,phone?112:168),cupCrop=crops.sourcecup;
    const entryHeight=entrySize*(cupCrop?cupCrop[3]/cupCrop[2]:.72);
    // The preceding photograph and its caption must clear before the new cup
    // occupies the visual column; fixed viewport y covered the hero's tail copy.
    const entryY=Math.max(phone?126:132,r.a.rect.y+r.a.rect.h+entryHeight/2+36);
    const entryX=clamp(r.b.x,entrySize*.60+12,W-entrySize*.60-12);
    const appear=ease((t-.035)/.10),flight=ease((t-.35)/.49),material=ease((t-.35)/.29);
    x=mix(entryX,r.b.x,flight);
    y=mix(entryY+8*(1-appear),r.b.y,flight);
    size=mix(entrySize,r.b.w,flight);
    angle=.035*Math.sin(Math.PI*flight);
    // Geometry is fully registered at .84; the native crossfade starts only at .92.
    // Therefore its final opacity exchange cannot reveal an offset or rotated twin.
    const resident=ease((t-.92)/.08);
    alpha=appear*(1-resident);
    sprite('sourcecup',x,y,size,angle,appear*(1-material));
    sprite('sourcecherry',x,y,size,angle,appear*material*(1-resident));
   }else{
    if(r.type==='fruit-sorting'){key='sourcecherry';size=mix(r.a.w,Math.max(phone?10:13,r.b.w),ease(t/.80));}
    if(r.type==='hand-specimen'){
     const settle=ease((t-.32)/.54),above=clamp(r.b.y-r.b.h/2-64,126,Math.max(126,H-70));
     // Use the measured material column, not a diagonal across the chapter title.
     x=r.b.x;y=mix(above,r.b.y,settle);
     size=mix(Math.min(r.a.w,100),r.b.w,ease((t-.50)/.36));
     angle=.035*Math.sin(Math.PI*settle);alpha=ease(t/.10)*(1-ease((t-.90)/.10));
    }
    if(r.type==='specimen-bag'){key='green';size=mix(Math.min(r.a.w,phone?115:180),Math.max(11,r.b.w),p);alpha=ease(t/.13);}
    if(r.type==='bag-roast'){
     const settle=ease(t/.86);key=u05Key;x=mix(r.a.x,r.b.x,settle);y=mix(r.a.y,r.b.y,settle);
     size=mix(18,r.b.w,settle);angle=.035*Math.sin(Math.PI*settle);alpha=1-ease((t-.90)/.10);
    }
    if(r.type==='roast-filter'){key=u05Key;size=mix(r.a.w,16,p);angle=.035*Math.sin(Math.PI*p);alpha=1-ease((t-.89)/.11);}
    if(phone&&r.type!=='liquid-cup'&&r.type!=='fruit-sorting'){
     const returnEnd=['hand-specimen','bag-roast'].includes(r.type)?.86:1,returnP=ease((t-.70)/(returnEnd-.70));
     const track=ease(t/.22)*(1-returnP),side=W-10;
     // Keep a small visible material witness in the right-hand margin; expand again
     // as the same subject approaches its measured destination.
     size=mix(size,Math.min(size,14),track);
     y=mix(y,clamp(y,80,Math.max(80,H-30)),track);
     if(t<.22)x=mix(r.type==='hand-specimen'?r.b.x:r.a.x,side,ease(t/.22));else if(t<.70)x=side;else x=mix(side,r.b.x,returnP);
    }else if(!phone&&r.type==='specimen-bag'){
     x+=Math.sin(Math.PI*p)*Math.min(100,W*.07);size=mix(size,Math.min(size,68),Math.sin(Math.PI*p)*.62);
    }
    if(r.type==='fruit-sorting'){
     // Stay in the source's visual column first. Only after reaching the narrow
     // clear line above the photograph may the actor cross to the outside edge.
     // This prevents the initial diagonal from sweeping through the U01 paragraph.
     const rr=r.b.rect,trackSize=Math.min(r.a.w,phone?36:56),goalSize=Math.max(phone?10:13,r.b.w);
     size=t<.80?mix(r.a.w,trackSize,ease(t/.12)):mix(trackSize,goalSize,ease((t-.80)/.20));
     const navFloor=56+size*.75+8,topLimit=rr.y-size*.65;
     const side=Math.max(size*.60+2,Math.min(W-size*.60-2,rr.x+rr.w+size*.65));
     const topY=Math.max(navFloor,Math.min(topLimit,H-size*.65-4));
     if(t<.25){
      x=r.a.x;
      y=clamp(mix(r.a.y,topY,ease(t/.25)),navFloor,Math.max(navFloor,topLimit));
     }else if(t<.46){
      x=mix(r.a.x,side,ease((t-.25)/.21));y=topY;
     }else if(t<.80){
      x=side;y=clamp(mix(topY,r.b.y,ease((t-.46)/.34)),navFloor,Math.max(navFloor,H-size*.65-4));
     }else{
      x=mix(side,r.b.x,ease((t-.80)/.20));y=r.b.y;
     }
     // A scrolling photograph can close the overhead gap. In that case the only
     // safe visible continuation is already at its outside edge, not across a face.
     if(t<.46&&topLimit<navFloor)x=side;
     angle=.055*Math.sin(Math.PI*ease(t));
     if(phone){
      // Full-width mobile paragraphs leave only a narrow outer margin. Cross
      // horizontally while still on the original fruit's row, then travel in
      // that margin; a downward diagonal would sweep across the prose.
      const edge=W-10,entry=ease(t/.12),rail=ease((t-.12)/.68);
      size=t<.80?mix(r.a.w,14,entry):mix(14,goalSize,ease((t-.80)/.20));
      const floor=56+size*.66+7;
      if(t<.12){x=mix(r.a.x,edge,entry);y=clamp(r.a.y,floor,H-size*.66-4)}
      else if(t<.80){x=edge;y=clamp(mix(90,r.b.y,rail),80,H-28)}
      else{x=mix(edge,r.b.x,ease((t-.80)/.20));y=r.b.y}
     }
    }
    if(r.type==='liquid-cup'){
     const approach=ease((t-.65)/.35),side=W-(phone?20:36),railY=clamp(y,80,Math.max(80,H-35));
     x=mix(side,r.b.x,approach);y=clamp(mix(railY,r.b.y,approach),80,Math.max(80,H-35));
     size=mix(14,6,p);alpha=ease((t-.015)/.10)*(1-ease((t-.92)/.08));
     g.save();g.translate(x,y);g.rotate(-.07*Math.sin(Math.PI*approach));g.globalAlpha=alpha;
     const liquid=g.createLinearGradient(-size,0,size,0);liquid.addColorStop(0,'#3c1f0c');liquid.addColorStop(.45,'#b77837');liquid.addColorStop(1,'#492713');g.fillStyle=liquid;g.beginPath();g.ellipse(0,0,size*.32,mix(16,3,p),0,0,Math.PI*2);g.fill();g.restore();
    }else if(r.type==='hand-specimen'){
     const material=ease((t-.38)/.28);
     sprite('sourcecherry',x,y,size,angle,alpha*(1-material));
     sprite(u03Key,x,y,size,angle,alpha*material);
    }else if(r.type==='specimen-bag'&&t<.45){
     const material=ease((t-.15)/.30);
     sprite(u03Key,x,y,size,angle,alpha*(1-material));sprite('green',x,y,size,angle,alpha*material,r.filter);
    }else if(r.photoKey)clippedPhotoActor(r,key,x,y,size,angle,t);
    else if(r.type==='bag-roast'){
     const material=ease((t-.28)/.32);
     sprite('green',x,y,size,angle,alpha*(1-material));u05Blend(u05Value,u05Key,x,y,size,angle,alpha*material);
    }else if(r.type==='roast-filter'){
     if(t>.60){const q=ease((t-.60)/.40);for(let i=0;i<16;i++){const dx=Math.sin(i*6.7)*size*q*.9,dy=Math.cos(i*4.1)*size*q*.35;sprite('roast',x+dx,y+dy,Math.max(1,size*(1-q)*.20+2),angle+i*.4,alpha)}}
     else{
      const roasted=ease(t/.30);
      u05Blend(mix(u05Value,100,roasted),u05Key,x,y,size,angle,alpha);
     }
    }
    else sprite(key,x,y,size,angle,alpha);
   }
   g.restore();root.dataset.pose=JSON.stringify({x,y,width:size,alpha,source:r.a,target:r.b});
  }
  function schedule(){if(!dead&&!queued)queued=win.requestAnimationFrame(paint)}
  const off=port?.subscribe(schedule),offs=slots.map(key=>c.scope.state.subscribe('coffee.v08.slot.'+key,schedule));
  const offNavigation=c.scope.events.subscribe('coffee.v08.navigation',value=>{
   const route={'02':'fruit-sorting','03':'hand-specimen','04':'specimen-bag','05':'bag-roast','06':'roast-filter','07':'liquid-cup'}[String(value?.chapter||'')];
   arrivalOverride=route?{route,seen:false}:null;schedule();
  });
  const offLayout=c.layout?.subscribe(schedule);media.addEventListener('change',schedule);schedule();
  const dispose=()=>{if(dead)return;dead=true;if(queued)win.cancelAnimationFrame(queued);off?.();offLayout?.();offs.forEach(f=>f());media.removeEventListener('change',schedule);
   offNavigation?.();handoff(null);
   // Restore before relinquishing the lease, including a queued 0 -> 1 reversal.
   const restore=nativeOpacity(1);Promise.resolve(restore).finally(()=>{releaseOpacity?.();opacityTask?.cancel();opacityWrite=null;opacityTask=null});
   for(const im of Object.values(images)){im.onload=null;im.onerror=null}root.replaceChildren()};
  c.scope.cleanup(dispose);return{update(next){instance=next;schedule()},resume(){schedule()},dispose};
 }
};
