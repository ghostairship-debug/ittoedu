import test from 'node:test'

const scope = { kind: 'scope', reason: 'Separate product acceptance from investigation', reviewRef: 'decision.md', decisionRef: 'decision.md' };

test('purpose is part of the preserved contract, while legacy omitted purpose remains valid', t => {
  const f=fixture(t);
  f.ok('goal-audit');
  const criteria=f.ppt.criteria.map(c=>({...c,purpose:'capability'}));
  f.reject(/scope change/,'goals',f.write('purpose-without-scope.json',{goals:[{...f.ppt,criteria}]}));
  f.ok('goals',f.write('purpose-with-scope.json',{goals:[{...f.ppt,criteria,change:scope}]}));
  f.ok('goal-audit');
});

test('invalid explicit acceptance purposes are rejected atomically', t => {
  const f=fixture(t), before=f.state();
  for(const purpose of [null,'','investigated'])
    f.reject(/invalid acceptance purpose/,'goals',f.write('invalid-purpose.json',{goals:[{...f.ppt,criteria:f.ppt.criteria.map(c=>({...c,purpose})),change:scope}]}));
  assert.deepEqual(f.state(),before);
});

test('partial cannot hide an unrecorded product gap behind all verified conditions', t => {
  const f=fixture(t);
  f.write('preview.json',{passed:true,objectCoediting:true,savedAndColdOpened:true});
  const criteria=f.ppt.criteria.map(c=>({...c,status:'verified',evidence:[f.evidence('PPT.'+c.id,c.requires)]}));
  f.reject(/partial goal has no unfinished necessary condition/,'goals',f.write('all-verified-partial.json',{goals:[{...f.ppt,criteria}]}));
  f.ok('goals',f.write('actually-achieved.json',{goals:[{...f.ppt,status:'achieved',criteria}]}));
});

test('experiments and blocker reviews retain their results but cannot replace a required product condition', t => {
  const f=fixture(t);
  for(const purpose of ['experiment','blocker']){
    const criteria=f.ppt.criteria.map(c=>({...c,purpose}));
    f.reject(/required capability\/effect condition/,'goals',f.write('no-product.json',{goals:[{...f.ppt,criteria,change:scope}]}));
    f.reject(/required capability\/effect condition/,'goals',f.write('optional-product.json',{goals:[{...f.ppt,criteria:[criteria[0],{...criteria[1],purpose:'capability',required:false}],change:scope}]}));
  }
});

