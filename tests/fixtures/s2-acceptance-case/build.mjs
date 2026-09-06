export const apiVersion = 2

export default async function build({ api, documents }) {
  if (!documents.teachingPlan.content.includes('分母') || !documents.presentationScript.content.includes('无限画布')) throw new Error('缺少已确认教学输入')
  const session = await api.createCourseProject({ surfaceType: 'slide', title: '分数：从整体到份数' })
  const append = async (tool, input, parent = { kind: 'owner' }, insertion = { kind: 'append' }) => {
    const scope = await session.createScope({ parent, insertion })
    const receipt = await session.execute(tool, input, { kind: 'create', scope })
    if (receipt.status !== 'committed') throw new Error(`${receipt.requestId} ${tool}: ${JSON.stringify(receipt.diagnostics)}`)
    return receipt
  }
  const active = async owner => {
    const snapshot = await session.snapshot()
    return session.activate({ locationId: snapshot.scope.locationId, owner, stateId: null })
  }
  const smallText = async (text, x, y, width = 550, height = 100) => {
    const receipt = await append('native.content', { operation: 'insert', template: { nativeType: 'text', text, x, y, width, height } })
    const snapshot = await session.snapshot()
    const surface = snapshot.project.surfaces.find(s => s.id === snapshot.scope.surfaceId)
    const scene = surface.scenes.find(s => s.id === snapshot.scope.locationId || snapshot.project.locations.some(l => l.id === snapshot.scope.locationId && l.sceneId === s.id))
    const item = scene.layerItems.find(i => i.layerItemId === receipt.affected[0].id)
    const content = structuredClone(item.content); content.data.style.fontSize = 24
    const update = await session.execute('native.content', { operation: 'content', content }, { kind: 'update', target: snapshot.targets.content.find(t => t.itemId === item.layerItemId) })
    if (update.status !== 'committed') throw new Error(JSON.stringify(update.diagnostics))
  }
  await append('native.content', { operation: 'insert', template: { nativeType: 'text', text: '把一个整体平均分成若干份，分母表示总份数，分子表示所取份数。', x: 60, y: 70, width: 1100, height: 130 } })
  await active('global')
  const fallback = await append('asset.media.import', { kind: 'image', filename: 'fraction.svg', mimeType: 'image/svg+xml',
    base64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="220"><rect width="600" height="220" fill="#e0f2fe"/><text x="50" y="130" font-size="48" fill="#075985">1/2 → 1/4</text></svg>').toString('base64') })
  await active('scene')
  const manifest = { schemaVersion: 4, runtimeApiVersion: 4, id: 'fraction-toggle', name: '分数观察', version: '1.0.0', entry: 'runtime.js',
    defaultSize: { width: 600, height: 220 }, minSize: { width: 300, height: 120 }, preserveAspectRatio: false, assets: {}, defaultProps: {}, supportedScopes: ['scene'], renderMode: 'dom', editor: { properties: [] } }
  const source = `CoursewareComponent.define({id:'fraction-toggle',runtimeApiVersion:4,create(ctx){
    var button=document.createElement('button');var denominator=2;
    button.style.cssText='width:100%;height:100%;border:0;border-radius:16px;background:#075985;color:white;font:36px sans-serif';
    function render(){button.textContent='1/'+denominator+' · 点击改变总份数'}render();
    button.onclick=function(){denominator=denominator===2?4:2;render()};ctx.dom.root.appendChild(button);
    return {destroy(){button.onclick=null;button.remove()}};
  }})`
  await append('component.insert', { operation: 'candidate', staticFallbackAssetId: fallback.affected[0].id,
    files: { 'manifest.json': Buffer.from(JSON.stringify(manifest)).toString('base64'), 'runtime.js': Buffer.from(source).toString('base64') } })
  const current = await session.snapshot()
  await append('recipe.apply', { recipeId: 'choice-feedback-v1', slots: { title: '分母表示什么？', options: '所取份数\n平均分的总份数', correct: '2', success: '正确：分母表示平均分的总份数。', failure: '再看定义：分子才表示所取份数。' } },
    { kind: 'course-locations' }, { kind: 'after', siblingId: current.scope.locationId })
  await smallText('答案：A. 所取份数', 60, 660, 1100, 45)
  await active('global')
  await append('course.navigation', { operation: 'add-surface', surfaceType: 'flow', title: '分数复习讲义' }, { kind: 'course-locations' })
  const flowSnapshot = await session.snapshot()
  const flowHeading = flowSnapshot.project.surfaces.find(surface => surface.id === flowSnapshot.scope.surfaceId).blocks[0]
  const headingReceipt = await session.execute('flow.content', { operation: 'replace', block: { ...flowHeading, text: '分数复习讲义' } },
    { kind: 'update', target: flowSnapshot.targets.content.find(target => target.itemId === flowHeading.id) })
  if (headingReceipt.status !== 'committed') throw new Error(JSON.stringify(headingReceipt))
  await append('flow.content', { operation: 'insert', block: { type: 'paragraph', text: '分母表示平均分的总份数；分子表示所取份数。' } }, { kind: 'flow-body', parentBlockId: null })
  await append('flow.content', { operation: 'insert', block: { type: 'table', columns: [{ id: 'fraction', header: '分数' }, { id: 'meaning', header: '含义' }], rows: [
    { id: 'half', cells: { fraction: '1/2', meaning: '平均分成两份，取一份' } }, { id: 'quarter', cells: { fraction: '1/4', meaning: '平均分成四份，取一份' } },
  ] } }, { kind: 'flow-body', parentBlockId: null })
  await active('global')
  await append('course.navigation', { operation: 'add-surface', surfaceType: 'spatial-2d', title: '分数关系图' }, { kind: 'course-locations' })
  const half = await append('native.content', { operation: 'insert', template: { nativeType: 'text', text: '1/2：整体平均分成两份', x: 80, y: 160, width: 420, height: 100 } })
  const quarter = await append('native.content', { operation: 'insert', template: { nativeType: 'text', text: '1/4：整体平均分成四份', x: 720, y: 160, width: 420, height: 100 } })
  await append('spatial.structure', { operation: 'add-path', path: { name: '观察两种分数', layerItemIds: [half.affected[0].id, quarter.affected[0].id] } })
  await append('spatial.structure', { operation: 'add-relation', relation: { sourceLayerItemId: half.affected[0].id, targetLayerItemId: quarter.affected[0].id, kind: 'arrow' } })
  await append('spatial.structure', { operation: 'add-camera', pose: { x: 280, y: 210, zoom: 1.2 }, name: '观察二分之一' }, { kind: 'course-locations' })
  await active('global')
  await append('course.navigation', { operation: 'add-surface', surfaceType: 'slide', title: 'S2 内容检查演练（故意保留错误）' }, { kind: 'course-locations' })
  await smallText('验收专用：以下三处故意错误，请用“工程检查”定位并修正。选择题页另有一处错误答案声明。', 60, 35, 1150, 110)
  await smallText('公式：frac(', 60, 180)
  await smallText('来源：待补', 60, 310)
  const chart = await append('native.content', { operation: 'insert', template: { nativeType: 'chart', x: 660, y: 200, width: 560, height: 390 } })
  const chartSnapshot = await session.snapshot()
  const surface = chartSnapshot.project.surfaces.find(s => s.id === chartSnapshot.scope.surfaceId)
  const chartItem = surface.scenes.flatMap(s => s.layerItems).find(i => i.layerItemId === chart.affected[0].id)
  const data = chartItem.content.data
  const series = data.series[0], category = data.categories[0]
  await smallText(`图表：${data.title} / ${series.name} / ${category.label} = 999`, 60, 450)
  return session.finish()
}
