import { expect, type Page } from '@playwright/test'

export async function fractionFallback(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 400
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 800, 400)
    ctx.fillStyle = '#172554'; ctx.font = 'bold 36px sans-serif'; ctx.fillText('平均分探索', 40, 65)
    for (let index = 0; index < 4; index++) {
      ctx.fillStyle = index === 0 ? '#2563eb' : '#e2e8f0'; ctx.fillRect(40 + index * 180, 120, 172, 100)
    }
    ctx.fillStyle = '#172554'; ctx.font = '32px sans-serif'; ctx.fillText('1/4', 40, 280)
    ctx.font = '24px sans-serif'; ctx.fillText('把一个整体平均分成4份，取其中1份。', 40, 330)
    return canvas.toDataURL('image/png').split(',')[1]
  })
}

export function fractionComponentInstruction(fallbackAssetId: string): string {
  return `生成一个新的可复用 DOM Component API4 分数探索组件，组件默认尺寸1000×500、最小尺寸600×360。放在当前演示页的安全可见区域。这里需要滑块重建任意2至8等份图形并维护分子与分母联动状态，普通 Native/Recipe 或现有目录不能直接提供这个特定机制，请在候选中说明载体理由。
界面白底蓝色，标题从props.content.title读取，默认“平均分探索”。manifest.editor.properties必须含type:text、key:content.title、label:探索标题；updateProps应更新标题且保留互动数值。manifest.defaultProps.content.title必须存在。
有原生input type=range、aria-label="平均份数"，min2 max8 step1，初始4；改变滑块实时重绘等宽矩形图。图形容器role="img"、aria-label="平均分图"。初始分子1，按钮“增加一份”每次加1且不得超过分母，按钮“重置”恢复1/4。独立结果元素aria-label="分数结果"只显示形如1/4的字符串。图形染色份数与分子一致，所有文字清楚可见。说明平均分是各份同样大。
必须实现resize、suspend、resume、prepareCapture、destroy：更新尺寸和props不能丢失互动状态；销毁时移除事件监听器和DOM。不得依赖外部网络或库。不要用JSX、TS或不存在的宿主API。只需组件和后备图片，不添加其他内容。
使用当前工程已有图片${fallbackAssetId}作为staticFallbackAssetId，component.insert operation:candidate的files使用{encoding:"utf8",text:"完整文件原文"}直接返回manifest.json和runtime.js，不需要编码或工具计算。不能猜造素材或组件身份。仅返回一个严格候选，不读取文件。`
}

export async function exerciseFractionComponent(player: Page, screenshot: string): Promise<void> {
  await expect(player.getByText('平均分实验', { exact: true })).toBeVisible()
  const result = player.getByLabel('分数结果', { exact: true })
  const slider = player.getByRole('slider', { name: '平均份数', exact: true })
  await expect(result).toHaveText('1/4')
  await slider.focus(); await slider.press('ArrowRight')
  await expect(slider).toHaveValue('5'); await expect(result).toHaveText('1/5')
  await player.getByRole('button', { name: '增加一份', exact: true }).click()
  await expect(result).toHaveText('2/5')
  await player.setViewportSize({ width: 1200, height: 800 })
  await expect(result).toHaveText('2/5')
  await player.screenshot({ path: screenshot })
  await player.getByRole('button', { name: '重置', exact: true }).click()
  await expect(result).toHaveText('1/4')
  await player.getByRole('button', { name: '增加一份', exact: true }).click()
  await expect(result).toHaveText('2/4')
  await expect(player.locator('.published-component-fallback')).toHaveCount(0)
}

export async function oscillationFallback(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 400
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 800, 400)
    ctx.fillStyle = '#172554'; ctx.font = 'bold 36px sans-serif'; ctx.fillText('振动探索', 40, 65)
    ctx.strokeStyle = '#64748b'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(120, 210); ctx.lineTo(680, 210); ctx.stroke()
    ctx.fillStyle = '#2563eb'; ctx.beginPath(); ctx.arc(400, 210, 20, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#172554'; ctx.font = '26px sans-serif'; ctx.fillText('振幅决定偏离中心的最大距离。', 40, 330)
    return canvas.toDataURL('image/png').split(',')[1]
  })
}

