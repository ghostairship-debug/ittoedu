// @vitest-environment node
import path from 'node:path'
import fs from 'node:fs/promises'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { chromium, type Browser } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'

let server: ViteDevServer, browser: Browser, url: string
beforeAll(async () => {
  server = await createServer({ configFile: false, appType: 'custom', root: process.cwd(), cacheDir: path.resolve('output/.vite-audit-all-player'),
    optimizeDeps: { noDiscovery: true, include: ['mermaid', 'phaser', 'prosemirror-model', 'prosemirror-state', 'prosemirror-view', 'prosemirror-tables', 'prosemirror-keymap', 'prosemirror-commands', 'prosemirror-schema-list', 'nanoid', 'marked'] },
    server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, fs: { allow: [process.cwd(), 'D:/果铃工作台/node_modules'] } }, logLevel: 'error' })
  server.middlewares.use('/__audit-all-player', (_request, response) => {
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(String.raw`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id="player" style="width:960px;height:640px"></div><script type="module">
      import { mountPublishedCourseV3 } from '/src/player/componentPlatform/publishedPlayer.ts';
      import { createBlankCourseProjectV10 } from '/src/core/course/createCourseProjectV10.ts';
      import { createInputData } from '/src/components/input/data.ts';
      const frame=(width,height,x=0,y=0)=>({width,height,transform:[1,0,0,1,x,y]});
      const text=value=>({inlines:[{type:'text',text:value}]});
      window.mountFixture=async mode=>{
        await window.auditPlayer?.dispose(); const root=document.querySelector('#player'); root.replaceChildren();
        const project=createBlankCourseProjectV10('Audit fixture'); const surface=project.surfaces[0]; surface.id='A';surface.designSize={width:960,height:640};
        project.surfaces.push({id:'B',kind:'slide',title:'B',childIds:[],designSize:{width:960,height:640}});
        const add=(id,key,data,placement,children)=>{project.definitions[key]={id:key,role:['guoling.feedback','guoling.interactions'].includes(key)?'behavior':'content',implementation:{kind:'builtin',key}};project.instances[id]={id,definitionId:key,data,...(placement?{frame:placement}:{}),...(children?{childIds:children}:{})};return id};
        if(mode!=='navigation'){project.global={underlay:[],overlay:[]};project.instances={};project.definitions={};}
        if(mode==='diagram'){
          surface.kind='flow'; surface.childIds=[add('diagram','guoling.document-block',{type:'code',language:'mermaid',code:'%% retained source\nsequenceDiagram\n Alice->>Bob: 你好'})];
        } else if(mode==='flow'){
          surface.kind='flow'; surface.childIds=Array.from({length:45},(_,i)=>add('paragraph-'+i,'guoling.document-block',{type:'heading',level:3,content:text('第 '+i+' 段：Flow 正文重播观察。')}));
        } else if(mode==='interaction'||mode==='phaser-transition'){
          surface.childIds=[add('group','guoling.group',{},frame(650,430,40,30),['popover','answer','feedback'])];
          add('popover','guoling.popover',{label:'查看提示',content:'场景内提示',closeLabel:'关闭'},frame(200,50,10,10));
          add('answer','guoling.input',createInputData({label:'填写答案',acceptedAnswers:['yes'],stateKey:'result'}),frame(500,70,10,90));
          add('feedback','guoling.feedback',{stateKey:'result',target:{kind:'instance',instanceId:'answer'},pending:'Awaiting',correct:'Correct',incorrect:'Incorrect',neutral:'Submitted'});
          surface.presentation={initialStateId:'shown',states:[{id:'shown',title:'shown',overrides:{group:{visible:true}}},{id:'hidden',title:'hidden',overrides:{group:{visible:false}}}]};
          const id=add('transition','guoling.interactions',{rules:[{id:'fade',name:'fade',enabled:true,trigger:{type:'presenter.command',command:'next'},conditions:[],actions:[{id:'fade-step',start:'after-previous',delayMs:0,action:{type:'presentation.set',stateId:'shown',transition:{duration:300,ease:mode==='phaser-transition'?'Bounce.easeOut':'ease-in-out'}}}]}]}); project.global.underlay.push(id);
        } else {
          const controller=project.instances[project.global.overlay[0]];controller.data={...controller.data,defaultCollapsed:false};
          project.logic={courseState:[{key:'unlocked',valueType:'boolean',defaultValue:false}],navigationGuards:[{id:'guard',effect:'block',toSurfaceIds:['B'],match:'all',conditions:[{type:'compare',key:'unlocked',operator:'eq',value:false}],message:'locked'}]};
        }
        const {revision,...payload}=project; payload.schemaVersion=3; payload.definitions=Object.fromEntries(Object.entries(payload.definitions).map(([id,{dataSchema,...definition}])=>[id,definition]));
        window.messages=[]; window.auditPlayer=await mountPublishedCourseV3(payload,root,{keyboardNavigation:false,report:message=>window.messages.push(message)});window.payload=payload;
      };window.fixtureReady=true;
    </script></body></html>`)
  })
  await server.listen(); const address = server.httpServer!.address(); if (!address || typeof address === 'string') throw Error('Missing fixture port')
  url = `http://127.0.0.1:${address.port}/__audit-all-player`
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })
}, 30_000)
afterAll(async () => { await browser?.close(); await server?.close() })

