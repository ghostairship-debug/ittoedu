import{spawn}from'node:child_process';import fs from'node:fs';import path from'node:path';
const executable=path.resolve(process.argv[2]??'');if(!fs.existsSync(executable)||!executable.endsWith('.exe'))throw Error('Explicit existing packaged executable required');
const args=process.argv.slice(3);if(!args.length)throw Error('Explicit Playwright test arguments required');
const env={...process.env,COURSEWARE_E2E_PACKAGED_EXECUTABLE:executable};delete env.ELECTRON_RUN_AS_NODE;
console.log(JSON.stringify({kind:'packaged-playwright-launch',executable,args,at:new Date().toISOString(),environmentBinding:'direct spawn env; no cmd set quoting'}));
const child=spawn(process.execPath,['node_modules/@playwright/test/cli.js',...args],{cwd:process.cwd(),env,stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error);process.exitCode=1});child.on('exit',(code,signal)=>{process.exitCode=code??1;console.log(JSON.stringify({childExit:code,signal}))});
