'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=path.resolve(__dirname,'..'),work=path.resolve(base,'../..');
const rel=p=>p.replace(/\\/g,'/');
const file=p=>path.resolve(base,p);
const read=p=>JSON.parse(fs.readFileSync(file(p),'utf8'));
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const info=(p,root=base)=>{const f=path.resolve(root,p);if(!fs.existsSync(f))throw Error('Missing: '+f);const s=fs.statSync(f);return{path:rel(p),bytes:s.size,sha256:digest(f)}};
const keys=['cup','cherry','section','green','gold','roast'];
const routes=['natural','washed','honey'];
const major=['native/coffee-journey-v07.glx','native/coffee-journey-v07-offline.html','native/OBJECT_INDEX.json','art-studies-offline.html','background-runtime.js','background-stages.js','background-entry.js','background-assets.css','ASSET_PROMPTS.json','programs/u03/build_u03.py','programs/u03/u03.html','programs/u03/u03.css','programs/u03/u03.js','programs/u03/content.json'];
const core=major.map(p=>info(p)),materials=[...keys.map(k=>info('assets/source/'+k+'.png')),...keys.map(k=>info('assets/runtime/'+k+'.webp')),...routes.flatMap(k=>[info('programs/u03/assets/'+k+'-section.webp'),info('programs/u03/assets/'+k+'-layers.svg'),info('programs/u03/assets/'+k+'.webp')])];
const motionFiles=fs.readdirSync(file('previews/motion')).filter(x=>x.endsWith('.png'));
const desktop=motionFiles.filter(x=>x.startsWith('1440-')).length,mobile=motionFiles.filter(x=>x.startsWith('390-')).length;
const offline=read('evidence/final-offline-verification.json'),frames=read('evidence/final-motion-frames.json');
const cold=read('evidence/final-cold-open.json'),preserve=read('evidence/final-assembly-preservation.json');
const u03=read('evidence/u03-material-review.json'),art=read('evidence/visual-acceptance.json');
const baselines=[info('v06/native/coffee-journey-v06.glx',path.resolve(base,'..')),info('v05/native/coffee-journey-v05.glx',path.resolve(base,'..'))];
const check=(condition,label)=>{if(!condition)throw Error('FAILED '+label)};
check(cold.revision===215 && cold.fullProjectEqual && !cold.dirty,'r215 cold open');
check(cold.export.data.exportedRevision===215 && cold.export.data.warnings.length===0,'r215 export');
check(offline.length===2 && offline.every(x=>x.chapters.length===7 && x.errors.length===0 && x.httpRequests.length===0),'offline seven chapters');
check(motionFiles.length===50 && desktop===30 && mobile===20,'motion 30 desktop + 20 mobile frames');
check(frames.length===2 && frames.every(x=>x.transitions.length>=4),'real motion evidence');
check(u03.length===2 && u03.every(x=>x.errors.length===0 && x.stateReturn),'U03 result');
check(preserve.instances===183 && preserve.allInstanceAndDefinitionIdsPreserved,'preserved IDs');
check(baselines[0].sha256===preserve.v06Hash,'untouched v06 GLX');
const summary={revision:215,instanceCount:183,sourceFiles:core.length,materialFiles:materials.length,motionFrames:motionFiles.length,motionDesktop:desktop,motionMobile:mobile,desktopChapters:offline[0].chapters.length,mobileChapters:offline[1].chapters.length,offlineErrors:offline.flatMap(x=>x.errors).length,offlineNetworkRequests:offline.flatMap(x=>x.httpRequests).length,materialImages:keys.length,artReviewAccepted:art.accepted,corpusHasStableNativeIds:preserve.allInstanceAndDefinitionIdsPreserved,coldOpenEqual:cold.fullProjectEqual,exportWarnings:cold.export.data.warnings.length,existingV06Sha:baselines[0].sha256,existingV05Sha:baselines[1].sha256};
function checkLinks(){
 const list=['README.md','ASSETS.md','BACKGROUND_RUNTIME.md','REFERENCE_CASES.md','VERIFICATION.md','CLOSEOUT.md','previews/README.md','programs/u03/INTEGRATION.md','../../README.md','../../handoff/NEXT_PASS.md'];
 const misses=[];let links=0;
 for(const entry of list){const f=file(entry);if(!fs.existsSync(f)){misses.push(entry+' missing document');continue}
  const s=fs.readFileSync(f,'utf8'),regexp=/\]\(([^)]+)\)/g;let m;
  while((m=regexp.exec(s))){let target=m[1].trim().split('#')[0];if(!target||/^(https?:|mailto:|data:)/.test(target))continue;target=target.replace(/%20/g,' ');links++;if(!fs.existsSync(path.resolve(path.dirname(f),target)))misses.push(entry+' -> '+m[1]);}
 }
 return{checkedDocuments:list.length,relativeLinksChecked:links,missing:misses};
}
const mode=process.argv[2]||'--audit';
if(mode==='--audit')console.log(JSON.stringify({summary,linkReport:checkLinks(),coldRecord:cold.export.data,status:'audit only; no GLX touched'},null,2));
else if(mode==='--manifest'){
 const docs=['README.md','ASSETS.md','BACKGROUND_RUNTIME.md','REFERENCE_CASES.md','VERIFICATION.md','CLOSEOUT.md','previews/README.md','programs/u03/INTEGRATION.md','../../README.md','../../handoff/NEXT_PASS.md'].map(p=>info(p));
 const featured=['previews/material-reference-final.png','previews/motion-contact-1440.png','previews/motion-contact-390.png','previews/transition-contact-sheet.png','previews/final-1440-u03-compare.png','previews/final-390-u03-compare.png'].map(p=>info(p));
 const manifest={manifestVersion:1,workId:'coffee-journey',version:'v07',date:'2026-10-23',revision:215,status:'creative-reference-r215-technical-closeout-owner-art-approval-pending',schemaVersion:11,core:{glx:core[0],offlineHtml:core[1],objectIndex:core[2],instances:183,identityPreserved:true},historical:{v06:baselines[0],v05:baselines[1],sugarDemo:'../v06/reuse/solute-study/solute-study.glx (r34; no v07 rewrite)'},validation:summary,materials,editableSources:core.slice(3),featuredScreenshots:featured,documentedSources:docs,motionEvidence:{desktop:30,mobile:20,actualNavigation:'evidence/final-motion-frames.json',samples:'previews/motion/',standaloneArtStudy:'art-studies-offline.html'},evidence:['evidence/final-cold-open.json','evidence/final-offline-verification.json','evidence/final-motion-frames.json','evidence/final-reduced-motion.json','evidence/final-assembly-preservation.json','evidence/final-author-roundtrip-and-cold.json','evidence/u03-material-review.json','evidence/material-continuity.json','evidence/visual-acceptance.json'],limitations:['Owner visual sign-off pending','390px Chromium is not a physical device / Safari test','Audio trigger/state tested, not subjective loudspeaker listening','AI-generated specimen images are illustrations, not measured botany']};
 fs.writeFileSync(file('DELIVERY_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n','utf8');
 console.log(JSON.stringify({manifest:file('DELIVERY_MANIFEST.json'),core:manifest.core,screenCount:summary.motionFrames,docs:docs.length,links:checkLinks()},null,2));
}else if(mode==='--check'){
 const links=checkLinks();check(links.missing.length===0,'all documentation links');
 const m=read('DELIVERY_MANIFEST.json');
 for(const row of [m.core.glx,m.core.offlineHtml,...m.materials,...m.documentedSources,...m.editableSources,...m.featuredScreenshots]){
  const f=file(row.path);check(fs.existsSync(f),'listed '+row.path);check(fs.statSync(f).size===row.bytes&&digest(f)===row.sha256,'SHA '+row.path);
 }
 console.log(JSON.stringify({summary,links,manifestSha256:digest(file('DELIVERY_MANIFEST.json')),check:'PASS'},null,2));
}else throw Error('Unknown mode: '+mode);
