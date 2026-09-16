import { strToU8, zipSync, zlibSync } from 'fflate'

/** Deterministic real files: a PDF vector diagram and original Office PNG diagrams. */
export const MATERIAL_TEXT = 'Series circuit teaching material'
function chunk(type: string, bytes: Uint8Array) {
  const data = Buffer.concat([Buffer.from(type), bytes])
  let crc = 0xffffffff
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
  const head = Buffer.alloc(4); head.writeUInt32BE(bytes.length)
  const tail = Buffer.alloc(4); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([head, data, tail])
}
export function diagramPng(): Uint8Array {
  const header = Buffer.alloc(13); header.writeUInt32BE(32, 0); header.writeUInt32BE(32, 4); header[8] = 8; header[9] = 2
  const pixels = Buffer.alloc(32 * 97)
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) pixels[y * 97 + 1 + x * 3 + 2] = 255
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlibSync(pixels)), chunk('IEND', new Uint8Array())])
}
function pdf(): Uint8Array {
  const stream = `BT /F1 16 Tf 20 170 Td (${MATERIAL_TEXT}) Tj ET\n0 0 1 rg 20 20 80 80 re f\n`
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}endstream`]
  let source = '%PDF-1.4\n'; const offsets = [0]
  objects.forEach((object, i) => { offsets.push(source.length); source += `${i + 1} 0 obj\n${object}\nendobj\n` })
  const xref = source.length
  source += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return strToU8(source)
}
const relationship = (id: string, type: string, target: string) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`
const rels = (body: string) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`
const r = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const a = 'http://schemas.openxmlformats.org/drawingml/2006/main'
function office(format: 'docx' | 'pptx'): Uint8Array {
  const main = format === 'docx' ? 'word/document.xml' : 'ppt/presentation.xml'
  const files: Record<string, string | Uint8Array> = {
    '_rels/.rels': rels(relationship('root', 'officeDocument', main)),
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.${format === 'docx' ? 'wordprocessingml.document' : 'presentationml.presentation'}.main+xml"/>${format === 'pptx' ? '<Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' : ''}</Types>`,
  }
  if (format === 'docx') Object.assign(files, {
    [main]: `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:a="${a}" xmlns:r="${r}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body><w:p><w:r><w:t>${MATERIAL_TEXT}</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/><wp:docPr id="1" name="Circuit diagram"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="diagram.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p><w:sectPr/></w:body></w:document>`,
    'word/_rels/document.xml.rels': rels(relationship('image', 'image', 'media/diagram.png')),
    'word/media/diagram.png': diagramPng(),
  })
  else Object.assign(files, {
    [main]: `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="${r}"><p:sldIdLst><p:sldId id="256" r:id="slide"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': rels(relationship('slide', 'slide', 'slides/slide1.xml')),
    'ppt/slides/slide1.xml': `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="${a}" xmlns:r="${r}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Material title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${MATERIAL_TEXT}</a:t></a:r></a:p></p:txBody></p:sp><p:pic><p:nvPicPr><p:cNvPr id="3" name="Circuit diagram"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="image"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld></p:sld>`,
    'ppt/slides/_rels/slide1.xml.rels': rels(relationship('image', 'image', '../media/diagram.png')),
    'ppt/media/diagram.png': diagramPng(),
  })
  return zipSync(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, typeof bytes === 'string' ? strToU8(bytes) : bytes])))
}
export function r19LessonMaterials() {
  return [{ format: 'pdf', bytes: pdf() }, { format: 'docx', bytes: office('docx') }, { format: 'pptx', bytes: office('pptx') }].map(item => ({ ...item, name: `circuit.${item.format}` }))
}
