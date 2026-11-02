import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const statuses = new Set(['achieved', 'partial', 'unmet', 'unverified', 'deferred', 'decision'])
const dispositions = new Set(['active', 'later', 'blocked', 'decision', 'authorized-defer'])
const digest = value => crypto.createHash('sha256').update(value).digest('hex')
const nonempty = value => typeof value === 'string' && value.trim().length > 0
const fail = message => { throw new Error('Goal guard: ' + message) }

function file(root, reference) {
  if (!nonempty(reference)) fail('evidence/source path is required')
  const resolved = path.resolve(root, reference)
  const relative = path.relative(root, resolved)
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) fail('reference must be inside the workspace: ' + reference)
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) fail('missing evidence/source file: ' + reference)
  return resolved
}

export function requireTaskEvidence(root, evidence) {
  if (!Array.isArray(evidence) || !evidence.length) fail('verified task requires evidence')
  for (const reference of evidence) file(root, typeof reference === 'string' ? reference : reference.path)
}

function contract(goal) {
  return { source: goal.source, promise: goal.promise, kind: goal.kind,
    criteria: goal.criteria.map(({ id, text, required = true, requires, assertions, reviewRequired }) => ({ id, text, required, requires, assertions, reviewRequired })) }
}
function contractHash(goal) { return digest(JSON.stringify(contract(goal))) }

function checkEvidence(root, goal, criterion, evidence) {
  const name = goal.id + '.' + criterion.id
  if (!evidence || !Array.isArray(evidence.kinds) || !evidence.kinds.length
      || !Array.isArray(evidence.covers) || !evidence.covers.includes(name)) fail(name + ': evidence does not declare its acceptance scope')
  const bytes = fs.readFileSync(file(root, evidence.path))
  if (!/^[a-f0-9]{64}$/.test(evidence.sha256 ?? '') || digest(bytes) !== evidence.sha256) fail(name + ': evidence identity changed')
  if (!Array.isArray(evidence.subjects) || !evidence.subjects.length) fail(name + ': evidence must identify the tested source/build/artifact')
  for (const subject of evidence.subjects) {
    if (!/^[a-f0-9]{64}$/.test(subject.sha256 ?? '') || digest(fs.readFileSync(file(root, subject.path))) !== subject.sha256) fail(name + ': tested subject changed: ' + subject.path)
  }
  if (!Array.isArray(criterion.target) || !criterion.target.length) fail(name + ': current acceptance target is required')
  for (const expected of criterion.target) {
    if (!evidence.subjects.some(subject => subject.path === expected.path && subject.sha256 === expected.sha256)) fail(name + ': evidence belongs to a different acceptance target')
  }
  const requiredChecks = (criterion.assertions ?? []).filter(check => evidence.kinds.includes(check.kind))
  if (criterion.reviewRequired) {
    if (!evidence.review?.path || !evidence.review.sha256 || digest(fs.readFileSync(file(root, evidence.review.path))) !== evidence.review.sha256) fail(name + ': independent acceptance review is missing or changed')
  }
  const checks = [...requiredChecks, ...(evidence.checks ?? [])]
  // Required predicates belong to the preserved goal contract, not the evidence submitter.
  if (checks.length) {
    let result
    try { result = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')) } catch { fail(name + ': structured checks need a JSON receipt') }
    for (const check of checks) {
      if (!nonempty(check.pointer) || !check.pointer.startsWith('/')) fail(name + ': invalid result pointer')
      const value = check.pointer.slice(1).split('/').reduce((v, key) => v?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], result)
      if ('equals' in check && JSON.stringify(value) !== JSON.stringify(check.equals)) fail(name + ': result assertion failed: ' + check.pointer)
      if ('gte' in check && !(typeof value === 'number' && Number.isFinite(value) && value >= check.gte)) fail(name + ': result count failed: ' + check.pointer)
      if (!('equals' in check) && !('gte' in check)) fail(name + ': empty result assertion')
    }
  }
  if (evidence.kinds.includes('test') && !checks.length) fail(name + ': automated test evidence needs actual result assertions')
  return evidence.kinds
}

export function goalSummary(state) {
  const goals = Object.values(state.goals ?? {})
  return { goals: goals.map(goal => ({ id: goal.id, promise: goal.promise, kind: goal.kind, status: goal.status,
    remaining: goal.criteria.filter(c => c.required !== false && c.status !== 'verified').map(c => ({ id: c.id, text: c.text })),
    continuation: goal.continuation, decisionRef: goal.decisionRef })),
    productComplete: goals.length > 0 && goals.every(goal => goal.status === 'achieved'),
    incompleteGoalIds: goals.filter(goal => goal.status !== 'achieved').map(goal => goal.id) }
}

function validateIntegrity(state) {
  if (!state.goals) { if (state.goalSetHash) fail('initialized goals were removed'); return }
  if (state.goalSetHash !== digest(JSON.stringify(Object.keys(state.goals).sort()))) fail('goal set changed outside the additive goal update path')
  for (const [id, goal] of Object.entries(state.goals)) {
    if (goal.contractHash !== contractHash(goal)) fail(id + ': promise/criteria changed outside the goal update path')
  }
}