export function oscillationRuntimeInstruction(fallbackAssetId: string): string {
  return `生成当前演示页的DOM Surface Runtime API3连续动画“振动探索”。此例是整页连续时间机制，由requestAnimationFrame驱动标记水平往复振动x=center+A*sin(phase)，周期约1.5秒。说明Runtime载体相对于Native/Recipe/局部组件的整页连续机制理由。
使用runtime.insert，仅插入一个scene-local Runtime，不修改其他对象。protocol:surface-runtime、runtimeApiVersion:3、renderMode:dom、enabled:true，assets:{}；后备图片使用当前已有${fallbackAssetId}，coverage:scene。source直接输出完整普通JS，不编码、不读取文件、不使用外部库。根据提供的API3接口实现ctx.dom.root和CoursewareRuntime.define。
白底蓝色，标题从ctx.content.get('title')读取；runtime.content.values.title为“振动探索”，metadata.title.label为“动画标题”。标题元素登记为ctx.authoring.registerText({key:'title',element:标题元素,label:'动画标题'})，保存其disposer；updateContent更新标题且保留动画状态。交互区与文字避开底部教师控制器，所有内容位于1280×600安全范围。
运动标记用DOM或SVG元素，aria-label="运动标记"，约30像素直径，居中水平运动。初始振幅80，原生range输入aria-label="振幅" min40 max160 step20；独立显示元素aria-label="当前振幅"只显示数值。说明“振幅决定偏离中心的最大距离。”初始自动播放。按钮“暂停”停止运动并改名“继续”，再次点击继续。按钮“重置”恢复振幅80、标记到中心并保持暂停。
严格实现resize、suspend、resume、prepareCapture、destroy；一次只保留一个动画帧请求，暂停与suspend取消循环，resume尊重用户暂停状态，capture保持当前确定帧，destroy清理动画帧、监听器、登记和DOM。可以实现updateAssets空操作。只返回一个严格候选。`
}

export async function exerciseOscillationRuntime(player: Page, screenshot: string): Promise<void> {
  await expect(player.getByText('振幅实验', { exact: true })).toBeVisible()
  const marker = player.getByLabel('运动标记', { exact: true })
  const x = async () => { const box = await marker.boundingBox(); if (!box) throw new Error('动画标记未绘制'); return box.x }
  const initial = await x()
  await expect.poll(async () => Math.abs(await x() - initial)).toBeGreaterThan(5)
  await player.getByRole('button', { name: '暂停', exact: true }).click()
  const paused = await x(); await player.waitForTimeout(180)
  expect(await x()).toBeCloseTo(paused, 1)
  const slider = player.getByRole('slider', { name: '振幅', exact: true })
  await slider.focus(); await slider.press('ArrowRight')
  await expect(slider).toHaveValue('100')
  await expect(player.getByLabel('当前振幅', { exact: true })).toHaveText('100')
  await player.setViewportSize({ width: 1200, height: 800 })
  const resized = await x(); await player.waitForTimeout(180)
  expect(await x()).toBeCloseTo(resized, 1)
  await player.screenshot({ path: screenshot })
  await player.getByRole('button', { name: '继续', exact: true }).click()
  await expect.poll(async () => Math.abs(await x() - resized)).toBeGreaterThan(5)
  await player.getByRole('button', { name: '重置', exact: true }).click()
  await expect(player.getByLabel('当前振幅', { exact: true })).toHaveText('80')
  await expect(player.getByRole('button', { name: '继续', exact: true })).toBeVisible()
  await expect(player.locator('[data-runtime-fallback="true"]')).toHaveCount(0)
}
