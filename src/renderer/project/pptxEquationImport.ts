import { read as readCompoundFile } from 'cfb'
import { sceneNodeToCourseLayerItem } from '../../shared/courseProjectModel'
import { formulaAstToAccessibleText } from '../../shared/formulaLinear'
import { analyzeFormulaNodeLayout } from '../../shared/formulaRenderer'
import { createFormulaNode } from './nativeNodeFactories'
import { parseMtefEquation } from './mtefEquation'
import { pptxReject, pptxRelationshipId, xmlFirst, type PptxPackage, type PptxImportIssue } from './pptxPackage'

const reject = (message: string): never => pptxReject('旧版公式（OLE）', message)

export function readEquationOle(bytes: Uint8Array) {
  if (bytes.length > 2_000_000 || ![0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, i) => bytes[i] === value)) return reject('公式容器不是受支持的 Compound File')
  try {
    const container = readCompoundFile(bytes, { type: 'array' })
    const streams = container.FileIndex.filter(entry => entry.type === 2 && entry.name === 'Equation Native')
    if (streams.length !== 1) return reject('公式容器需要唯一的 Equation Native 数据流')
    const native = Uint8Array.from(streams[0]!.content)
    if (native.length < 28 || native.length > 65_564) return reject('公式数据流长度无效')
    const header = new DataView(native.buffer, native.byteOffset, native.byteLength)
    if (header.getUint16(0, true) !== 28 || header.getUint32(8, true) !== native.length - 28) return reject('公式头部或内容长度不匹配')
    return parseMtefEquation(native.subarray(28))
  } catch (error) { return reject(error instanceof Error ? error.message : '无法读取公式数据') }
}

export function parsePptxEquation(
  object: Element, pkg: PptxPackage, path: string, scale: number,
  origin: { x: number; y: number }, page: number, issues: PptxImportIssue[],
) {
  const ole = xmlFirst(object, 'oleObj')
  if (!ole) return undefined
  const program = ole.getAttribute('progId') ?? ''
  // PowerPoint can omit progId (including all 27 reference placements). In that
  // case identify the format from the unique validated Equation Native stream.
  if (program && !/^(?:Equation\.(?:3|DSMT4)|MathType(?:\.[\w]+)?)$/i.test(program)) return pptxReject('OLE 嵌入对象', '暂不支持此嵌入对象的可编辑转换')
  const relationship = pkg.relationships(path).find(entry => entry.id === pptxRelationshipId(ole))
  if (!relationship || relationship.external || !relationship.type.endsWith('/oleObject') || !pkg.files[relationship.target]) return reject('公式关系缺失、类型错误或指向外部')
  const { ast, color } = readEquationOle(pkg.files[relationship.target]!)
  const transform = xmlFirst(object, 'xfrm')
  const off = transform && xmlFirst(transform, 'off'), ext = transform && xmlFirst(transform, 'ext')
  const number = (node: Element | undefined, attribute: string, fallback?: number) => {
    const raw = node?.getAttribute(attribute)
    const value = raw === undefined || raw === null ? fallback : Number(raw)
    if (value === undefined || !Number.isFinite(value)) return reject(`公式几何 ${attribute} 无效`)
    return value
  }
  if (['flipH', 'flipV'].some(key => ['1', 'true'].includes(transform?.getAttribute(key) ?? ''))) return reject('暂不支持翻转公式')
  const node = createFormulaNode({
    name: xmlFirst(object, 'cNvPr')?.getAttribute('name') || '导入公式',
    x: number(off, 'x') * scale + origin.x, y: number(off, 'y') * scale + origin.y,
    width: number(ext, 'cx') * scale, height: number(ext, 'cy') * scale,
    rotation: number(transform, 'rot', 0) / 60000,
    visible: !['1', 'true'].includes(xmlFirst(object, 'cNvPr')?.getAttribute('hidden') ?? ''),
    ast, accessibleText: formulaAstToAccessibleText(ast), style: { color, fontSize: 12, align: 'center' },
  })
  if (node.width <= 0 || node.height <= 0) return reject('公式宽高必须大于零')
  // Match the existing renderer's actual layout to the source box. Source MathType
  // font metrics and spacing cannot be represented by the current Native contract.
  let low = 12, high = 200
  for (let i = 0; i < 12; i++) {
    node.style.fontSize = (low + high) / 2
    const layout = analyzeFormulaNodeLayout(node)
    if (layout.overflowsWidth || layout.overflowsHeight) high = node.style.fontSize
    else low = node.style.fontSize
  }
  node.style.fontSize = low
  const layout = analyzeFormulaNodeLayout(node)
  if (layout.overflowsWidth || layout.overflowsHeight) return reject('源公式区域过小，当前最小字号无法完整呈现')
  issues.push({ page, type: '公式排版', message: `“${node.name}”已转为可编辑公式，保留内容、颜色和对象位置；字体与间距按编辑器公式样式呈现` })
  return sceneNodeToCourseLayerItem(node, 0)
}
