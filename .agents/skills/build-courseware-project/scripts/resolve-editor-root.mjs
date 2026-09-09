#!/usr/bin/env node
// resolve-editor-root.mjs — 确定性定位编辑器产品根目录，替代 LLM 逐目录探测。
// 输出路径与语义版本；mtime 仅为兼容显示字段，不作为能力缓存或版本选择依据。
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
    const discoveryPath = path.join(root, 'artifacts', 'ai-capabilities', 'discovery.json')
    const queryPath = path.join(root, 'scripts', 'query-ai-capabilities.mjs')
    if (!fs.existsSync(indexPath) || !fs.existsSync(pkgPath) || !fs.existsSync(hostPath) || !fs.existsSync(queryPath)) return null
    JSON.parse(fs.readFileSync(indexPath, 'utf8'))
    const discovery = JSON.parse(fs.readFileSync(discoveryPath, 'utf8'))
    if (discovery.version !== 1 || typeof discovery.semanticVersion !== 'string' || !discovery.semanticVersion) return null
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    if (!pkg.scripts || !pkg.scripts['build:courseware-case']) return null
    return { root, indexPath, discoveryPath, queryPath, semanticVersion: discovery.semanticVersion,
      indexMtime: fs.statSync(indexPath).mtimeMs, pkgVersion: pkg.version || null }
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
if (process.env.COURSEWARE_EDITOR_ROOT && !tryRoot(process.env.COURSEWARE_EDITOR_ROOT, 'env')) {
  emit({ ok: false, error: 'explicit_editor_root_invalid', editorRoot: process.env.COURSEWARE_EDITOR_ROOT,
    hint: '本轮明确指定的产品根或能力发现不可用；修复该路径，不改用其他产品版本。' })
  process.exit(1)
}

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

// 不把文件时间当作产品能力版本；不同能力的搜索结果必须明确定位。
if (new Set(candidates.map(candidate => candidate.semanticVersion)).size > 1) {
  emit({ ok: false, error: 'ambiguous_editor_roots', candidates, hint: '存在不同能力版本，请通过 COURSEWARE_EDITOR_ROOT 选择本轮产品根目录。' })
  process.exit(1)
}
const best = candidates[0]

// 写本地戳，加速下次（仅文件，不进 Git 同步内容）
try { fs.writeFileSync(stampPath, JSON.stringify({ editorRoot: best.root, writtenAt: new Date().toISOString() }, null, 2)) } catch { /* 只读目录则跳过 */ }

emit({
  ok: true,
  editorRoot: best.root,
  capabilityIndex: best.indexPath,
  capabilityDiscovery: best.discoveryPath,
  capabilityQuery: best.queryPath,
  semanticVersion: best.semanticVersion,
  indexMtime: new Date(best.indexMtime).toISOString(),
  pkgVersion: best.pkgVersion,
  strategy: best.strategy,
  candidates: candidates.map(c => ({ root: c.root, semanticVersion: c.semanticVersion, pkgVersion: c.pkgVersion, strategy: c.strategy })),
  note: candidates.length > 1 ? '多个候选具有相同能力语义版本，按发现顺序选择；可用 COURSEWARE_EDITOR_ROOT 显式指定。' : undefined,
})