test('completed investigations and blockers leave a separately identified product capability pending', t => {
  const f=fixture(t);
  for(const purpose of ['experiment','blocker']){
    const criteria=[{...f.ppt.criteria[0],purpose,status:'verified',evidence:[f.evidence('PPT.preview')]},{...f.ppt.criteria[1],purpose:'capability'}];
    const result=f.ok('goals',f.write('honest-partial.json',{goals:[{...f.ppt,criteria,change:scope}]}));
    assert.deepEqual(result.goals.find(g=>g.id==='PPT').remaining.map(c=>({id:c.id,purpose:c.purpose})),[{id:'coedit',purpose:'capability'}]);
    f.reject(/every necessary condition/,'goals',f.write('investigation-is-not-product.json',{goals:[{id:'PPT',status:'achieved'}]}));
    f.reject(/acceptance scope/,'goals',f.write('relabel-old-evidence.json',{goals:[{id:'PPT',criteria:[criteria[0],{...criteria[1],status:'verified',evidence:[f.evidence('PPT.preview',['human-ai','save-cold'])]}]}]}));
  }
});

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const script = fileURLToPath(new URL('../execution-checkpoint.mjs', import.meta.url))
const hash = text => crypto.createHash('sha256').update(text).digest('hex')
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'guoling-goals-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const write = (name, content) => { fs.writeFileSync(path.join(root, name), typeof content === 'string' ? content : JSON.stringify(content)); return name }
  const call = (...args) => spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8', timeout: 15000, windowsHide: true })
  const ok = (...args) => { const r = call(...args); assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout) }
  const reject = (pattern, ...args) => { const r = call(...args); assert.ifError(r.error); assert.notEqual(r.status, 0, r.stdout); assert.match(r.stderr, pattern) }
  const file = path.join(root, 'docs/development-plan/EXECUTION_CHECKPOINT.json')
  const state = () => JSON.parse(fs.readFileSync(file, 'utf8'))
  write('plan.md', 'PPT preview AND human/AI object coediting remain required. Word preview also remains required.')
  write('artifact.pptx', 'current original package')
  write('decision.md', 'User explicitly chose to defer Word; independent reviewer checked original instruction.')
  write('preview.json', { passed: true, objectCoediting: false, numPassedTests: 2 })
  ok('init', 'goal-regression')
  ok('task', write('preview-task.json', { id: 'preview', status: 'in_progress', goalRefs: ['PPT'] }))
  ok('task', write('edit-task.json', { id: 'coedit', status: 'pending', goalRefs: ['PPT'] }))
  ok('task', write('word-task.json', { id: 'word', status: 'pending', goalRefs: ['WORD'] }))
  const ppt = { id: 'PPT', source: 'plan.md', promise: 'Preview and object coediting', kind: 'capability', status: 'partial',
    criteria: [{ id: 'preview', text: 'Formal preview', status: 'pending', requires: ['ui'], assertions: [{ kind: 'ui', pointer: '/passed', equals: true }], target: [{ path: 'artifact.pptx', sha256: hash('current original package') }] },
      { id: 'coedit', text: 'Human edit then AI edit, save and cold open', status: 'pending', requires: ['human-ai', 'save-cold'], assertions: [{ kind: 'human-ai', pointer: '/objectCoediting', equals: true }, { kind: 'save-cold', pointer: '/savedAndColdOpened', equals: true }], target: [{ path: 'artifact.pptx', sha256: hash('current original package') }] }],
    continuation: { disposition: 'active', taskIds: ['coedit'], action: 'Implement the second batch object editor.' } }
  const word = { id: 'WORD', source: 'plan.md', promise: 'Original Word paginated preview', kind: 'capability', status: 'unmet',
    criteria: [{ id: 'preview', text: 'Original page layout in formal UI', status: 'pending', requires: ['ui'] }],
    continuation: { disposition: 'later', taskIds: ['word'], action: 'Implement Word preview in D2.' } }
  ok('goals', write('seed.json', { authorizationRef: 'user-authorized-audit-plan', goals: [ppt, word] }))
  const evidence = (criterion, kinds = ['ui']) => ({ path: 'preview.json', sha256: hash(fs.readFileSync(path.join(root, 'preview.json'))),
    covers: [criterion], kinds, subjects: [{ path: 'artifact.pptx', sha256: hash('current original package') }] })
  return { root, write, ok, reject, state, file, ppt, word, evidence }
}

test('a verified preview stage retains coediting and Word goals; product closeout is rejected', t => {
  const f = fixture(t)
  f.ok('task', f.write('done.json', { id: 'preview', status: 'verified', evidence: ['preview.json'] }))
  const stage = f.ok('closeout', 'stage')
  assert.equal(stage.productComplete, false)
  assert.deepEqual(stage.incompleteGoalIds, ['PPT', 'WORD'])
  assert.equal(stage.goals[0].remaining.length, 2)
  f.reject(/remain incomplete/, 'closeout', 'product')
  assert.equal(f.state().goals.WORD.status, 'unmet')
})

test('readonly-only evidence cannot close human/AI object editing; failed update is atomic', t => {
  const f = fixture(t), before = f.state()
  const goals = { ...f.ppt, status: 'achieved', criteria: f.ppt.criteria.map(c => ({ ...c, status: 'verified', evidence: [f.evidence('PPT.' + c.id)] })) }
  f.reject(/missing human-ai/, 'goals', f.write('false-completion.json', { goals: [goals] }))
  assert.deepEqual(f.state(), before)
  f.reject(/missing evidence/, 'task', f.write('fake.json', { id: 'preview', status: 'verified', evidence: ['does-not-exist.json'] }))
})

test('required conditions cannot be removed as a clarification; direct deletion fails audit', t => {
  const f = fixture(t)
  const reduced = { ...f.ppt, criteria: [f.ppt.criteria[0]], change: { kind: 'clarification', reason: 'preview first', reviewRef: 'review.md' } }
  f.reject(/scope change/, 'goals', f.write('reduced.json', { goals: [reduced] }))
  const changed = f.state(); changed.goals.PPT.criteria.pop()
  fs.writeFileSync(f.file, JSON.stringify(changed))
  f.reject(/changed outside/, 'goal-audit')
})

test('a goal cannot disappear from the checkpoint and remaining work cannot point to a completed task', t => {
  const f = fixture(t), before = f.state()
  f.reject(/unfinished linked task/, 'task', f.write('close-edit.json', { id: 'coedit', status: 'verified', evidence: ['preview.json'] }))
  assert.deepEqual(f.state(), before)
  const edited = f.state(); delete edited.goals.WORD; fs.writeFileSync(f.file, JSON.stringify(edited))
  f.reject(/goal set changed/, 'goal-audit')
})