async function page(mode: string) {
  const page = await browser.newPage(); await page.goto(url); await page.waitForFunction(() => Reflect.get(window, 'fixtureReady'))
  await page.evaluate(mode => Reflect.get(window, 'mountFixture')(mode), mode); return page
}

it('CA297 formal Published Flow renders the real Mermaid SVG and retains the editable source; errors remain visible', async () => {
  const current = await page('diagram')
  try {
    expect(await current.locator('[data-component-object="diagram"] .mermaid-preview svg').count()).toBe(1)
    expect(await current.locator('[data-component-object="diagram"] code').isVisible()).toBe(false)
    expect(await current.evaluate(() => Reflect.get(window, 'payload').instances.diagram.data.code)).toContain('retained source')
    expect(await current.locator('.mermaid-preview').textContent()).toContain('你好')
    await fs.mkdir(path.resolve('output/playwright/audit-all-player'), { recursive: true }); await current.screenshot({ path: path.resolve('output/playwright/audit-all-player/CA297-published-mermaid.png') })
    await current.evaluate(async () => { const player = Reflect.get(window, 'auditPlayer'), payload = Reflect.get(window, 'payload'); payload.instances.diagram.data.code = 'unknownInvalidDiagram'; await player.update({ kind: 'course-v10', project: { ...payload, schemaVersion: 10, revision: 0 }, resources: { assets: {}, components: {} } }) })
    expect(await current.locator('.mermaid-preview').getAttribute('data-state')).toBe('error'); expect(await current.locator('code').isVisible()).toBe(true)
  } finally { await current.close() }
}, 45_000)

it('CA023 a real scrolled Flow replay restores its native scroll and observation zoom', async () => {
  const current = await page('flow')
  try {
    const before = await current.evaluate(() => { const player = Reflect.get(window, 'auditPlayer'), scroll = document.querySelector<HTMLElement>('[data-flow-paper-scroll]')!; scroll.scrollTop = 500; player.navigation.setZoom(1.5); return scroll.scrollTop })
    expect(before).toBeGreaterThan(0)
    await current.evaluate(() => Reflect.get(window, 'auditPlayer').navigation.execute({ type: 'scene.replay' }))
    expect(await current.evaluate(() => ({ top: document.querySelector<HTMLElement>('[data-flow-paper-scroll]')!.scrollTop, zoom: Reflect.get(window, 'auditPlayer').navigation.read().zoom }))).toEqual({ top: 0, zoom: 1 })
  } finally { await current.close() }
})

it('CA027 hides group descendants; CA046 scene and instance hiding retire the body popover; CA078 feedback survives replay and page revisit', async () => {
  const current = await page('interaction')
  try {
    await current.getByRole('button', { name: '查看提示' }).click(); expect(await current.getByRole('dialog', { name: '查看提示' }).isVisible()).toBe(true)
    await current.evaluate(() => Reflect.get(window, 'auditPlayer').go('B')); expect(await current.getByRole('dialog', { name: '查看提示' }).isVisible()).toBe(false)
    await current.evaluate(() => Reflect.get(window, 'auditPlayer').go('A')); expect(await current.getByRole('dialog', { name: '查看提示' }).isVisible()).toBe(false)
    await current.getByRole('button', { name: '查看提示' }).click()
    await current.evaluate(() => Reflect.get(window, 'auditPlayer').go('A', 'hidden')); expect(await current.locator('[data-input-node-id="answer"]').isVisible()).toBe(false); expect(await current.getByRole('dialog', { name: '查看提示' }).isVisible()).toBe(false)
    await current.evaluate(() => Reflect.get(window, 'auditPlayer').go('A', 'shown')); await current.getByRole('textbox', { name: '填写答案' }).fill('yes'); await current.getByRole('button', { name: '提交', exact: true }).click()
    expect(await current.locator('[data-component-object="answer"] output').textContent()).toBe('Correct')
    await current.evaluate(() => Reflect.get(window, 'auditPlayer').navigation.execute({ type: 'scene.replay' })); await current.getByRole('textbox', { name: '填写答案' }).fill('no'); await current.getByRole('button', { name: '提交', exact: true }).click()
    expect(await current.locator('[data-component-object="answer"] output').textContent()).toBe('Incorrect')
    await current.evaluate(async () => { const player = Reflect.get(window, 'auditPlayer'); Reflect.set(window, 'retainedAnswer', player.runtime.targetElement('answer')); await player.go('B'); await player.go('A') })
    await current.getByRole('textbox', { name: '填写答案' }).fill('yes'); await current.getByRole('button', { name: '提交', exact: true }).click()
    expect(await current.locator('[data-component-object="answer"] output').textContent()).toBe('Correct'); expect(await current.evaluate(() => Reflect.get(window, 'retainedAnswer') === Reflect.get(window, 'auditPlayer').runtime.targetElement('answer'))).toBe(true)
  } finally { await current.close() }
})

