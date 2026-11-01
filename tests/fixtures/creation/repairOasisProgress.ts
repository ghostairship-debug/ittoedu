/** A narrowly scoped repair of the supplied r10 work. The original file is never edited. */
export function repairOasisProgress(original: string): string {
  const once = (text: string, before: string, after: string) => {
    if (text.split(before).length !== 2) throw new Error(`Expected one original Oasis anchor: ${before.slice(0, 90)}`)
    return text.replace(before, after)
  }
  let source = once(original, 'let storageAvailable = true;', `let storageAvailable = false;
let progressPort = null;
let progressRevision = null;
let restoreCompleted = false;
let writePermitted = false;
let saveStatus = 'restoring';
let saveTail = Promise.resolve();
let saveEpoch = 0;
let saveSerial = 0;
let resettingProgress = false;`)
  const start = source.indexOf('function readState() {')
  const end = source.indexOf('function toast(', start)
  if (start < 0 || end < start) throw new Error('Original save owner not found')
  const sanitizeStart = source.indexOf("    if (!plainObject(source) || source.schemaVersion !== 1)", start)
  const sanitizeEnd = source.indexOf('    return next;', sanitizeStart) + '    return next;'.length
  if (sanitizeStart < start || sanitizeEnd > end) throw new Error('Original state sanitizer not found')
  const sanitizer = source.slice(sanitizeStart, sanitizeEnd)
  source = source.slice(0, start) + `function sanitizeState(source) {
  const fresh = defaults();
${sanitizer}
}
let state = defaults();

function progressFailure(error, announce = true) {
  storageAvailable = false; writePermitted = false; saveStatus = 'unsaved';
  const conflict = error?.code === 'progress-conflict';
  storageMessage = conflict
    ? '另一窗口已更新进度，本窗口未覆盖它。请关闭本窗口后重新打开作品，读取最新进度再继续。'
    : '本设备进度未保存：' + String(error?.message || error) + '。本次仍可在内存中游玩；请使用存档备份，关闭后可能丢失。';
  if (announce) toast(storageMessage, 10000);
  renderSaveStatus();
}
async function readState() {
  let timeout;
  try {
    if (!window.courseProgressReady) throw new Error('当前播放器未提供学习进度端口');
    progressPort = await Promise.race([window.courseProgressReady, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('学习进度端口尚未接通')), 15000);
    })]);
    const stored = await progressPort.read(STORAGE_KEY, 1);
    progressRevision = stored.revision; restoreCompleted = true;
    if (stored.status === 'incompatible') {
      storageMessage = '原进度版本暂不兼容，尚未覆盖。确认开始新航行才会清除原进度，也可保留原文件。';
      saveStatus = 'unsaved'; return defaults();
    }
    const next = stored.status === 'ready' ? sanitizeState(stored.value) : defaults();
    writePermitted = true; storageAvailable = true;
    saveStatus = stored.status === 'ready' ? 'saved' : 'empty';
    return next;
  } catch (error) { progressFailure(error, false); return defaults(); }
  finally { clearTimeout(timeout); }
}
function persist(announceFailure = true) {
  if (!restoreCompleted || !writePermitted || !progressPort) {
    saveStatus = 'unsaved'; renderSaveStatus(); return Promise.resolve(false);
  }
  const epoch = saveEpoch, serial = ++saveSerial;
  const saved = jsonCopy(state); saved.savedAt = new Date().toISOString();
  saveStatus = 'saving'; renderSaveStatus();
  const task = saveTail.then(async () => {
    if (epoch !== saveEpoch || !writePermitted) return false;
    const receipt = await progressPort.write(STORAGE_KEY, 1, saved, progressRevision);
    // Even an in-flight old epoch must acknowledge its revision before reset's CAS.
    progressRevision = receipt.revision;
    if (epoch === saveEpoch) {
      state.savedAt = saved.savedAt; storageAvailable = true; storageMessage = '';
      if (serial === saveSerial) saveStatus = 'saved';
    }
    return true;
  }).catch(error => { progressFailure(error, announceFailure); return false; })
    .finally(renderSaveStatus);
  saveTail = task.then(() => undefined);
  return task;
}
function renderSaveStatus() {
  dom['save-indicator'].textContent = saveStatus === 'saved' ? '已在本设备保存'
    : saveStatus === 'saving' ? '正在保存进度…'
      : saveStatus === 'restoring' ? '正在读取进度…'
        : saveStatus === 'empty' ? '尚无航行进度' : '未保存 · 仅本次内存';
  dom['save-indicator'].classList.toggle('is-warning', saveStatus === 'unsaved');
  if (ui.scene === 'home' && booted) renderHome();
}
` + source.slice(end)
  source = once(source, "dom['start-button'].disabled = !booted;", "dom['start-button'].disabled = !booted || resettingProgress;")
  source = once(source, "dom['continue-button'].disabled = !booted || !progress;", "dom['continue-button'].disabled = !booted || !progress || resettingProgress;")
  source = once(source, '。仅在本设备保存。`', '。\${saveStatus === \'saved\' ? \'已在本设备保存。\' : saveStatus === \'saving\' ? \'正在保存。\' : \'当前为内存进度，尚未确认保存。\'}`')
  source = once(source,
    "reload.addEventListener('click', () => { persist(); if (!storageAvailable) { void mountCurrent({ focus: true }); toast('存储受限：保留内存进度并重载本幕，未刷新整页。', 6500); return; } location.reload(); });",
    "reload.addEventListener('click', async () => { const saved = await persist(); if (!saved) { void mountCurrent({ focus: true }); toast('进度尚未保存：保留内存进度并重载本幕，未刷新整页。', 6500); return; } location.reload(); });")
  source = once(source, `function beginNew() {
  destroyCurrent();
  const settings = { ...state.settings };
  state = defaults(settings); state.startedAt = new Date().toISOString();
  persist(); applySettings(); void mountCurrent({ focus: true });
}`, `async function replaceVoyage(next) {
  if (resettingProgress) return false;
  resettingProgress = true; renderSaveStatus();
  destroyCurrent();
  ++saveEpoch; // Drop queued old snapshots; finish any already submitted transaction.
  await saveTail;
  try {
    if (progressPort && restoreCompleted) {
      const cleared = await progressPort.clear(STORAGE_KEY, 1, progressRevision);
      progressRevision = cleared.revision; writePermitted = true; storageAvailable = true;
      storageMessage = ''; saveStatus = 'empty';
    }
    state = next;
    return true;
  } catch (error) { progressFailure(error); return false; }
  finally { resettingProgress = false; renderSaveStatus(); }
}
async function beginNew() {
  const next = defaults({ ...state.settings }); next.startedAt = new Date().toISOString();
  if (!await replaceVoyage(next)) { showHome(); return; }
  await persist(); applySettings(); void mountCurrent({ focus: true });
}`)
  source = once(source, "button('从粘贴的存档恢复', () => {", "button('从粘贴的存档恢复', async () => {")
  source = once(source, "      state=next; if(!isUnlocked(state.current)) state.current=furthestUnlocked();", "      if (!await replaceVoyage(next)) return; if(!isUnlocked(state.current)) state.current=furthestUnlocked();")
  source = once(source,
    "      toast('存档已恢复。点击“继续上次航行”接续；受限环境下仍请保留备份码。',8000);",
    "      const saved = await persist(false); toast(saved ? '存档已恢复并保存。点击“继续上次航行”接续。' : '存档已读入本次内存，但未保存到设备；请保留备份码。',8000);")
  source = once(source, `async function boot() {
  installPortableArchive();`, `async function boot() {
  state = await readState();
  if (!isUnlocked(state.current)) state.current = furthestUnlocked();
  installPortableArchive();`)
  // Waiting at module top level would block iframe load before the host can connect its port.
  source = once(source, 'await boot();', "void boot().catch(error => { progressFailure(error); toast('驾驶舱启动失败：' + String(error?.message || error), 10000); });")
  // The retained narration files outlast the original text-length timer. Keep
  // captions until explicit dismissal, replacement, or the existing scene cleanup.
  // Muting audio must not take away the text alternative.
  source = once(source, 'let subtitleTimer = null;\n', '')
  source = once(source, '  clearTimeout(subtitleTimer); subtitleTimer = null;\n', '')
  source = once(source, '  subtitleTimer = setTimeout(hideSubtitle, clamp(clean.length * 190, 8000, 35000));',
    '  // 保留字幕供阅读；关闭、下一条播报或离开本幕时清理。')
  return source
}
