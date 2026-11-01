import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { runPythonProcess } from '../../src/main/workbench/compute/nativePythonProcess.ts';

const directory = path.resolve(process.argv[2]);
const executable = process.argv[3];
assert.ok(executable, 'pass an existing Python executable; this diagnostic must not install Python');
fs.mkdirSync(directory, { recursive: true });
const token = 'owned-pipe-' + Date.now();
const receiptPath = path.join(directory, token + '-pids.json');
const lifecyclePath = path.join(directory, token + '-descendant.json');
const controller = new AbortController();
const startedAt = new Date().toISOString();
// Use the production consumer, not a Node parent whose Windows child-job cleanup
// can end its descendant before inherited-pipe cancellation can be observed.
const descendantSource = `import json,os,time\nfrom pathlib import Path\nfrom datetime import datetime,timezone\np=Path(${JSON.stringify(lifecyclePath)})\nvalue=dict(pid=os.getpid(),startedAt=datetime.now(timezone.utc).isoformat())\np.write_text(json.dumps(value),encoding='utf-8')\ntime.sleep(4)\nvalue['finishedAt']=datetime.now(timezone.utc).isoformat()\np.write_text(json.dumps(value),encoding='utf-8')`;
const parentSource = `import json,os,subprocess,sys,time\nfrom pathlib import Path\nc=subprocess.Popen([sys.executable,'-E','-X','utf8','-u','-c',${JSON.stringify(descendantSource)}],stdin=subprocess.DEVNULL)\ndeadline=time.monotonic()+1.5\nwhile not Path(${JSON.stringify(lifecyclePath)}).exists() and time.monotonic()<deadline:\n time.sleep(.01)\nready=Path(${JSON.stringify(lifecyclePath)}).exists()\nPath(${JSON.stringify(receiptPath)}).write_text(json.dumps(dict(parent=os.getpid(),descendant=c.pid,token=${JSON.stringify(token)},descendantStarted=ready)),encoding='utf-8')\nprint('owned parent exits',flush=True)\nsys.exit(0)`;
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
let stopConfirmed = null;
const observed = runPythonProcess(executable, ['-E', '-X', 'utf8', '-u', '-c', parentSource], {
  signal: controller.signal, onStop: confirmed => { stopConfirmed = confirmed; },
})
  .then(value => ({ kind: 'result', ...value }), error => ({ kind: 'error', name: error.name, message: error.message }));
const sample = async milliseconds => {
  let timer;
  try { return await Promise.race([observed, new Promise(resolve => { timer = setTimeout(() => resolve({ kind: 'pending' }), milliseconds); })]); }
  finally { clearTimeout(timer); }
};
let receipt;
const result = { kind: 'windows-owned-inherited-pipe-classification', startedAt, runtime: { node: process.version, platform: process.platform, os: os.release(), python: executable }, processWrites: 'only dedicated evidence files', descendantSelfExitMs: 4000 };
try {
  for (let n = 0; n < 60 && !receipt; n++) {
    if (fs.existsSync(receiptPath)) receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
    if (!receipt) await delay(50);
  }
  assert.ok(receipt, 'owned parent PID receipt missing');
  assert.equal(receipt.token, token);
  result.receipt = receipt;
  for (let n = 0; n < 40 && alive(receipt.parent); n++) await delay(50);
  result.parentAliveBeforeAbort = alive(receipt.parent);
  result.descendantAliveBeforeAbort = alive(receipt.descendant);
  result.beforeAbort = await sample(200);
  result.abortAt = new Date().toISOString();
  controller.abort();
  result.afterAbort = await sample(300);
  result.stopConfirmed = stopConfirmed;
  result.descendantAliveAfterAbort = alive(receipt.descendant);
  result.afterSelfExit = await sample(7000);
  for (let n = 0; n < 120 && alive(receipt.descendant); n++) await delay(50);
  result.descendantLifecycle = fs.existsSync(lifecyclePath) ? JSON.parse(fs.readFileSync(lifecyclePath, 'utf8')) : null;
  result.parentAliveAtEnd = alive(receipt.parent);
  result.descendantAliveAtEnd = alive(receipt.descendant);
  result.preconditionEstablished = receipt.descendantStarted === true && result.parentAliveBeforeAbort === false && result.descendantAliveBeforeAbort === true && result.beforeAbort.kind === 'pending';
  result.fixtureCompletedNormally = result.descendantAliveAtEnd === false && Boolean(result.descendantLifecycle?.finishedAt) && result.afterSelfExit.kind !== 'pending';
  result.reproduced = result.preconditionEstablished && result.afterAbort.kind === 'pending' && result.descendantAliveAfterAbort === true;
  result.status = !result.preconditionEstablished || !result.fixtureCompletedNormally ? 'fixture-unproven-no-product-verdict' : result.reproduced ? 'windows-runner-defect-reproduced-not-fixed' : result.afterAbort.kind === 'error' && result.afterAbort.name === 'AbortError' ? 'windows-runner-cancellation-settled' : 'not-reproduced-in-this-runtime';
} catch (error) {
  result.status = 'diagnostic-failed';
  result.error = error.stack || String(error);
  process.exitCode = 1;
} finally {
  controller.abort();
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify(result));

