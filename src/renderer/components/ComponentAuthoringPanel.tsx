import { useRef } from 'react'
import type { ComponentEdit, ComponentImplementation, ComponentInstance, JsonValue } from '../../shared/contracts/component-platform'
import { ComponentSourceEditor } from './ComponentSourceEditor'
import type { CourseV10DocumentBridge } from '../documents/CourseV10DocumentBridge'
import { TextComponentEditor, FormulaComponentEditor } from '../../components/text/editor'
import { textDataSchema, formulaDataSchema } from '../../components/text'
import { TableComponentEditor } from '../../components/table/editor'
import { tableDataSchema } from '../../components/table/data'
import { ChartEditor } from '../../components/chart/editor'
import { chartDataSchema } from '../../components/chart/data'
import { shapeDataSchema } from '../../components/shape/data'
import { imageDataSchema } from '../../components/image/data'

/** Professional editing delegates every author mutation to the document projection. */
export function ComponentAuthoringPanel({ instance, definitionKey, implementation, revision, bridge, submit, report, documentId }: {
  instance: ComponentInstance; definitionKey: string; implementation: ComponentImplementation; revision: number; bridge: CourseV10DocumentBridge
  submit(edits: ComponentEdit[], historyGroup?: string): Promise<void>; report(message: string): void
  documentId?: string
}) {
  const composing = useRef(false)
  const json = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue
  const dataEdit = (data: unknown, group?: string) => submit([{ type: 'data.set', instanceId: instance.id, path: [], value: json(data) }], group)
  const text = definitionKey === 'guoling.text' ? textDataSchema.safeParse(instance.data) : null
  const formula = definitionKey === 'guoling.formula' ? formulaDataSchema.safeParse(instance.data) : null
  const frame = instance.frame
  return <aside aria-label="组件编辑" style={{ padding: 16, minWidth: 300, maxWidth: 620, overflow: 'auto', background: '#fff' }}>
    <strong>{definitionKey}</strong>
    <ComponentSourceEditor instance={instance} implementation={instance.implementationOverride ?? implementation} bridge={bridge} report={report} documentId={documentId} />
    <button onClick={() => submit([{ type: 'instance.remove', instanceId: instance.id }])}>删除组件</button>
    {frame && <fieldset><legend>位置与尺寸</legend>
      {(['width', 'height'] as const).map(field => <label key={field}>{field === 'width' ? '宽' : '高'}<input type="number" min={1} value={frame[field]}
        onChange={event => { const value = event.target.valueAsNumber; if (Number.isFinite(value) && value > 0) submit([{ type: 'frame.set', instanceId: instance.id, frame: { ...frame, [field]: value } }]) }} /></label>)}
      {([4, 5] as const).map(index => <label key={index}>{index === 4 ? 'X' : 'Y'}<input type="number" value={frame.transform[index]}
        onChange={event => { const value = event.target.valueAsNumber; if (!Number.isFinite(value)) return; const transform = [...frame.transform] as typeof frame.transform; transform[index] = value; submit([{ type: 'frame.set', instanceId: instance.id, frame: { ...frame, transform } }]) }} /></label>)}
    </fieldset>}
    {text?.success && <div onCompositionStartCapture={() => {
      if (!composing.current) { composing.current = true; bridge.beginComposition(instance.id, ['content'], documentId) }
    }} onCompositionEndCapture={() => { setTimeout(() => {
      if (!composing.current) return
      composing.current = false; void bridge.endComposition(documentId).catch(error => report(String(error)))
    }, 0) }}><TextComponentEditor data={text.data} revision={String(revision)}
      onUndo={() => void bridge.undo().catch(error => report(String(error)))} onRedo={() => void bridge.redo().catch(error => report(String(error)))} onDiagnostic={report}
      onChange={async (data, operation) => {
        try {
        if (composing.current) await bridge.updateComposition(json(data.content), documentId)
        else await submit([{ type: 'data.set', instanceId: instance.id, path: ['content'], value: json(data.content) },
          { type: 'data.set', instanceId: instance.id, path: ['appearance'], value: json(data.appearance) }], operation.historyGroup)
        return true
        } catch (error) { report(error instanceof Error ? error.message : String(error)); return false }
      }} /></div>}
    {formula?.success && <FormulaComponentEditor data={formula.data} revision={String(revision)}
      onChange={async (data, operation) => { try { await dataEdit(data, operation.historyGroup); return true }
        catch (error) { report(error instanceof Error ? error.message : String(error)); return false } }} onUndo={() => void bridge.undo().catch(error => report(String(error)))}
      onRedo={() => void bridge.redo().catch(error => report(String(error)))} onDiagnostic={report} />}
    {definitionKey === 'guoling.table' && <TableComponentEditor instanceId={instance.id} data={tableDataSchema.parse(instance.data)} onEdit={edit => submit([edit])}
      onUndo={() => void bridge.undo().catch(error => report(String(error)))} onRedo={() => void bridge.redo().catch(error => report(String(error)))} />}
    {definitionKey === 'guoling.chart' && <ChartEditor instanceId={instance.id} data={chartDataSchema.parse(instance.data)} onEdit={edit => submit([edit])} />}
    {definitionKey === 'guoling.shape' && (() => { const data = shapeDataSchema.parse(instance.data); return <fieldset><legend>形状</legend>
      <label>填充<input type="color" value={data.style.fillColor} onChange={event => submit([{ type: 'data.set', instanceId: instance.id, path: ['style', 'fillColor'], value: event.target.value }])} /></label>
      <label>边线<input type="color" value={data.style.borderColor} onChange={event => submit([{ type: 'data.set', instanceId: instance.id, path: ['style', 'borderColor'], value: event.target.value }])} /></label>
    </fieldset> })()}
    {definitionKey === 'guoling.image' && (() => { const data = imageDataSchema.parse(instance.data); return <fieldset><legend>图片</legend>
      <label>替代文字<input value={data.alt} onChange={event => submit([{ type: 'data.set', instanceId: instance.id, path: ['alt'], value: event.target.value }])} /></label>
      <label>适配<select value={data.fit} onChange={event => submit([{ type: 'data.set', instanceId: instance.id, path: ['fit'], value: event.target.value }])}>
        <option value="contain">完整显示</option><option value="cover">填满裁切</option><option value="stretch">拉伸</option>
      </select></label>
    </fieldset> })()}
  </aside>
}
