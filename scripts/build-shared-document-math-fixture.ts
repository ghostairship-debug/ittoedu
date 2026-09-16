import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { documentMathOmml, OMML_NAMESPACE } from '../src/shared/document/omml'
import { documentMathCases } from '../tests/fixtures/shared-document/mathCases'
import { sharedDocumentFixture } from '../tests/fixtures/shared-document/content'
import { serializeDocumentMarkdown } from '../src/shared/document/markdown'

const output = resolve(process.argv[2] ?? 'output/r19-shared-document')
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const paragraph = (s: string, style?: string) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${escape(s)}</w:t></w:r></w:p>`
const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="${OMML_NAMESPACE}"><w:body>${paragraph('共用正文数学编辑验证', 'Title')}${paragraph('本文件覆盖首期九类数学结构。请在桌面 Word 逐项修改指定位置，保存、关闭并重开，核对公式结构及显示。XML 检查不能代替本项验收。')}${documentMathCases.map((item, index) => `${paragraph(`${index + 1} ${item.name}`, 'Heading1')}<w:p>${documentMathOmml(item.latex, true)}</w:p>${paragraph(item.edit)}`).join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:bottom="1080" w:left="1080" w:right="1080"/></w:sectPr></w:body></w:document>`
const files: Record<string, string> = {
  '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
  '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  'word/document.xml': document,
  'word/_rels/document.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
  'word/styles.xml': '<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:color w:val="000000"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style></w:styles>',
}
async function main() {
  await mkdir(output, { recursive: true })
  await writeFile(resolve(output, 'math-acceptance.docx'), zipSync(Object.fromEntries(Object.entries(files).map(([name, content]) => [name, strToU8(content)]))))
  await writeFile(resolve(output, 'content-roundtrip.md'), serializeDocumentMarkdown(sharedDocumentFixture(), 'file'), 'utf8')
  console.log(`Generated ${resolve(output, 'math-acceptance.docx')}`)
}
void main().catch(error => { console.error(error); process.exitCode = 1 })