test('test counts and source/build identity are checked from real bytes, not the receipt label', t => {
  const f = fixture(t)
  f.write('preview.json', { passed: true, numPassedTests: 0 })
  let ev = { ...f.evidence('PPT.preview', ['ui', 'test']), checks: [{ pointer: '/passed', equals: true }, { pointer: '/numPassedTests', gte: 1 }] }
  let patch = { ...f.ppt, criteria: [{ ...f.ppt.criteria[0], status: 'verified', evidence: [ev] }, f.ppt.criteria[1]] }
  f.reject(/result count failed/, 'goals', f.write('zero.json', { goals: [patch] }))
  f.write('preview.json', { passed: true, numPassedTests: 2 }); ev = { ...f.evidence('PPT.preview'), kinds: ['ui', 'package'] }
  f.write('artifact.pptx', 'newer source/build')
  patch.criteria[0].evidence = [ev]
  f.reject(/tested subject changed/, 'goals', f.write('old-build.json', { goals: [patch] }))
})

test('explicit later work and authorized deferral permit honest stage completion', t => {
  const f = fixture(t)
  f.ok('task', f.write('followup.json', { id: 'coedit-next', status: 'pending', goalRefs: ['PPT'] }))
  f.ok('goals', f.write('next.json', { goals: [{ id: 'PPT', continuation: { disposition: 'later', taskIds: ['coedit-next'], action: 'Next object-editing increment.' } }] }))
  f.ok('task', f.write('done.json', { id: 'coedit', status: 'verified', evidence: ['preview.json'] }))
  const deferred = { id: 'WORD', status: 'deferred', continuation: { disposition: 'authorized-defer', action: 'Resume on the explicit agreed condition.' },
    change: { kind: 'scope', reason: 'User chose to postpone', reviewRef: 'decision.md', decisionRef: 'decision.md' } }
  f.reject(/deferral requires/, 'goals', f.write('missing-decision.json', { goals: [deferred] }))
  f.ok('goals', f.write('defer.json', { goals: [{ ...deferred, decisionRef: 'decision.md' }] }))
  const result = f.ok('closeout', 'stage')
  assert.equal(result.productComplete, false)
  assert.equal(result.goals.find(g => g.id === 'WORD').status, 'deferred')
})

test('a normal merge cannot legitimize an already missing goal', t => {
  const f = fixture(t), changed = f.state(); delete changed.goals.WORD
  fs.writeFileSync(f.file, JSON.stringify(changed))
  f.reject(/goal set changed/, 'goals', f.write('update.json', { goals: [{ id: 'PPT', status: 'partial' }] }))
})

test('labeling readonly evidence as human/AI cannot override the fixed predicate', t => {
  const f = fixture(t)
  const changed = { ...f.ppt, criteria: [f.ppt.criteria[0], { ...f.ppt.criteria[1], status: 'verified', evidence: [f.evidence('PPT.coedit', ['human-ai', 'save-cold'])] }] }
  f.reject(/result assertion failed/, 'goals', f.write('false-labels.json', { goals: [changed] }))
})

test('an unchanged older package at another path cannot prove the selected current package', t => {
  const f = fixture(t)
  f.write('older-package.pptx', 'old package left on disk')
  const ev = f.evidence('PPT.preview')
  ev.subjects = [{ path: 'older-package.pptx', sha256: hash('old package left on disk') }]
  const changed = { ...f.ppt, criteria: [{ ...f.ppt.criteria[0], status: 'verified', evidence: [ev] }, f.ppt.criteria[1]] }
  f.reject(/different acceptance target/, 'goals', f.write('old-package.json', { goals: [changed] }))
})

test('ordinary task progress is not blocked by unrelated historical evidence becoming stale', t => {
  const f = fixture(t)
  f.ok('goals', f.write('accepted-preview.json', { goals: [{ ...f.ppt, criteria: [{ ...f.ppt.criteria[0], status: 'verified', evidence: [f.evidence('PPT.preview')] }, f.ppt.criteria[1]] }] }))
  f.write('artifact.pptx', 'updated for the next increment')
  f.ok('task', f.write('continue-word.json', { id: 'word', status: 'in_progress' }))
  f.reject(/subject changed/, 'goal-audit')
})
