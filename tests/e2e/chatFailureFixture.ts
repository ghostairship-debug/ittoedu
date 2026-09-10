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
  writeFileSync(join(root, 'cli.js'), String.raw`
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
if (process.argv.includes('--version')) { console.log('0.153.0'); process.exit(0); }
if (process.argv.includes('login')) { console.log('Logged in using ChatGPT'); process.exit(0); }
const send = value => console.log(JSON.stringify(value));
const model = 'fixture-model';
let threadId, turnId;
const notify = (method, params) => send({method, params:{threadId, ...params}});
const item = (method, value) => notify(method, {turnId, item:value});
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
 const rpc=JSON.parse(line);
 if(rpc.method==='initialize') {send({id:rpc.id,result:{userAgent:'codex/0.153.0'}});return;}
 if(rpc.method==='model/list') {send({id:rpc.id,result:{data:[{id:model,model,displayName:model,isDefault:true,inputModalities:['text','image'],supportedReasoningEfforts:[{reasoningEffort:'medium'}],defaultReasoningEffort:'medium'}]}});return;}
 if(rpc.method==='initialized') return;
 if(rpc.method==='thread/start'||rpc.method==='thread/resume') {
   threadId = rpc.method === 'thread/resume' ? rpc.params.threadId : 'fixture-session-' + crypto.randomUUID();
   send({id:rpc.id,result:{thread:{id:threadId},model,reasoningEffort:'medium'}});return;
 }
 if(rpc.method==='thread/read') {send({id:rpc.id,result:{thread:{id:threadId,model,reasoningEffort:'medium'}}});return;}
 if(rpc.method==='turn/interrupt') {send({id:rpc.id,result:{}});notify('turn/completed',{turn:{id:turnId,status:'interrupted'}});return;}
 if(rpc.method!=='turn/start') return;
 turnId = 'fixture-turn-' + crypto.randomUUID();
 send({id:rpc.id,result:{turn:{id:turnId}}});
 notify('turn/started', {turn:{id:turnId}});
 const candidateRoot = process.env.COURSEWARE_CANDIDATE_ROOT;
 if (!candidateRoot) throw new Error('Fixture requires the formal candidate root');
 const request = JSON.parse(fs.readFileSync(path.join(candidateRoot, 'request.json'), 'utf8'));
 const lines = rpc.params.input.find(value => value.type === 'text').text.split('\n');
 const feedbackIndex = lines.indexOf('宿主已完成上一阶段。下列是正式结果，不是CLI自述：');
 const feedback = feedbackIndex < 0 ? null : JSON.parse(lines[feedbackIndex + 1]);
 const repair = feedback?.status === 'rejected';
 const root = ${JSON.stringify(directory)};
 const mode = fs.readFileSync(path.join(root, 'mode.txt'), 'utf8');
 const injection = mode === 'format-repeat' ? repair ? 'missing-channel' : 'invalid-json'
   : mode === 'format-repair' && !repair ? 'invalid-json' : mode === 'missing-candidate' && !repair ? 'missing-channel' : null;
 fs.appendFileSync(path.join(root, 'runs.jsonl'), JSON.stringify({ requestId: request.requestId, revision: request.documentRevision, repair,
   previousRequestId: feedback?.requestId ?? null, nativeThreadId: threadId, nativeTurnId: turnId, mode, injection,
   lateAt: mode === 'delayed' ? Date.now() + 2500 : null }) + '\n');
 const finishResult = result => {
   item('item/completed', {id:mode === 'discussion' ? 'discussion' : 'answer',type:'agentMessage',phase:'final_answer',text:JSON.stringify(result)});
   notify('turn/completed', {turn:{id:turnId,status:'completed',error:null}});
 };
 const reply = text => finishResult({version:1,requestId:request.requestId,kind:'reply',reply:text,candidate:null});
 const finish = () => {
   if (mode === 'discussion') {
     for (let index = 0; index < 105; index++) {
       const tool = { id: 'read-' + index, type: 'commandExecution', command: 'read fixture', aggregatedOutput: 'ordinary tool output, not a course commit', exitCode: 0 };
       item('item/started', tool); item('item/completed', tool);
     }
     reply('## 只讨论，不修改课件\n- 平均分是分数的前提。\n<script>window.__unsafeChatExecuted=true</script>\n![remote](https://invalid.example/probe.png)\n[jump](javascript:alert(1))'); return;
   }
   // Keep the native envelope valid: these negative replies exercise the host's
   // existing candidate parser and shared format budget, not a transport crash.
   if (injection === 'invalid-json') { reply('<courseware-candidate-v1>{"invalid": unquoted}</courseware-candidate-v1>'); return; }
   if (injection === 'missing-channel') { reply('<courseware-result-v1>' + JSON.stringify({version:1,requestId:request.requestId,kind:'edit'}) + '</courseware-result-v1>'); return; }
   const bad = mode === 'no-progress' || mode === 'repair' && !repair;
   const destination = Object.entries(request.destinationAliases).find(([, value]) => value.kind === 'create' && value.scope.owner !== 'global')?.[0];
   if (!destination) throw new Error('Fixture needs an authorized create destination');
   const candidate = {version:2, requestId:request.requestId, summary:'测试讲解文字', afterCommit:{version:1,action:'finish'},
     steps:[{id:'s1',tool:'native.content',destination,lowerCarrierReason:null,
       input:JSON.stringify({operation:'insert',template:{nativeType:bad?'unsupported':'text',text:'平均分的含义'}})}]};
   finishResult(request.expectedResult === 'candidate' ? candidate : {version:1,requestId:request.requestId,kind:'edit',reply:null,candidate});
 };
 if (mode === 'discussion') {
   notify('item/agentMessage/delta',{turnId,itemId:'discussion',delta:'## 只讨论，'});
   notify('item/agentMessage/delta',{turnId,itemId:'discussion',delta:'不修改课件\n'});
 }
 setTimeout(finish, mode === 'delayed' ? 2500 : mode === 'discussion' ? 2000 : 0);
});
process.stdin.on('end', () => process.exit(0));
`)
  await app.evaluate((_, root) => {
    const state = globalThis as typeof globalThis & { chatFixtureEnvironment?: Record<string, string | undefined> }
    state.chatFixtureEnvironment = Object.fromEntries(['PATH', 'APPDATA', 'USERPROFILE'].map(key => [key, process.env[key]]))
    process.env.PATH = root; process.env.APPDATA = root; process.env.USERPROFILE = root
  }, directory)
  return {
    mode(value: 'repair' | 'no-progress' | 'delayed' | 'discussion' | 'format-repair' | 'format-repeat' | 'missing-candidate') { writeFileSync(join(directory, 'mode.txt'), value) },
    runs() { const file = join(directory, 'runs.jsonl'); return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line) as {
      requestId: string; revision: number; repair: boolean; previousRequestId: string | null; nativeThreadId: string; nativeTurnId: string;
      mode: string; injection: 'invalid-json' | 'missing-channel' | null; lateAt: number | null;
    }) : [] },
    async restore() {
      await app.evaluate(() => {
        const state = globalThis as typeof globalThis & { chatFixtureEnvironment?: Record<string, string | undefined> }
        for (const [key, value] of Object.entries(state.chatFixtureEnvironment ?? {})) { if (value === undefined) delete process.env[key]; else process.env[key] = value }
        delete state.chatFixtureEnvironment
      })
    },
  }
}