export function validateGoals(state, root, options = {}) {
  validateIntegrity(state)
  if (!state.goals) { if (state.goalSetHash) fail('initialized goals were removed'); return goalSummary(state) }
  if (state.goalSetHash !== digest(JSON.stringify(Object.keys(state.goals).sort()))) fail('goal set changed outside the additive goal update path')
  if (!Object.keys(state.goals).length) fail('initialized goal set cannot be empty')
  for (const [id, goal] of Object.entries(state.goals)) {
    if (goal.id !== id || !nonempty(goal.promise) || !nonempty(goal.source) || !['capability', 'effect'].includes(goal.kind) || !statuses.has(goal.status)) fail(id + ': invalid goal')
    file(root, goal.source.split('#')[0])
    if (!Array.isArray(goal.criteria) || !goal.criteria.length) fail(id + ': acceptance criteria required')
    if (new Set(goal.criteria.map(c => c.id)).size !== goal.criteria.length) fail(id + ': duplicate criteria')
    for (const c of goal.criteria) {
      if (!nonempty(c.id) || !nonempty(c.text) || !['pending', 'verified'].includes(c.status)
          || !Array.isArray(c.requires) || !c.requires.length) fail(id + ': invalid acceptance condition')
      if (c.status === 'verified') {
        if (!Array.isArray(c.evidence) || !c.evidence.length) fail(id + '.' + c.id + ': verified condition needs evidence')
        if (!c.assertions?.length && !c.reviewRequired) fail(id + '.' + c.id + ': acceptance contract needs fixed assertions or an independent review')
        const strict = options.evidence !== false && (!options.only || options.only.includes(id))
        const kinds = new Set(c.evidence.flatMap(e => strict ? checkEvidence(root, goal, c, e) : e.kinds ?? []))
        for (const kind of c.requires) {
          if (!kinds.has(kind)) fail(id + '.' + c.id + ': missing ' + kind + ' acceptance evidence')
          if (!c.reviewRequired && !c.assertions.some(check => check.kind === kind)) fail(id + '.' + c.id + ': required evidence kind has no fixed acceptance predicate: ' + kind)
        }
      }
    }
    if (goal.status === 'achieved') {
      if (goal.criteria.some(c => c.required !== false && c.status !== 'verified')) fail(id + ': product completion requires every necessary condition')
    } else {
      const next = goal.continuation
      if (!next || !dispositions.has(next.disposition) || !nonempty(next.action)) fail(id + ': unfinished goal has no continuation')
      if (['active', 'later'].includes(next.disposition)) {
        if (!Array.isArray(next.taskIds) || !next.taskIds.length) fail(id + ': continuation needs a task')
        for (const taskId of next.taskIds) {
          const task = state.tasks[taskId]
          if (!task || !task.goalRefs?.includes(id)) fail(id + ': continuation references an unknown or unrelated task: ' + taskId)
        }
        if (!next.taskIds.some(taskId => state.tasks[taskId].status !== 'verified')) fail(id + ': continuation must name an unfinished linked task')
      }
      if (['blocked', 'decision'].includes(next.disposition) && !nonempty(next.reason)) fail(id + ': concrete blocker/decision required')
      if (goal.status === 'deferred' || next.disposition === 'authorized-defer') {
        if (!nonempty(goal.decisionRef)) fail(id + ': deferral requires a user decision reference')
      }
    }
  }
  return goalSummary(state)
}

export function mergeGoals(state, input, root) {
  validateIntegrity(state)
  if (!Array.isArray(input.goals) || !input.goals.length) fail('goal update needs a nonempty goals array')
  state.goals ??= {}
  for (const patch of input.goals) {
    if (!nonempty(patch.id)) fail('goal id required')
    const old = state.goals[patch.id]
    const next = { ...old, ...patch }
    if (old && (JSON.stringify(contract(old)) !== JSON.stringify(contract(next))
        || (old.status !== 'deferred' && next.status === 'deferred'))) {
      const change = patch.change
      if (!change || change.kind !== 'scope' || !nonempty(change.reason) || !nonempty(change.reviewRef) || !nonempty(change.decisionRef)) fail(patch.id + ': changing a product promise or necessary acceptance is a scope change requiring a user decision; append clarifying notes without replacing the promise')
      file(root, change.reviewRef.split('#')[0])
      file(root, change.decisionRef.split('#')[0])
      next.contractChanges = [...(old.contractChanges ?? []), { at: new Date().toISOString(), before: old.contractHash, ...change }]
    }
    if (!old && !nonempty(input.authorizationRef)) fail(patch.id + ': initial/new goal needs its authorization reference')
    next.authorizationRef ??= input.authorizationRef
    next.contractHash = contractHash(next)
    delete next.change
    state.goals[next.id] = next
  }
  state.goalSetHash = digest(JSON.stringify(Object.keys(state.goals).sort()))
  validateGoals(state, root, { only: input.goals.map(goal => goal.id) })
  return state
}
