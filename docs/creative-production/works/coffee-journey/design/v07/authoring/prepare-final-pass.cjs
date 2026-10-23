'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=path.resolve(__dirname,'..'),root=path.resolve(base,'../../../../../..');
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const runtime=path.join(__dirname,'runtime-snapshot');
if(!fs.existsSync(path.join(runtime,'package.json'))){
 fs.mkdirSync(runtime,{recursive:true});
 for(const d of ['dist-electron','dist-renderer','resources','.agents'])if(fs.existsSync(path.join(root,d)))fs.cpSync(path.join(root,d),path.join(runtime,d),{recursive:true});
 fs.copyFileSync(path.join(root,'package.json'),path.join(runtime,'package.json'));
 fs.symlinkSync(path.join(root,'node_modules'),path.join(runtime,'node_modules'),'junction');
}
const provenance={capturedAt:new Date().toISOString(),root,runtime,main:hash(path.join(runtime,'dist-electron/main/index.js')),renderer:hash(path.join(runtime,'dist-renderer/index.html')),v06:hash(path.join(base,'../v06/native/coffee-journey-v06.glx')),v07Before:hash(path.join(base,'native/coffee-journey-v07.glx'))};
fs.writeFileSync(path.join(base,'evidence/final-pass-baseline.json'),JSON.stringify(provenance,null,2));
const backup=path.join(base,'authoring/before-final-pass');fs.mkdirSync(backup,{recursive:true});
for(const f of ['background-runtime.js','background-entry.js','background-assets.css'])if(!fs.existsSync(path.join(backup,f)))fs.copyFileSync(path.join(base,f),path.join(backup,f));
if(!fs.existsSync(path.join(backup,'coffee-journey-v07-r205.glx')))fs.copyFileSync(path.join(base,'native/coffee-journey-v07.glx'),path.join(backup,'coffee-journey-v07-r205.glx'));
const u03=path.join(base,'programs/u03');if(!fs.existsSync(u03))fs.cpSync(path.join(base,'../v06/programs/u03'),u03,{recursive:true});
console.log(JSON.stringify(provenance,null,2));