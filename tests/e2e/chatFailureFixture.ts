import { copyFileSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'

/** Deterministic failure injection through the real process, IPC, chat and candidate gate. Not a provider benchmark. */
export async function installChatFailureFixture(app: ElectronApplication, runRoot: string) {
  const directory = join(runRoot, 'chat-fixture')
  const root = join(directory, 'node_modules', '@openai', 'codex')
  mkdirSync(root, { recursive: true })
  copyFileSync(process.execPath, join(directory, 'node.exe'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ bin: { codex: 'cli.js' } }))
  writeFileSync(join(root, 'cli.js'), `
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
if (process.argv.includes('--version')) { console.log('0.153.0'); process.exit(0); }
if (process.argv.includes('login')) { console.log('Logged in using ChatGPT'); process.exit(0); }
const send = value => console.log(JSON.stringify(value));
const output = value => {
 if(value.type === 'thread.started') return;
 if(value.type === 'turn.completed') { send({method:'turn/completed',params:{threadId:'fixture-session',turn:{id:'turn',status:'completed',error:null}}});return; }
 const types={agent_message:'agentMessage',command_execution:'commandExecution'};
 send({method:value.type === 'item.started'?'item/started':'item/completed',params:{threadId:'fixture-session',turnId:'turn',item:{...value.item,type:types[value.item.type]}}});
};
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
 const rpc=JSON.parse(line);
 if(rpc.method==='initialize') {send({id:rpc.id,result:{}});return;}
 if(rpc.method==='initialized') return;
 if(rpc.method==='thread/start'||rpc.method==='thread/resume') {send({id:rpc.id,result:{thread:{id:'fixture-session'}}});return;}
 if(rpc.method!=='turn/start') return;
 send({id:rpc.id,result:{turn:{id:'turn'}}});
 const prompt=rpc.params.input[0].text;
 const request = JSON.parse(prompt.trim().split('\\n').findLast(line => line.startsWith('{') && line.includes('"documentRevision"')));
 const root = ${JSON.stringify(directory)};
 const mode = fs.readFileSync(path.join(root, 'mode.txt'), 'utf8');
 fs.appendFileSync(path.join(root, 'runs.jsonl'), JSON.stringify({ requestId: request.requestId, revision: request.documentRevision, repair: !!request.context.repair }) + '\\n');
 output({ type: 'thread.started', thread_id: 'fixture-session' });
 const finish = () => {
   if (mode === 'discussion') {
     for (let index = 0; index < 105; index++) {
       const item = { id: 'read-' + index, type: 'command_execution', command: 'read fixture', aggregated_output: 'ordinary tool output, not a course commit', exit_code: 0 };
       output({ type: 'item.started', item }); output({ type: 'item.completed', item });
     }
     output({ type: 'item.completed', item: { id: 'discussion', type: 'agent_message', text: '## 只讨论，不修改课件\\n- 平均分是分数的前提。\\n<script>window.__unsafeChatExecuted=true</script>\\n![remote](https://invalid.example/probe.png)\\n[jump](javascript:alert(1))' } });
     output({ type: 'turn.completed', usage: {} }); return;
   }
   const bad = mode === 'no-progress' || mode === 'repair' && !request.context.repair;
   const candidate = { version: 1, requestId: request.requestId, candidateId: crypto.randomUUID(), summary: '测试讲解文字',
     steps: [{ id: 's1', tool: 'native.content', carrier: 'native', destination: request.destinations.find(value => value.kind === 'create' && value.scope.owner !== 'global'),
       input: { operation: 'insert', template: { nativeType: bad ? 'unsupported' : 'text', text: '平均分的含义' } } }] };
   let resultText = '<courseware-candidate-v1>' + JSON.stringify(candidate) + '</courseware-candidate-v1>';
   if (mode === 'format-repeat' || mode === 'format-repair' && !request.repair) resultText = '<courseware-candidate-v1>{"invalid": unquoted}</courseware-candidate-v1>';
   if (mode === 'missing-candidate' && !request.repair) resultText = '<courseware-result-v1>' + JSON.stringify({version:1,requestId:request.requestId,kind:'edit'}) + '</courseware-result-v1>';
   output({ type: 'item.completed', item: { id: 'answer', type: 'agent_message', text: resultText } });
   output({ type: 'turn.completed', usage: {} });
 };
 if (mode === 'discussion') send({method:'item/agentMessage/delta',params:{threadId:'fixture-session',itemId:'discussion',delta:'## 只讨论，不修改课件\\n'}});
 setTimeout(finish, mode === 'delayed' ? 2500 : mode === 'discussion' ? 2000 : 0);
});
`)
  await app.evaluate((_, root) => {
    const state = globalThis as typeof globalThis & { chatFixtureEnvironment?: Record<string, string | undefined> }
    state.chatFixtureEnvironment = Object.fromEntries(['PATH', 'APPDATA', 'USERPROFILE'].map(key => [key, process.env[key]]))
    process.env.PATH = root; process.env.APPDATA = root; process.env.USERPROFILE = root
  }, directory)
  return {
    mode(value: 'repair' | 'no-progress' | 'delayed' | 'discussion' | 'format-repair' | 'format-repeat' | 'missing-candidate') { writeFileSync(join(directory, 'mode.txt'), value) },
    runs() { const file = join(directory, 'runs.jsonl'); return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { requestId: string; revision: number; repair: boolean }) : [] },
    async restore() {
      await app.evaluate(() => {
        const state = globalThis as typeof globalThis & { chatFixtureEnvironment?: Record<string, string | undefined> }
        for (const [key, value] of Object.entries(state.chatFixtureEnvironment ?? {})) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
        delete state.chatFixtureEnvironment
      })
    },
  }
}