it('CA226 course-state and audio changes refresh the actual teacher capability and mute controls', async () => {
  const current = await page('navigation')
  try {
    expect(await current.locator('button.primary').isDisabled()).toBe(true)
    await current.evaluate(() => Reflect.get(window, 'auditPlayer').runtime.setState('unlocked', true)); expect(await current.locator('button.primary').isDisabled()).toBe(false)
    await current.evaluate(() => Reflect.get(window, 'auditPlayer').runtime.audio().toggleMuted())
    expect(await current.locator('button[aria-pressed="true"]').count()).toBeGreaterThan(0)
    expect(await current.evaluate(() => Reflect.get(window, 'auditPlayer').navigation.read().muted)).toBe(true)
    await current.locator('button.primary').click(); expect(await current.evaluate(() => Reflect.get(window, 'auditPlayer').navigation.read().locationId)).toBe('B')
  } finally { await current.close() }
})

it('CA310 the formal presentation transition uses real WAAPI duration and easing, and completes after the visible transition', async () => {
  const current = await page('interaction')
  try {
    await current.evaluate(async () => { const player = Reflect.get(window, 'auditPlayer'); await player.go('A', 'hidden'); Reflect.set(window, 'transitionDone', false); Reflect.set(window, 'transitionStart', performance.now()); player.runtime.dispatchPresenterCommand('next').then((value: boolean) => { Reflect.set(window, 'transitionResult', value); Reflect.set(window, 'transitionDone', true); Reflect.set(window, 'transitionElapsed', performance.now() - Reflect.get(window, 'transitionStart')) }) })
    await current.waitForFunction(() => document.querySelector('[data-component-surface="A"]')!.getAnimations().length > 0)
    const animation = await current.evaluate(() => { const root = document.querySelector<HTMLElement>('[data-component-surface="A"]')!, timing = root.getAnimations()[0].effect!.getTiming(); return { timing, opacity: Number(getComputedStyle(root).opacity), done: Reflect.get(window, 'transitionDone') } })
    expect(animation.timing.duration).toBe(300); expect(animation.timing.easing).toBe('ease-in-out'); expect(animation.done).toBe(false); expect(animation.opacity).toBeLessThan(1)
    await current.waitForFunction(() => Reflect.get(window, 'transitionDone')); expect(await current.evaluate(() => Reflect.get(window, 'transitionResult'))).toBe(true); expect(await current.evaluate(() => Reflect.get(window, 'transitionElapsed'))).toBeGreaterThanOrEqual(250)
  } finally { await current.close() }
})

it('CA310 a formal Phaser Bounce easing uses its equation and completes after the visible transition', async () => {
  const current = await page('phaser-transition')
  try {
    await current.evaluate(async () => {
      const player = Reflect.get(window, 'auditPlayer'), root = document.querySelector<HTMLElement>('[data-component-surface="A"]')!
      const frames: number[] = []; Reflect.set(window, 'bounceFrames', frames)
      const animate = root.animate.bind(root); root.animate = (keyframes: Keyframe[], timing: KeyframeAnimationOptions) => {
        const opacity = Number(keyframes[0].opacity); if (Number.isFinite(opacity)) frames.push(opacity)
        const animation = animate(keyframes, timing), effect = animation.effect as KeyframeEffect, set = effect.setKeyframes.bind(effect)
        effect.setKeyframes = value => { const next = Number((value as Keyframe[])[0].opacity); if (Number.isFinite(next)) frames.push(next); set(value) }
        return animation
      }
      await player.go('A', 'hidden'); const start = performance.now()
      const result = await player.runtime.dispatchPresenterCommand('next'); Reflect.set(window, 'bounceResult', { result, elapsed: performance.now() - start })
    })
    const values = await current.evaluate(() => ({ frames: Reflect.get(window, 'bounceFrames') as number[], result: Reflect.get(window, 'bounceResult'), messages: Reflect.get(window, 'messages') }))
    expect(values.result.result).toBe(true); expect(values.result.elapsed).toBeGreaterThanOrEqual(280); expect(values.messages).toEqual([])
    expect(values.frames[0]).toBe(0); expect(values.frames.at(-1)).toBe(1)
    expect(values.frames.some((value, index) => index > 0 && value < values.frames[index - 1])).toBe(true)
  } finally { await current.close() }
})
