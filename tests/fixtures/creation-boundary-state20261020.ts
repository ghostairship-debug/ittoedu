import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import type { DocumentModel } from '../../src/shared/workbench/document'

export const interviewInstanceId = 'interview-09'
export const introductionInstanceId = 'introduction-10'
export const interviewStateKey = (instanceId: string) => `interview:${instanceId}`

/** Small reusable authoring example: author data is not a learner's runtime answer. */
export const interviewSource = String.raw`
function shortField(field, raw) {
  const value = raw.trim().replace(/[.!?]+$/, '');
  if (field === 'name') return value.replace(/^(?:My name is|I am|He is|She is)\s+/i, '');
  if (field === 'age') return value.replace(/^(?:I am|He is|She is)\s+/i, '').replace(/\s+years? old$/i, '');
  return value.replace(/^(?:I am|He is|She is)\s+from\s+/i, '');
}
export default { mount({ root, instance, scope, teacherController }) {
  let current = instance;
  const key = 'interview:' + instance.id;
  root.innerHTML = '<section data-fixture-id="' + instance.id + '" style="font:22px sans-serif;padding:24px">'
    + '<h1>09 Interview notes</h1><p data-person></p>'
    + '<label>Name <input data-field="name"></label><br>'
    + '<label>Age <input data-field="age"></label><br>'
    + '<label>Country <input data-field="country"></label><br>'
    + '<button data-check>核对记录</button> <button data-next>提交并下一页</button>'
    + '<p data-feedback></p><button data-share>共享提示设为 ready</button><output data-shared></output></section>';
  const panel = root.querySelector('section');
  panel.dataset.stateKey = key;
  const fields = ['name', 'age', 'country'];
  let verification = 'unchecked';
  const saved = scope.state.get(key);
  for (const field of fields) {
    const input = panel.querySelector('[data-field="' + field + '"]');
    input.value = saved?.raw?.[field] ?? '';
    input.addEventListener('input', () => { verification = 'unchecked'; panel.querySelector('[data-feedback]').textContent = '尚未核对'; });
  }
  verification = saved?.verification ?? 'unchecked';
  function record(check) {
    const raw = Object.fromEntries(fields.map(field => [field, panel.querySelector('[data-field="' + field + '"]').value]));
    const normalized = Object.fromEntries(fields.map(field => [field, shortField(field, raw[field])]));
    const matches = Object.fromEntries(fields.map(field => [field, normalized[field].toLowerCase() === String(current.data.person[field]).toLowerCase()]));
    if (check) verification = 'checked';
    const result = { source: { instanceId: instance.id, activityId: current.data.activityId, personId: current.data.person.id },
      raw, normalized, conversion: { rule: 'strip-explicit-introduction-prefix-and-terminal-punctuation-v1', original: raw },
      verification, matches: verification === 'checked' ? matches : null };
    scope.state.set(key, result);
    panel.querySelector('[data-feedback]').textContent = verification === 'checked'
      ? (Object.values(matches).every(Boolean) ? '核对：一致' : '核对：不一致，保留原记录') : '尚未核对';
    return result;
  }
  panel.querySelector('[data-check]').addEventListener('click', () => record(true));
  panel.querySelector('[data-next]').addEventListener('click', async () => {
    record(false); const moved = await teacherController.execute({ type: 'step.next' }); panel.dataset.next = String(moved);
  });
  const sharedKey = instance.stateBindings?.classPrompt;
  function renderShared(value) { panel.querySelector('[data-shared]').textContent = String(value ?? ''); }
  renderShared(scope.state.get(sharedKey));
  const offShared = scope.state.subscribe(sharedKey, renderShared); scope.cleanup(offShared);
  panel.querySelector('[data-share]').addEventListener('click', () => scope.state.set(sharedKey, 'ready'));
  function paint() { panel.querySelector('[data-person]').textContent = 'Interview role: ' + current.data.person.name; }
  paint();
  return { update(next) { current = next; paint(); }, dispose() {} };
} };
`

export const introductionSource = String.raw`
export default { mount({ root, instance, scope, teacherController }) {
  const key = 'interview:' + instance.data.sourceInstanceId;
  root.innerHTML = '<section data-fixture-id="' + instance.id + '" style="font:22px sans-serif;padding:24px">'
    + '<h1>10 Introduce the person from your notes</h1><p data-record></p><pre data-raw style="white-space:pre-wrap;overflow-wrap:anywhere;font:18px monospace"></pre>'
    + '<pre data-conversion style="white-space:pre-wrap;overflow-wrap:anywhere;font:18px monospace"></pre>'
    + '<p data-verification></p><button data-resubscribe>重新订阅</button><button data-previous>返回采访</button></section>';
  const panel = root.querySelector('section'); let renders = 0, off = () => {};
  function render(value) {
    panel.dataset.renderCount = String(++renders);
    panel.dataset.record = JSON.stringify(value ?? null);
    panel.querySelector('[data-record]').textContent = value
      ? 'Name: ' + value.normalized.name + '; age: ' + value.normalized.age + '; country: ' + value.normalized.country
      : 'No interview record yet';
    panel.querySelector('[data-raw]').textContent = JSON.stringify(value?.raw ?? null);
    panel.querySelector('[data-conversion]').textContent = JSON.stringify(value?.conversion ?? null);
    panel.querySelector('[data-verification]').textContent = value?.verification ?? 'missing';
  }
  function observe() { off(); render(scope.state.get(key)); off = scope.state.subscribe(key, render); }
  observe(); scope.cleanup(() => off());
  panel.querySelector('[data-resubscribe]').addEventListener('click', observe);
  panel.querySelector('[data-previous]').addEventListener('click', () => teacherController.execute({ type: 'step.previous' }));
  return { update() {}, dispose() {} };
} };
`

export function createCreationBoundaryStateFixture(): Extract<DocumentModel, { kind: 'course-v10' }> {
  const project = createBlankCourseProjectV10('隔离技术 fixture：采访结果交接')
  project.definitions.interview = { id: 'interview', title: 'Interview', role: 'content',
    implementation: { kind: 'source', language: 'javascript', source: interviewSource } }
  project.definitions.introduction = { id: 'introduction', title: 'Introduction', role: 'content',
    implementation: { kind: 'source', language: 'javascript', source: introductionSource } }
  project.instances[interviewInstanceId] = { id: interviewInstanceId, definitionId: 'interview',
    stateBindings: { classPrompt: 'class-prompt' },
    data: { activityId: 'interview-activity', person: { id: 'person-mia', name: 'Mia', age: 'twelve', country: 'China' } },
    frame: { width: 900, height: 600, transform: [1, 0, 0, 1, 0, 0] } }
  project.instances[introductionInstanceId] = { id: introductionInstanceId, definitionId: 'introduction',
    data: { sourceInstanceId: interviewInstanceId }, frame: { width: 900, height: 600, transform: [1, 0, 0, 1, 0, 0] } }
  project.surfaces = [
    { id: 'page-09', title: '09 Interview', kind: 'slide', childIds: [interviewInstanceId], designSize: { width: 1000, height: 700 } },
    { id: 'page-10', title: '10 Introduction', kind: 'slide', childIds: [introductionInstanceId], designSize: { width: 1000, height: 700 } },
  ]
  project.logic = { courseState: [{ key: 'class-prompt', valueType: 'string', defaultValue: 'listen' }], navigationGuards: [] }
  return { kind: 'course-v10', project, resources: { assets: {}, components: {} } }
}
