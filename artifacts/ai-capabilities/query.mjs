import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {runCourseAgentCapabilityQuery} from "./query-core.mjs";
const data=JSON.parse(await readFile(new URL('./discovery-data.json',import.meta.url),'utf8'));
data.files=new Proxy({}, {get:(_target,name)=>typeof name==='string' && data.resourcePaths.includes(name) ? readFileSync(new URL(name,import.meta.url),'utf8') : undefined});
try {const result=runCourseAgentCapabilityQuery(data,process.argv.slice(2));console.log(typeof result==='string'?result:JSON.stringify(result,null,2));}catch(error){console.error(error.message);process.exitCode=1;}
