const fs=require('fs'),path=require('path');
const sharp=require(require.resolve('sharp',{paths:[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()]}));
const root=__dirname;
const files={green:'exec-c8d38886-c285-4146-a326-a502d1196743.png',gold:'exec-c1703f45-ebf8-458a-8d7e-07523b43846b.png',roast:'exec-78f5140f-da94-4588-97f1-9920448ce523.png',cup:'exec-ebd6f46b-cc3e-40ef-846a-91b359b17e24.png',cherry:'exec-e608041a-d1bb-434d-9a76-cfe678078175.png',section:'exec-e4db4e86-84ba-4c12-8699-462c5a9c68d8.png'};
(async()=>{
 const manifest={generated:'2026-10-23',method:'ImageGen transparent photographic material assets; original alpha retained',assets:{}};
 for(const [key,file]of Object.entries(files)){
  const source=path.join(root,'assets/source',key+'.png');
  if(!fs.existsSync(source))fs.copyFileSync(path.resolve(root,'../generated_images',file),source);
  const meta=await sharp(source).metadata();
  const output=path.join(root,'assets/runtime',key+'.webp');
  await sharp(source).resize({width:900,withoutEnlargement:true}).webp({quality:92,alphaQuality:100,effort:6}).toFile(output);
  manifest.assets[key]={source:'assets/source/'+key+'.png',runtime:'assets/runtime/'+key+'.webp',width:meta.width,height:meta.height,hasAlpha:meta.hasAlpha,sourceBytes:fs.statSync(source).size,runtimeBytes:fs.statSync(output).size};
 }
 fs.writeFileSync(path.join(root,'assets/manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest,null,2));
})().catch(e=>{console.error(e);process.exit(1)});
