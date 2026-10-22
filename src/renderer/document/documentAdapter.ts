import { type Node as PMNode, type Mark } from 'prosemirror-model'
import { documentBlockSchema, documentContentSchema, documentVisibleTextSlots, normalizeDocumentText, type DocumentBlock, type DocumentContent, type FlowInline, type FlowTextContent } from '../../shared/document/content'
import type { DocumentPoint, DocumentSlot } from '../../shared/document/ports'
import { documentEditorSchema as schema } from './editorSchema'
import { TableMap } from 'prosemirror-tables'

function inlineNodes(content: FlowTextContent): PMNode[] {
  return content.inlines.flatMap(atom => {
    const marks: Mark[] = []
    if (atom.rangeIds?.length) marks.push(schema.marks.range.create({ ids: atom.rangeIds }))
    if (atom.style) marks.push(schema.marks.style.create({ value: atom.style }))
    if (atom.link) marks.push(schema.marks.link.create(atom.link))
    if (atom.type === 'math') return [schema.nodes.math.create({ data: atom }, null, marks)]
    if (atom.type === 'component') return [schema.nodes.inline_component.create({ data: atom }, null, marks)]
    if (atom.code) marks.push(schema.marks.code.create())
    return atom.text.split('\n').flatMap((part, index) => [...(index ? [schema.nodes.hard_break.create(null, null, marks)] : []), ...(part ? [schema.text(part, marks)] : [])])
  })
}
export function readEditorMath(child:PMNode):Extract<FlowInline,{type:'math'}> {
  const atom=structuredClone(child.attrs.data) as Extract<FlowInline,{type:'math'}>
  delete atom.style;delete atom.link;delete atom.rangeIds
  for(const mark of child.marks) {
    if(mark.type.name==='style'){const value=mark.attrs.value;const style={...(value.fontSize!==undefined ? {fontSize:value.fontSize}:{}),...(value.color!==undefined ? {color:value.color}:{})};if(Object.keys(style).length)atom.style=style}
    if(mark.type.name==='range')atom.rangeIds=mark.attrs.ids
    if(mark.type.name==='link')atom.link={href:mark.attrs.href,...(mark.attrs.title ? {title:mark.attrs.title}:{})}
  }
  return atom
}
function readInlines(node: PMNode): FlowTextContent {
  const inlines: FlowInline[] = []
  node.forEach(child => {
    if (child.type.name === 'math') {
      inlines.push(readEditorMath(child)); return
    }
    const atom: FlowInline = child.type.name === 'inline_component' ? { ...structuredClone(child.attrs.data), rangeIds: undefined } : { type: 'text', text: child.type.name === 'hard_break' ? '\n' : child.text ?? '' }
    for (const mark of child.marks) {
      if (mark.type.name === 'style') atom.style = mark.attrs.value
      if (mark.type.name === 'code' && atom.type === 'text') atom.code = true
      if (mark.type.name === 'range') atom.rangeIds = mark.attrs.ids
      if (mark.type.name === 'link') atom.link = { href: mark.attrs.href, ...(mark.attrs.title ? { title: mark.attrs.title } : {}) }
    }
    inlines.push(atom)
  })
  return normalizeDocumentText({ inlines })
}
function blockNode(block: DocumentBlock): PMNode {
  const { id, ...fields } = block
  const data = structuredClone('blocks' in fields ? { ...fields, blocks: [] } : fields)
  const attrs = { id, data }
  switch (block.type) {
    case 'table': {
      const slots = documentVisibleTextSlots(block)
      const firstCell = block.headerEnabled === false ? schema.nodes.table_cell : schema.nodes.table_header
      const header = schema.nodes.table_row.create(null, slots.filter(slot => slot.tableCell?.rowId === null).map(slot => firstCell.create(null,
        schema.nodes.slot.create({ key: slot.key }, inlineNodes(slot.content)))))
      const rows = block.rows.map(row => schema.nodes.table_row.create(null, slots.filter(slot => slot.tableCell?.rowId === row.id).map(slot =>
        schema.nodes.table_cell.create({ colspan: slot.tableCell!.columnSpan, rowspan: slot.tableCell!.rowSpan },
          schema.nodes.slot.create({ key: slot.key }, inlineNodes(slot.content))))))
      return schema.nodes.table_container.create(attrs, [...slots.filter(slot => !slot.tableCell).map(slot =>
        schema.nodes.slot.create({ key: slot.key }, inlineNodes(slot.content))), schema.nodes.table.create(null, [...(block.headerEnabled === false ? [] : [header]), ...rows])])
    }
    case 'paragraph': case 'heading': return schema.nodes[block.type].create(attrs, inlineNodes(block.content))
    case 'formula': return schema.nodes.formula.create(attrs)
    case 'code': return schema.nodes.code_block.create(attrs, block.code ? schema.text(block.code) : undefined)
    case 'section': return schema.nodes.section.create(attrs, [schema.nodes.slot.create({ key: 'title' }, inlineNodes(block.title)), ...block.blocks.map(blockNode)])
    case 'course-instance': return block.blocks ? schema.nodes.layout_group.create(attrs, block.blocks.map(blockNode)) : schema.nodes.object.create(attrs)
    default: {
      const slots = documentVisibleTextSlots(block)
      return slots.length ? schema.nodes.compound.create(attrs, slots.map(slot => schema.nodes.slot.create({ key: slot.key }, inlineNodes(slot.content)))) : schema.nodes.object.create(attrs)
    }
  }
}
export const toEditorDocument = (content: DocumentContent): PMNode => schema.nodes.doc.create(null, content.blocks.map(blockNode))

