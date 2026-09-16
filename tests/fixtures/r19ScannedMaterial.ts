import { zlibSync } from 'fflate'
import { decodeImageTransformPng } from '../../src/shared/imageTransform'
import { parallelCircuitPng } from './r19ParallelLessonMaterials'

/** A real image-only PDF: circuit labels and lines are pixels, with no text operators/fonts. */
export function r19ScannedMaterial(): Uint8Array {
 const image = decodeImageTransformPng(parallelCircuitPng())
 const rgb = new Uint8Array(image.width * image.height * 3)
 for (let i = 0; i < image.width * image.height; i++) rgb.set(image.data.subarray(i * 4, i * 4 + 3), i * 3)
 const pixels = Buffer.from(zlibSync(rgb))
 const drawing = Buffer.from(`q ${image.width} 0 0 ${image.height} 0 0 cm /PageImage Do Q`)
 const objects = [Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'), Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
  Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${image.width} ${image.height}] /Resources << /XObject << /PageImage 4 0 R >> >> /Contents 5 0 R >>`),
  Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${pixels.length} >>\nstream\n`), pixels, Buffer.from('\nendstream')]),
  Buffer.concat([Buffer.from(`<< /Length ${drawing.length} >>\nstream\n`), drawing, Buffer.from('\nendstream')])]
 const chunks = [Buffer.from('%PDF-1.4\n')], offsets = [0]
 let length = chunks[0].length
 objects.forEach((object, i) => { offsets.push(length); const bytes = Buffer.concat([Buffer.from(`${i+1} 0 obj\n`), object, Buffer.from('\nendobj\n')]); chunks.push(bytes); length += bytes.length })
 chunks.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`))
 return Buffer.concat(chunks)
}
