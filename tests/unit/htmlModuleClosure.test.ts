// @vitest-environment node
import path from 'node:path'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'
import { readHtmlClosure } from '../../src/main/workbench/htmlImport/readHtmlClosure'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { componentFileContentSource } from '../../src/core/projectFiles/componentPlatform/coordinator'
import { HTML_PROGRAM_DEFINITION, webDataSchema } from '../../src/components/web/data'
import { projectWebModuleGraph } from '../../src/components/web/moduleGraph'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import type { DocumentModel } from '../../src/shared/workbench/document'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

it('retains recursive editable HTML modules through archive, same-writer edits and runtime publication', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'html-local-modules-')); roots.push(root)
  const files = {
    'lesson.html': '<!doctype html><html class="dark" dir="rtl"><body data-body-clicks="0"><script type="module" src="./scripts/first.js"></script><script type="module" src="./scripts/second.js"></script></body></html>',
    'scripts/first.js': 'import {count} from "./shared/state.js";import "./cycle/a.js";window.first=count;',
    'scripts/second.js': 'import {count} from "./shared/state.js";window.second=count;export const later=()=>import("./lazy.js");',
    'scripts/shared/state.js': 'export let count = 0;export function increment(){count+=1;}',
    'scripts/cycle/a.js': 'import {b} from "./b.js";export function a(){return b;}',
    'scripts/cycle/b.js': 'import {a} from "./a.js";export function b(){return a;}',
    'scripts/lazy.js': 'export const loaded="lazy";',
  }
  for (const [name, content] of Object.entries(files)) {
    const filename = path.join(root, name)
    await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, content)
  }
  const closure = await readHtmlClosure({ htmlPath: path.join(root, 'lesson.html') })
  expect(closure.diagnostics.filter(item => item.code === 'missing-relative-resource' || item.level === 'error')).toEqual([])
  expect(closure.html).toContain('src="./scripts/first.js"')
  expect(closure.html).toContain('class="dark"')
  expect(closure.html).toContain('dir="rtl"')
  expect(closure.html).toContain('data-body-clicks="0"')
  expect(closure.modules).toHaveProperty(['scripts/shared/state.js'])
  expect(closure.modules).toHaveProperty(['scripts/cycle/b.js'])
  expect(closure.modules).toHaveProperty(['scripts/lazy.js'])
  const model: Extract<DocumentModel, { kind: 'course-v10' }> = { kind: 'course-v10', resources: { assets: {}, components: {} }, project: {
    schemaVersion: 10, id: 'local-modules', revision: 0, title: '本地模块', definitions: { 'guoling.html-program': HTML_PROGRAM_DEFINITION },
    instances: { program: { id: 'program', definitionId: 'guoling.html-program', data: { html: closure.html, modules: closure.modules! },
      frame: { width: 960, height: 640, transform: [1, 0, 0, 1, 30, 40] } } },
    surfaces: [{ id: 'slide', kind: 'slide', title: '本地模块', childIds: ['program'] }], global: { underlay: [], overlay: [] }, assets: {},
  } }
  const driver = new CourseV10Driver(), reopened = driver.load(driver.serialize(model))
  if (reopened.kind !== 'course-v10') throw new Error('Unexpected document format')
  expect(reopened.project.instances.program!.data).toEqual(model.project.instances.program!.data)
  const file = componentProjectFiles(reopened.project, reopened.resources).find(file => file.path.endsWith('.data.json') && file.target?.kind === 'instance' && file.target.instanceId === 'program')!
  const edited = webDataSchema.parse(JSON.parse(file.content!))
  edited.modules!['scripts/shared/state.js'] = edited.modules!['scripts/shared/state.js']!.replace('let count = 0', 'let count = 10')
  const source = componentFileContentSource(file, JSON.stringify(edited))
  if (source.kind !== 'data') throw new Error('Expected normal component data edits')
  const updated = driver.apply(reopened, captureComponentOperation(reopened.project,
    source.fields.map(field => ({ type: 'data.set', instanceId: 'program', ...field }))))
  if (updated.kind !== 'course-v10') throw new Error('Unexpected document format')
  expect(updated.project.instances.program!.frame).toEqual(model.project.instances.program!.frame)
  expect(webDataSchema.parse(updated.project.instances.program!.data).html).toBe(closure.html)
  const compilation = new InMemoryComponentCompilation(createEsbuildComponentCompiler())
  const runtime = await projectWebModuleGraph(updated.project.instances.program!, input => compilation.compile(input))
  const published = await buildPublishedCourseV3({ project: updated.project, assetBytes: {} }, { compilation })
  expect(published.diagnostics).toEqual([])
  expect(published.payload.instances.program!.data).toEqual(runtime.data)
  const graph = z.object({ moduleGraph: z.object({ modules: z.record(z.string(), z.object({
    code: z.string(), imports: z.array(z.object({ path: z.string(), start: z.number(), end: z.number() })),
  })) }) }).parse(runtime.data).moduleGraph
  expect(graph.modules['scripts/first.js']!.imports.some(item => item.path === 'scripts/shared/state.js')).toBe(true)
  expect(graph.modules['scripts/second.js']!.imports.some(item => item.path === 'scripts/shared/state.js')).toBe(true)
  expect(graph.modules['scripts/second.js']!.imports.some(item => item.path === 'scripts/lazy.js')).toBe(true)
  expect(graph.modules['scripts/shared/state.js']!.code).toContain('count = 10')
  expect(updated.project.instances.program!.data).not.toHaveProperty('moduleGraph')
})