function setSlot(block: DocumentBlock, key: string, content: FlowTextContent): void {
  if (block.type === 'list' && key.startsWith('item:')) { block.items.find(i => i.id === key.slice(5))!.content = content; return }
  if (block.type === 'table') {
    if (key.startsWith('column:')) { block.columns.find(c => c.id === key.slice(7))!.header = content; return }
    if (key.startsWith('cell:')) { const [r, c] = JSON.parse(key.slice(5)); block.rows.find(row => row.id === r)!.cells[c] = content; return }
  }
  Object.assign(block, { [key]: content })
}
function readBlock(node: PMNode): DocumentBlock {
  const block = { ...structuredClone(node.attrs.data), id: node.attrs.id } as DocumentBlock
  if (node.type.name === 'paragraph' || node.type.name === 'heading') {
    const { code: _code, language: _language, ...fields } = block as DocumentBlock & { code?: string; language?: string }
    const result = { ...fields, type: node.type.name, content: readInlines(node) } as DocumentBlock
    if (result.type === 'paragraph') delete (result as unknown as Record<string, unknown>).level
    return result
  }
  if (block.type === 'code') block.code = node.textContent
  if (block.type === 'list') {
    block.items = []
    node.forEach(child => { block.items.push({ id: child.attrs.key.slice(5), content: readInlines(child) }) })
    return block
  }
  if (block.type === 'section' || block.type === 'course-instance' && node.type.name === 'layout_group') block.blocks = []
  if (block.type === 'quote') { block.content = { inlines: [] }; delete block.citation }
  if (block.type === 'callout') { block.body = { inlines: [] }; delete block.title }
  if (block.type === 'media') delete block.caption
  if (block.type === 'table') {
    node.descendants(child => { if (child.type.name === 'slot') { setSlot(block, child.attrs.key, readInlines(child)); return false } })
    return block
  }
  node.forEach(child => {
    if (child.type.name === 'slot') setSlot(block, child.attrs.key, readInlines(child))
    else if (block.type === 'section' || block.type === 'course-instance' && block.blocks) block.blocks!.push(readBlock(child))
  })
  return block
}
export function fromEditorDocument(node: PMNode): DocumentContent {
  const blocks: DocumentBlock[] = []
  node.forEach(child => blocks.push(readBlock(child)))
  return documentContentSchema.parse({ blocks })
}
/** Read the requested professional block without converting unrelated document content. */
export function fromEditorBlock(node: PMNode): DocumentBlock {
  return documentBlockSchema.parse(readBlock(node))
}
export function editorPositionToPoint(doc: PMNode, position: number, affinity: 'before' | 'after' = 'after'): DocumentPoint | null {
  const resolved = doc.resolve(position)
  if (!resolved.parent.isTextblock) return null
  let blockDepth = resolved.depth
  while (blockDepth > 0 && !resolved.node(blockDepth).attrs.id) blockDepth--
  if (!blockDepth) return null
  const key: string = resolved.parent.attrs.key ?? 'content'
  let slot: DocumentSlot = { kind: 'field', field: key as 'content' }
  if (key.startsWith('item:')) slot = { kind: 'item', itemId: key.slice(5) }
  if (key.startsWith('column:')) slot = { kind: 'header', columnId: key.slice(7) }
  if (key.startsWith('cell:')) { const [rowId, columnId] = JSON.parse(key.slice(5)); slot = { kind: 'cell', rowId, columnId } }
  let offset = 0
  resolved.parent.forEach((child, start) => {
    const consumed = Math.min(child.nodeSize, Math.max(0, resolved.parentOffset - start))
    offset += child.isText ? Array.from((child.text ?? '').slice(0, consumed)).length : consumed > 0 ? 1 : 0
  })
  return { blockId: resolved.node(blockDepth).attrs.id, slot, offset, affinity }
}

