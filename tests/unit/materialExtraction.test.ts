import { describe, expect, it, vi } from 'vitest'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { extractOfficeMaterial } from '../../src/renderer/project/materialExtraction'
import { diagramPng, MATERIAL_TEXT, r19LessonMaterials } from '../fixtures/r19LessonMaterials'
import { parallelCircuitPng, r19ParallelLessonMaterials } from '../fixtures/r19ParallelLessonMaterials'

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.min.mjs' }))

describe('Office material picture geometry', () => {
  it('extracts the manual lesson parallel-branch evidence and its actual circuit diagram without gaps', () => {
    const fixture = r19ParallelLessonMaterials().find(item => item.format === 'pptx')!
    const output = extractOfficeMaterial(fixture.bytes, 'pptx')
    expect(output.fragments.map(item => item.text ?? '').join('\n')).toContain('只取下L1，L2仍有经电源的闭合通路')
    expect(output.fragments.map(item => item.text ?? '').join('\n')).toContain('不能直接认定电源失效')
    expect(Array.from(output.assets[0].bytes)).toEqual(Array.from(parallelCircuitPng()))
    expect(output.gaps).toEqual([])
  })
  it.each(['docx', 'pptx'] as const)('reads real %s picture pixels without treating its rectangular frame as an unread shape', format => {
    const fixture = r19LessonMaterials().find(item => item.format === format)!
    const output = extractOfficeMaterial(fixture.bytes, format)
    expect(output.fragments.some(item => item.text === MATERIAL_TEXT)).toBe(true)
    expect(Array.from(output.assets[0].bytes)).toEqual(Array.from(diagramPng()))
    expect(output.fragments.some(item => item.kind === 'image')).toBe(true)
    expect(output.gaps).toEqual([])
  })
  it('retains genuine independent shape, custom geometry, and missing-image gaps', () => {
    const fixture = r19LessonMaterials().find(item => item.format === 'docx')!
    const files = unzipSync(fixture.bytes)
    const source = strFromU8(files['word/document.xml'])
    files['word/document.xml'] = strToU8(source.replace('<w:sectPr/>', '<w:drawing><a:sp><a:spPr><a:prstGeom prst="rect"/><a:custGeom/></a:spPr></a:sp></w:drawing><w:sectPr/>'))
    delete files['word/media/diagram.png']
    const output = extractOfficeMaterial(zipSync(files), 'docx')
    expect(output.gaps.map(item => item.reason)).toEqual(expect.arrayContaining([
      '需要复核未展开图形或对象：prstGeom', '需要复核未展开图形或对象：custGeom', '图片关系缺失或为外部链接',
    ]))
    expect(output.assets).toEqual([])
  })
})
