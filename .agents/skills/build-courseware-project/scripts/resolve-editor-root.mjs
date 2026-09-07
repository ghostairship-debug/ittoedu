#!/usr/bin/env node
// resolve-editor-root.mjs — 确定性定位编辑器产品根目录，替代 LLM 逐目录探测。
// 输出 JSON：{ ok, editorRoot, capabilityIndex, indexMtime, candidates, strategy, error? }
// 用法：node scripts/resolve-editor-root.mjs [--no-cache]
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stampPath = path.join(skillDir, 'editor-root.local.json')
const noCache = process.argv.includes('--no-cache')

function validate(root) {
  try {
    const indexPath = path.join(root, 'artifacts', 'ai-capabilities', 'index.json')
    const pkgPath = path.join(root, 'package.json')
    const hostPath = path.join(root, 'scripts', 'courseware-builder-v2-host.ts')
    if (!fs.existsSync(indexPath) || !fs.existsSync(pkgPath) || !fs.existsSync(hostPath)) return null
    JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    if (!pkg.scripts || !pkg.scripts['build:courseware-case']) return null
    return { root, indexPath, indexMtime: fs.statSync(indexPath).mtimeMs, pkgVersion: pkg.version || null }
  } catch { return null }
}

function emit(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n') }

const candidates = []
const seen = new Set()
function tryRoot(root, strategy) {
  if (!root || seen.has(root)) return false
  seen.add(root)
  const v = validate(root)
  if (v) { candidates.push({ ...v, strategy }); return true }
  return false
}

// 策略 1：环境变量
tryRoot(process.env.COURSEWARE_EDITOR_ROOT, 'env')

// 策略 2：skill 本地戳（上次成功或同步脚本写入）
if (!noCache && candidates.length === 0) {
  try {
    const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'))
    tryRoot(stamp.editorRoot, 'stamp')
  } catch { /* 无戳或已损坏，继续 */ }
}

// 策略 3：skill 位于仓库内（.agents/skills/<name>/scripts/ → 向上找祖先）
if (candidates.length === 0) {
  let dir = skillDir
  for (let i = 0; i < 6 && dir !== path.dirname(dir); i++) {
    if (tryRoot(dir, 'ancestor')) break
    dir = path.dirname(dir)
  }
}

// 策略 4：有界搜索已知根（Documents / Desktop / 用户主目录一级，最深 3 层，跳过 node_modules/.git）
if (candidates.length === 0) {
  const roots = [path.join(os.homedir(), 'Documents'), path.join(os.homedir(), 'Desktop'), os.homedir()]
  const marker = path.join('artifacts', 'ai-capabilities', 'index.json')
  function walk(dir, depth) {
    if (depth > 3) return
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (fs.existsSync(path.join(full, marker))) tryRoot(full, 'search')
      walk(full, depth + 1)
    }
  }
  for (const r of roots) walk(r, 1)
}

if (candidates.length === 0) {
  emit({ ok: false, error: 'no_valid_editor_root', hint: '可用环境变量 COURSEWARE_EDITOR_ROOT 显式指定；候选需同时包含 artifacts/ai-capabilities/index.json、package.json 的 build:courseware-case 脚本和 scripts/courseware-builder-v2-host.ts' })
  process.exit(1)
}

// 多候选：取能力索引最新者为主选，全部列出供甄别
candidates.sort((a, b) => b.indexMtime - a.indexMtime)
const best = candidates[0]

// 写本地戳，加速下次（仅文件，不进 Git 同步内容）
try { fs.writeFileSync(stampPath, JSON.stringify({ editorRoot: best.root, writtenAt: new Date().toISOString() }, null, 2)) } catch { /* 只读目录则跳过 */ }

emit({
  ok: true,
  editorRoot: best.root,
  capabilityIndex: best.indexPath,
  indexMtime: new Date(best.indexMtime).toISOString(),
  pkgVersion: best.pkgVersion,
  strategy: best.strategy,
  candidates: candidates.map(c => ({ root: c.root, indexMtime: new Date(c.indexMtime).toISOString(), pkgVersion: c.pkgVersion, strategy: c.strategy })),
  note: candidates.length > 1 ? '存在多个有效候选，已选能力索引最新者；若主选错误，请用 COURSEWARE_EDITOR_ROOT 显式指定' : undefined,
})
