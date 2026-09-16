import { strFromU8, strToU8, unzipSync, zipSync, zlibSync } from 'fflate'
import { r19LessonMaterials } from './r19LessonMaterials'

// Material for teaching, distinct from the small extraction regression fixtures.
// L1 and L2 occupy separate branches between the same junctions A and B.
function chunk(type: string, bytes: Uint8Array) {
  const data = Buffer.concat([Buffer.from(type), bytes]); let crc = 0xffffffff
  for (const byte of data) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) }
  const size = Buffer.alloc(4); size.writeUInt32BE(bytes.length)
  const tail = Buffer.alloc(4); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([size, data, tail])
}
export function parallelCircuitPng(): Uint8Array {
  const width = 640, height = 380, stride = width * 3 + 1
  const data = Buffer.alloc(height * stride, 255)
  for (let y = 0; y < height; y++) data[y * stride] = 0
  function pixel(x: number, y: number) { if (x >= 0 && x < width && y >= 0 && y < height) { const i = Math.round(y) * stride + 1 + Math.round(x) * 3; data[i] = 20; data[i + 1] = 38; data[i + 2] = 60 } }
  function line(x1: number, y1: number, x2: number, y2: number) {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1))
    for (let i = 0; i <= steps; i++) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) pixel(x1 + (x2 - x1) * i / steps + dx, y1 + (y2 - y1) * i / steps + dy)
  }
  function lamp(y: number) {
    line(100, y, 286, y); line(354, y, 540, y)
    for (let angle = 0; angle < 360; angle++) { const rad = angle * Math.PI / 180; for (let radius = 32; radius <= 34; radius++) pixel(Math.round(320 + radius * Math.cos(rad)), Math.round(y + radius * Math.sin(rad))) }
    line(297, y - 23, 343, y + 23); line(297, y + 23, 343, y - 23)
  }
  const font: Record<string, string[]> = {
    L: ['10000','10000','10000','10000','10000','10000','11111'],
    '1': ['00100','01100','00100','00100','00100','00100','01110'],
    '2': ['01110','10001','00001','00010','00100','01000','11111'],
    S: ['01111','10000','10000','01110','00001','00001','11110'],
    A: ['01110','10001','10001','11111','10001','10001','10001'],
    B: ['11110','10001','10001','11110','10001','10001','11110'],
    '+': ['00000','00100','00100','11111','00100','00100','00000'],
    '-': ['00000','00000','00000','11111','00000','00000','00000'],
  }
  function label(text: string, x: number, y: number) { for (const char of text) { font[char]?.forEach((row, ry) => [...row].forEach((bit, rx) => { if (bit === '1') for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) pixel(x + rx * 3 + dx, y + ry * 3 + dy) })); x += 20 } }
  line(100, 100, 100, 310); line(540, 100, 540, 310); lamp(100); lamp(210)
  line(100, 310, 190, 310); line(190, 310, 240, 310); line(240, 310, 420, 310)
  for (const x of [190, 240]) for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) if (dx * dx + dy * dy <= 16) pixel(x + dx, 310 + dy)
  line(420, 283, 420, 337); line(438, 295, 438, 325); line(438, 310, 540, 310)
  label('L1', 302, 37); label('L2', 302, 147); label('S', 207, 340)
  label('A', 68, 90); label('B', 557, 90); label('+', 399, 253); label('-', 444, 270)
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlibSync(data)), chunk('IEND', new Uint8Array())])
}

