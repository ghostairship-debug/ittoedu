import {readFile} from 'node:fs/promises';
import {runCourseAgentCapabilityQuery} from "./query-core.mjs";
const data=JSON.parse(await readFile(new URL('./discovery-data.json',import.meta.url),'utf8'));
try {const result=runCourseAgentCapabilityQuery(data,process.argv.slice(2));console.log(typeof result==='string'?result:JSON.stringify(result,null,2));}catch(error){console.error(error.message);process.exitCode=1;}
