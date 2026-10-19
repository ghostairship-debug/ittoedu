// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { componentAuthorSourceRuntimeNote } from '../../src/core/components/source/componentAuthorSource'
import { componentProjectApiReferencePath, componentProjectFiles, componentProjectScopeFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { prepareComponentProjectFileSource } from '../../src/main/workbench/projectFiles/componentPlatformFileInput'

const bytes = (value: string) => new TextEncoder().encode(value)
function fixture() {
  const project = createBlankCourseProjectV10('精确内容目录')
  project.definitions.web = { id: 'web', title: '互动内容', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
  const frame = { width: 360, height: 220, transform: [1, 0, 0, 1, 120, 80] as [number, number, number, number, number, number] }
  for (const id of ['first', 'second']) project.instances[id] = { id, definitionId: 'web', frame, data: {
    html: `<style>.x{color:red}</style><h1>${id} 当前正文</h1><button>记录结果</button><script>const internal = '不属于正文';</script>`,
  } }
  project.surfaces[0].childIds = ['second', 'first']
  return { project, resources: { assets: {}, components: {} as Record<string, Record<string, Uint8Array>> } }
}

it('keeps the complete API in one directly readable reference instead of every Source note', () => {
  const { project, resources } = fixture()
  const before = structuredClone(project)
  const files = componentProjectFiles(project, resources)
  const references = files.filter(file => file.kind === 'reference')
  expect(references).toHaveLength(1)
  expect(references[0]).toMatchObject({ path: componentProjectApiReferencePath, content: componentAuthorSourceRuntimeNote })
  const sourceFiles = files.filter(file => file.kind === 'source')
  expect(sourceFiles.length).toBeGreaterThan(3)
  for (const file of sourceFiles) {
    expect(file.references).toEqual([{ path: componentProjectApiReferencePath, type: 'reference' }])
    expect(file.note).not.toContain('subscribe(name, listener)')
    expect(file.content).toBeTruthy()
  }
  expect(componentProjectScopeFiles(project, files, { kind: 'instance', instanceId: 'first' })).toContain(references[0])
  expect(componentProjectScopeFiles(project, files, { kind: 'surface', surfaceId: project.surfaces[0].id })).toContain(references[0])
  expect(project).toEqual(before)
})

it('locates current object content with typed paths, semantic summaries and formal frames', () => {
  const { project, resources } = fixture()
  const files = componentProjectFiles(project, resources)
  const structure = files.find(file => file.kind === 'structure')!
  const view = JSON.parse(structure.content!)
  expect(view.objects.map((object: { path: string }) => object.path)).toEqual([
    'pages/01-第 1 页/01-互动内容.content.html',
    'pages/01-第 1 页/02-互动内容.content.html',
  ])
  for (const [index, id] of ['second', 'first'].entries()) {
    const object = view.objects[index]
    const file = files.find(file => file.path === object.path)!
    expect(object).toMatchObject({ kind: 'html', summary: `${id} 当前正文 记录结果`, frame: project.instances[id].frame })
    expect(file.content).toBe((project.instances[id].data as { html: string }).html)
    expect(file.summary).not.toContain('不属于正文')
    expect(file.summary).not.toContain('color:red')
    expect(file.frame).toEqual(object.frame)
  }
})

it('retains full workspace Source and edits its captured file without copying the shared tutorial', async () => {
  const { project, resources } = fixture()
  const entryText = "import { title } from './title';\nexport default { mount() { return { update() {}, dispose() {} }; } };"
  project.instances.first.implementationOverride = { kind: 'source', language: 'typescript', workspace: { ownerId: 'workspace', entry: 'main.ts' } }
  resources.components.workspace = { 'main.ts': bytes(entryText), 'title.ts': bytes("export const title = '保留当前依赖';") }
  const files = componentProjectFiles(project, resources)
  const entry = files.find(file => file.binding?.kind === 'instance-source' && file.binding.instanceId === 'first'
    && file.sourceFile?.path === 'main.ts')!
  expect(entry.content).toBe(entryText)
  expect(entry.references).toEqual([{ path: componentProjectApiReferencePath, type: 'reference' }])
  const replacement = entryText.replace('mount()', 'async mount()')
  const source = await prepareComponentProjectFileSource({ filename: 'candidate/main.ts', bytes: bytes(replacement), text: replacement }, entry, 'content')
  expect(source.kind).toBe('data')
  if (source.kind !== 'data') throw new Error('Expected Source update')
  const edited = source.componentFiles![0]
  if (!edited.files) throw new Error('Expected prepared workspace files')
  expect(edited.files['main.ts']).toEqual(bytes(replacement))
  expect(edited.files['title.ts']).toEqual(resources.components.workspace['title.ts'])
  expect(edited.expectedFiles).toBe(resources.components.workspace)
})