function parallelPdf(): Uint8Array {
  const lines = [
    'Parallel circuits: separate paths, shared junctions',
    'Audience: students who already know that a lamp needs a closed path.',
    'L1 and L2 connect between the same junctions A and B in separate branches.',
    'With main switch S closed, each branch has a complete path through the cell.',
    'Prediction: remove L1. L1 goes out; L2 stays on because its path is still closed.',
    'Opening main switch S breaks both paths, so both lamps go out.',
    'Compare with a series circuit: one break interrupts the only path.',
    'Use an ideal cell and identical lamps. Observe qualitative on/off states.',
    'Evidence task: trace the surviving closed path before stating a conclusion.',
    'Do not describe an open branch as a short circuit: they are different faults.',
  ]
  const text = lines.map((line, i) => `BT /F1 ${i ? 11 : 17} Tf 35 ${755 - i * 24} Td (${line}) Tj ET`).join('\n')
  let diagram = '2 w 0.08 0.15 0.24 RG\n100 160 m 100 450 l 510 450 l 510 160 l S\n100 320 m 510 320 l S\n100 160 m 405 160 l S\n425 160 m 510 160 l S\n405 130 m 405 190 l S\n425 142 m 425 178 l S\n1 1 1 rg 275 420 60 60 re f 275 290 60 60 re f\n0.08 0.15 0.24 RG 275 420 60 60 re S 275 290 60 60 re S\n284 429 m 326 471 l 284 471 m 326 429 l S\n284 299 m 326 341 l 284 341 m 326 299 l S\nBT /F1 14 Tf 295 493 Td (L1) Tj ET\nBT /F1 14 Tf 295 363 Td (L2) Tj ET\nBT /F1 14 Tf 73 446 Td (A) Tj ET\nBT /F1 14 Tf 521 446 Td (B) Tj ET\nBT /F1 14 Tf 203 138 Td (S closed) Tj ET\nBT /F1 14 Tf 386 196 Td (+) Tj ET\nBT /F1 14 Tf 427 182 Td (-) Tj ET\nBT /F1 10 Tf 35 95 Td (Diagram: lamps L1/L2 are in parallel; S is in the common main path.) Tj ET'
  const circle = (x: number, y: number, radius: number) => {
    const k = radius * 0.55228475
    return `${x + radius} ${y} m ${x + radius} ${y + k} ${x + k} ${y + radius} ${x} ${y + radius} c ${x - k} ${y + radius} ${x - radius} ${y + k} ${x - radius} ${y} c ${x - radius} ${y - k} ${x - k} ${y - radius} ${x} ${y - radius} c ${x + k} ${y - radius} ${x + radius} ${y - k} ${x + radius} ${y} c`
  }
  diagram = diagram.replace('275 420 60 60 re S 275 290 60 60 re S', `${circle(305, 450, 30)} S ${circle(305, 320, 30)} S`)
    .replace('BT /F1 14 Tf 295 493', '0.08 0.15 0.24 rg BT /F1 14 Tf 295 493')
  diagram += `\n1 1 1 rg ${circle(195, 160, 4)} B ${circle(245, 160, 4)} B 195 160 m 245 160 l S`
  const stream = `${text}\n${diagram}\n`
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}endstream`]
  let source = '%PDF-1.4\n'; const offsets: number[] = []
  objects.forEach((object, i) => { offsets.push(source.length); source += `${i + 1} 0 obj\n${object}\nendobj\n` })
  const xref = source.length
  source += `xref\n0 6\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return strToU8(source)
}

export function r19ParallelLessonMaterials() {
  const base = r19LessonMaterials().find(item => item.format === 'pptx')!
  const files = unzipSync(base.bytes)
  const text = '并联支路的独立性：L1、L2分别连接在公共节点A、B之间。闭合干路开关S，两灯发光；只取下L1，L2仍有经电源的闭合通路，因此继续发光。断开干路S，两条通路同时断开，两灯均熄灭。检测任务：L1不亮而L2亮时，应先检查L1所在支路是否断路，不能直接认定电源失效。请沿图示描出L2仍然闭合的路径，以检测证据解释结论。材料假设理想电源、相同灯泡，只比较亮与灭，不讨论实际电池内阻造成的亮度变化。'
  files['ppt/slides/slide1.xml'] = strToU8(strFromU8(files['ppt/slides/slide1.xml']).replace('Series circuit teaching material', text).replace('cx="914400" cy="914400"', 'cx="6400800" cy="3800475"'))
  files['ppt/media/diagram.png'] = new Uint8Array(parallelCircuitPng())
  return [{ format: 'pdf' as const, name: 'parallel-paths.pdf', bytes: parallelPdf() }, { format: 'pptx' as const, name: 'parallel-evidence.pptx', bytes: zipSync(files) }]
}
