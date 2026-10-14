// @vitest-environment node
import { expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { importFlowDocument } from '../../src/main/workbench/office/flowDocumentImport'
import { documentMathOmml, OMML_NAMESPACE } from '../../src/shared/document/omml'
import { parseDocumentMath, describeDocumentMath } from '../../src/shared/document/math'
import { renderDocumentText } from '../../src/shared/document/render'
import { planFlowImport } from '../../src/renderer/project/flowImportTransaction'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { projectFlowDocument } from '../../src/core/components/document/flowDocumentProjection'
import { componentCompilationInput } from '../../src/core/components/compilation/componentCompilationInput'
import { componentCompilationInputSchema } from '../../src/shared/workbench/componentCompilation'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import type { ComponentCompilationInput } from '../../src/core/components/compilation/types'
import { toEditorDocument, fromEditorDocument } from '../../src/renderer/document/documentAdapter'
import { EditorState } from 'prosemirror-state'
import { normalizeDocumentText } from '../../src/shared/document/content'

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const docx = (body: string, numbering?: string) => zipSync({
  '_rels/.rels': strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${r}/officeDocument" Target="word/document.xml"/></Relationships>`),
  'word/document.xml': strToU8(`<w:document xmlns:w="${w}" xmlns:m="${OMML_NAMESPACE}"><w:body>${body}</w:body></w:document>`),
  ...(numbering ? { 'word/numbering.xml': strToU8(`<w:numbering xmlns:w="${w}">${numbering}</w:numbering>`) } : {}),
})
const compile = (input: ComponentCompilationInput) => new InMemoryComponentCompilation(createEsbuildComponentCompiler()).compile(componentCompilationInputSchema.parse(structuredClone(input)))

it('CA-001 retains inline and pure OMML formulas in editable formal Flow through archive reopening and rendering', async () => {
  const formulas = ['x+1=2', '\\frac{x+1}{2}', '\\sqrt[3]{x}', '{x+1}_{i}^{2}', '\\sum\\limits_{i=1}^{n}{i+1}', '\\left\\{\\begin{matrix}x&1\\\\y&2\\end{matrix}\\right.', '\\begin{aligned}x&=1\\\\y&=2\\end{aligned}']
  const imported = await importFlowDocument('math.docx', docx(
    `<w:p><w:r><w:rPr><w:b/><w:color w:val="112233"/><w:sz w:val="36"/></w:rPr><w:t>求解：</w:t></w:r>${documentMathOmml(formulas[0])}<w:r><w:t>，说明保留。</w:t></w:r></w:p>`
    + formulas.slice(1).map(latex => `<w:p>${documentMathOmml(latex, true)}</w:p>`).join(''),
  ))
  expect(imported.issues).toEqual([])
  expect(imported.blocks[0]).toMatchObject({ type: 'paragraph', content: { inlines: [{ text: '求解：', style: { bold: true, color: '#112233', fontSize: 24 } }, { type: 'math', latex: 'x+1=2' }, { text: '，说明保留。' }] } })
  const project = createBlankCourseProjectV10('OMML'), plan = planFlowImport(project, imported), driver = new CourseV10Driver()
  const applied = driver.apply({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, captureComponentOperation(project, plan.edits))
  const reopened = driver.load(driver.serialize(applied))
  if (reopened.kind !== 'course-v10') throw new Error('wrong model')
  const blocks = projectFlowDocument(reopened.project, plan.surfaceId).content.blocks
  expect(blocks).toMatchObject(imported.blocks)
  expect(blocks).toHaveLength(imported.blocks.length)
  expect(fromEditorDocument(toEditorDocument({ blocks })).blocks).toEqual(blocks)
  blocks.forEach((block, index) => {
    if (block.type !== 'paragraph') throw new Error('wrong block')
    const math = block.content.inlines.find(inline => inline.type === 'math')!
    if (math.type !== 'math') throw new Error('missing math')
    expect(math.accessibleText).toBe(describeDocumentMath(parseDocumentMath(formulas[index])))
    const html = renderDocumentText(block.content)
    expect(html).toContain(`data-formula-id="${math.formulaId}"`)
    expect(html).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML">')
    expect(documentMathOmml(math.latex)).toContain('<m:oMath>')
  })
})

it('CA-001 preserves unsupported OMML as repairable XML and imports surrounding text and subsequent formulas', async () => {
  const unsupported = '<m:oMath><m:acc><m:accPr><m:chr m:val="ˆ"/></m:accPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:acc></m:oMath>'
  const foreign = '<m:oMath><m:r><m:t>x</m:t><w:t>不可吞</w:t></m:r></m:oMath>'
  const hiddenLimits = '<m:oMath><m:nary><m:naryPr><m:chr m:val="∑"/><m:subHide/></m:naryPr><m:sub><m:r><m:t>i=1</m:t></m:r></m:sub><m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary></m:oMath>'
  const imported = await importFlowDocument('unsupported.docx', docx(`<w:p><w:r><w:t>前文</w:t></w:r>${unsupported}<w:r><w:t>后文</w:t></w:r>${documentMathOmml('y=2')}${foreign}${hiddenLimits}</w:p>`))
  expect(imported.issues).toHaveLength(3)
  expect(imported.issues.every(issue => issue.includes('完整 OMML 原式保留为可编辑文字'))).toBe(true)
  const block = imported.blocks[0]
  if (block.type !== 'paragraph') throw new Error('wrong block')
  expect(block.content.inlines).toMatchObject([{ text: '前文' }, { type: 'text', text: expect.stringContaining('<m:acc>'), code: true }, { text: '后文' }, { type: 'math', latex: 'y=2' }, { type: 'text', text: expect.stringContaining('不可吞') }, { type: 'text', text: expect.stringContaining('m:subHide') }])
  const editor = toEditorDocument({ blocks: imported.blocks })
  expect(fromEditorDocument(editor).blocks).toEqual([{ ...block, content: normalizeDocumentText(block.content) }])
  let rawStart = -1
  editor.descendants((node, position) => { if (rawStart === -1 && node.isText && node.text?.startsWith('<m:oMath')) rawStart = position })
  expect(rawStart).toBeGreaterThan(0)
  const state = EditorState.create({ doc: editor }), repaired = fromEditorDocument(state.apply(state.tr.insertText('已修订', rawStart + 3)).doc)
  const repairedBlock = repaired.blocks[0]
  if (repairedBlock.type !== 'paragraph') throw new Error('wrong block')
  expect(repairedBlock.content.inlines).toContainEqual(expect.objectContaining({ type: 'text', code: true, text: expect.stringContaining('已修订') }))
})

it('CA-001 respects explicit Office math on/off values for degree hiding and alignment marks', async () => {
  const run = (text: string, properties = '') => `<m:r>${properties}<m:t>${text}</m:t></m:r>`
  const radical = (properties: string) => `<m:oMath><m:rad><m:radPr>${properties}</m:radPr><m:deg>${run('3')}</m:deg><m:e>${run('x')}</m:e></m:rad></m:oMath>`
  const aligned = `<m:oMath><m:eqArr><m:e>${run('x')}${run('=', '<m:rPr><m:aln m:val="0"/></m:rPr>')}${run('1')}</m:e></m:eqArr></m:oMath>`
  const imported = await importFlowDocument('math-flags.docx', docx(`<w:p>${radical('<m:degHide/>')}${radical('<m:degHide m:val="0"/>')}${aligned}</w:p>`))
  expect(imported.issues).toEqual([])
  const block = imported.blocks[0]
  if (block.type !== 'paragraph') throw new Error('wrong block')
  expect(block.content.inlines.map(inline => inline.type === 'math' && inline.latex)).toEqual(['\\sqrt{x}', '\\sqrt[3]{x}', '\\begin{aligned}x=1&\\end{aligned}'])
})

it('CA-001 keeps math in continuation cells of a vertical Word merge', async () => {
  const cell = (properties: string, content: string) => `<w:tc><w:tcPr>${properties}</w:tcPr><w:p>${content}</w:p></w:tc>`
  const imported = await importFlowDocument('math-table.docx', docx(`<w:tbl><w:tblGrid><w:gridCol/></w:tblGrid><w:tr>${cell('<w:vMerge w:val="restart"/>', '<w:r><w:t>公式</w:t></w:r>')}</w:tr><w:tr>${cell('<w:vMerge/>', documentMathOmml('x=1'))}</w:tr></w:tbl>`))
  const table = imported.blocks[0]
  if (table.type !== 'table') throw new Error('wrong block')
  expect(table.rows[0].cells[table.columns[0].id].inlines).toContainEqual(expect.objectContaining({ type: 'math', latex: 'x=1' }))
  expect(table.rows[1].cells[table.columns[0].id].inlines).toEqual([])
})

it('CA-002 consumes the actual ilvl format and the current numbering instance override', async () => {
  const paragraph = (numId: string, level: string, text: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
  const level = (index: number, format: string) => `<w:lvl w:ilvl="${index}"><w:numFmt w:val="${format}"/></w:lvl>`
  const numbering = `<w:abstractNum w:abstractNumId="A">${level(0, 'decimal')}${level(1, 'bullet')}</w:abstractNum><w:abstractNum w:abstractNumId="B">${level(0, 'bullet')}${level(1, 'decimal')}</w:abstractNum>`
    + '<w:num w:numId="1"><w:abstractNumId w:val="A"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="B"/></w:num>'
    + `<w:num w:numId="3"><w:abstractNumId w:val="A"/><w:lvlOverride w:ilvl="1">${level(1, 'decimal')}</w:lvlOverride></w:num>`
    + '<w:num w:numId="4"><w:abstractNumId w:val="A"/><w:lvlOverride w:ilvl="1"><w:startOverride w:val="4"/></w:lvlOverride></w:num>'
  const imported = await importFlowDocument('lists.docx', docx(paragraph('1', '0', '一级数字') + paragraph('1', '1', '二级符号') + paragraph('2', '0', '一级符号') + paragraph('2', '1', '二级数字') + paragraph('3', '1', '实例覆盖数字') + paragraph('4', '1', '只覆盖起始序号'), numbering))
  expect(imported.blocks.map(block => block.type === 'list' && block.ordered)).toEqual([true, false, false, true, true, false])
  expect(imported.issues).toEqual(['嵌套列表已按阅读顺序保留，缩进层级简化。'])
})

it('CA-006 compiles the real workspace producer through author IPC Schema with root PNG and dependency font bytes', async () => {
  const project = createBlankCourseProjectV10('Binary workspace')
  const implementation = { kind: 'source' as const, language: 'javascript' as const, workspace: { ownerId: 'root-files', entry: 'main.js' }, moduleBindings: { helper: 'helper' } }
  project.definitions.root = { id: 'root', role: 'content', implementation }
  project.definitions.helper = { id: 'helper', role: 'content', implementation: { kind: 'source', language: 'javascript', workspace: { ownerId: 'helper-files', entry: 'helper.js' } } }
  const input = componentCompilationInput(project, implementation, { assets: {}, components: {
    'root-files': { 'main.js': strToU8('import "./theme.css"; import { answer } from "helper"; export { answer };'), 'theme.css': strToU8('.root{background:url(./photo.png)}'), 'photo.png': Uint8Array.of(137, 80, 78, 71, 255) },
    'helper-files': { 'helper.js': strToU8('import "./font.css"; export const answer = 42;'), 'font.css': strToU8('@font-face{font-family:lesson;src:url(./lesson.woff2)}'), 'lesson.woff2': Uint8Array.of(0, 255, 128, 1) },
  } })
  expect(input.binaryFiles).toHaveProperty('photo.png')
  expect(input.dependencies!.helper.binaryFiles).toHaveProperty('lesson.woff2')
  const compiled = await compile(input)
  expect(compiled.status).toBe('ready')
  if (compiled.status !== 'ready') throw new Error(JSON.stringify(compiled.diagnostics))
  expect(compiled.artifact.css).toContain('data:image/png;base64,')
  expect(compiled.artifact.css).toContain('data:font/woff2;base64,')
})

it('CA-039 uses matching loaders for supplied uppercase JavaScript, TypeScript, JSON and CSS siblings', async () => {
  const compiled = await compile({ entry: 'main.js', files: {
    'main.js': 'import { answer } from "./helper.JS"; import { count } from "./value.TS"; import data from "./data.JSON"; import "./theme.CSS"; export const result = answer + count + data.amount;',
    'helper.JS': 'export const answer = 40;', 'value.TS': 'export const count: number = 1;', 'data.JSON': '{"amount":1}', 'theme.CSS': '.lesson{color:green}',
  } })
  expect(compiled.status).toBe('ready')
  if (compiled.status !== 'ready') throw new Error(JSON.stringify(compiled.diagnostics))
  expect(compiled.artifact.css).toContain('green')
})

it('CA-380 resolves exact loader spellings by their owner binding before generic URL rejection', async () => {
  const project = createBlankCourseProjectV10('Exact binding')
  const implementation = { kind: 'source' as const, language: 'javascript' as const, source: 'import { answer } from "lesson?raw"; export { answer };', moduleBindings: { 'lesson?raw': 'rawHelper' } }
  project.definitions.root = { id: 'root', role: 'content', implementation }
  project.definitions.rawHelper = { id: 'rawHelper', role: 'content', implementation: { kind: 'source', language: 'javascript', source: 'export const answer = "already supplied implementation";' } }
  const input = componentCompilationInput(project, implementation)
  expect((await compile(input)).status).toBe('ready')
  const absent = await compile({ ...input, dependencies: {} })
  expect(absent.status).toBe('failed')
  if (absent.status !== 'failed') throw new Error('missing exact dependency should fail')
  expect(absent.diagnostics).toEqual([expect.objectContaining({ message: expect.stringContaining('lesson?raw') })])
  const unbound = await compile({ entry: 'main.js', files: { 'main.js': 'import "./lesson.js?raw";', 'lesson.js': 'export const value = 1;' } })
  expect(unbound.status).toBe('failed')
  if (unbound.status !== 'failed') throw new Error('unbound alternate loader should fail')
  expect(unbound.diagnostics).toEqual([expect.objectContaining({ message: expect.stringContaining('?raw 尚未支持') })])
})
