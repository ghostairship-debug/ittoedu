import {build} from 'esbuild';import {promises as fs} from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
const root=path.resolve('output/comprehensive-execution-20261101/creation'),src=path.join(root,'workspace/lighthouse');
const bundle=await build({entryPoints:[path.join(src,'lighthouse.js')],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',sourcemap:false,minify:false});
const original=await fs.readFile(path.join(src,'index.html'),'utf8'),code=bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
const html=original.replace('<script type="module" src="./lighthouse.js"></script>','<script>'+code+'</script>');
const output=path.join(root,'baseline/lighthouse-standalone.html');await fs.writeFile(output,html);
const metadata={builtAt:new Date().toISOString(),sourceFiles:['index.html','lighthouse.js','scenario.js'],route:'Generic esbuild IIFE + authored HTML; no Guoling compiler/player/export code used',output,bytes:Buffer.byteLength(html),sha256:createHash('sha256').update(html).digest('hex')};
await fs.writeFile(path.join(root,'baseline/lighthouse-build.json'),JSON.stringify(metadata,null,2));console.log(JSON.stringify(metadata));