/** Identity repair is performed only at an editor split/paste boundary, never by source parsing. */
export function renewEditorIdentities(doc: PMNode, createId: () => string, copied = false): PMNode {
  const seen = new Set<string>()
  const visit = (node: PMNode, inherited = new Map<string, string>()): PMNode => {
    const attrs = { ...node.attrs }
    const ids = new Map(inherited)
    const renew = (id: string) => { const value = createId(); ids.set(id, value); return value }
    if ('id' in attrs) {
      const duplicate = attrs.data?.type !== 'course-instance' && (!attrs.id || copied || seen.has(attrs.id))
      if (duplicate) {
        attrs.id = renew(attrs.id)
        attrs.data = structuredClone(attrs.data)
        if (attrs.data.type === 'list') attrs.data.items.forEach((item: { id: string }) => { item.id = renew(item.id) })
        if (attrs.data.type === 'table') {
          attrs.data.columns.forEach((column: { id: string }) => { column.id = renew(column.id) })
          attrs.data.rows.forEach((row: { id: string; cells: Record<string, FlowTextContent> }) => {
            row.id = renew(row.id); row.cells = Object.fromEntries(Object.entries(row.cells).map(([key, value]) => [ids.get(key) ?? key, value]))
          })
          attrs.data.merges?.forEach((merge: { rowIds: string[]; columnIds: string[] }) => { merge.rowIds = merge.rowIds.map(id => ids.get(id) ?? id); merge.columnIds = merge.columnIds.map(id => ids.get(id) ?? id) })
        }
      }
      seen.add(attrs.id)
    }
    if (attrs.key?.startsWith('item:')) attrs.key = `item:${ids.get(attrs.key.slice(5)) ?? attrs.key.slice(5)}`
    if (attrs.key?.startsWith('column:')) attrs.key = `column:${ids.get(attrs.key.slice(7)) ?? attrs.key.slice(7)}`
    if (attrs.key?.startsWith('cell:')) attrs.key = `cell:${JSON.stringify(JSON.parse(attrs.key.slice(5)).map((id: string) => ids.get(id) ?? id))}`
    if (node.type.name === 'math' || node.type.name === 'formula') {
      if (copied || seen.has(attrs.data.formulaId)) attrs.data = { ...attrs.data, formulaId: createId() }
      seen.add(attrs.data.formulaId)
    }
    const children: PMNode[] = []
    node.forEach(child => children.push(visit(child, ids)))
    if(node.type.name==='table_container' && attrs.data.type==='table') {
      const tableIndex=children.findIndex(child=>child.type.name==='table'), table=children[tableIndex]
      if(table) {
        const map=TableMap.get(table)
        attrs.data=structuredClone(attrs.data)
        const headerRows=attrs.data.headerEnabled===false ? 0:1
        while(attrs.data.columns.length<map.width)attrs.data.columns.push({id:createId(),header:{inlines:[]}})
        while(attrs.data.rows.length<map.height-headerRows)attrs.data.rows.push({id:createId(),cells:{}})
        for(const row of attrs.data.rows)for(const column of attrs.data.columns)row.cells[column.id] ??= {inlines:[]}
        const merges:{rowIds:string[];columnIds:string[]}[]=[]
        const rows:PMNode[]=[]
        table.forEach((row,rowOffset,rowIndex)=>{
          const header=attrs.data.headerEnabled!==false && rowIndex===0
          const formalRow=attrs.data.rows[rowIndex-(attrs.data.headerEnabled===false ? 0:1)]
          const cells:PMNode[]=[]
          row.forEach((cell,cellOffset)=>{
            const rect=map.findCell(rowOffset+1+cellOffset),column=attrs.data.columns[rect.left]
            if(!header && (cell.attrs.colspan>1 || cell.attrs.rowspan>1))merges.push({rowIds:attrs.data.rows.slice(rect.top-headerRows,rect.bottom-headerRows).map((row:{id:string})=>row.id),columnIds:attrs.data.columns.slice(rect.left,rect.right).map((column:{id:string})=>column.id)})
            const key=column && (header ? `column:${column.id}`:formalRow && `cell:${JSON.stringify([formalRow.id,column.id])}`)
            const slot=cell.firstChild
            cells.push(key && slot ? cell.type.create(cell.attrs,schema.nodes.slot.create({key},slot.content),cell.marks):cell)
          })
          rows.push(row.type.create(row.attrs,cells,row.marks))
        })
        if(merges.length || attrs.data.merges)attrs.data.merges=merges
        children[tableIndex]=table.type.create(table.attrs,rows,table.marks)
      }
    }
    return node.isText ? node : node.type.create(attrs, children, node.marks)
  }
  return visit(doc)
}
