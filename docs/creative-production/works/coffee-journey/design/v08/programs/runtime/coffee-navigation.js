export default {
  mount(context) {
    const root = context.root, port = context.teacherController
    if (!root || !port) return { update() {}, dispose() {} }
    const document = root.ownerDocument
    let instance = context.instance, signature = '', disposed = false, nativeSignature = '', nativeStops = []
    root.innerHTML = '<style>*{box-sizing:border-box}nav{height:48px;width:100%;position:relative;background:#eeece2;border-bottom:1px solid #c9ccbe;color:#242b24;font-family:"Microsoft YaHei",sans-serif}.inside{width:min(1440px,calc(100% - clamp(40px,11.111vw,160px)));height:47px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:20px}.note{font-size:11px;color:#697064;letter-spacing:.08em}.links{display:flex;align-items:stretch;gap:24px;height:100%}button{border:0;border-bottom:2px solid transparent;background:transparent;color:inherit;padding:0;cursor:pointer;font:12px "Microsoft YaHei",sans-serif;white-space:nowrap}button small{font:italic 12px Georgia,serif;color:#697064;margin-right:7px}button[aria-current=location]{color:#9e3329;border-color:#9e3329}button:disabled{cursor:default}button:focus-visible{outline:2px solid #9e3329;outline-offset:3px}.progress{position:absolute;left:0;bottom:-1px;height:1px;background:#9e3329;width:0;transition:width .1s linear}nav[data-dark=true]{background:#10130f;color:#e0e3d4;border-color:#3c4435}nav[data-dark=true] .note,nav[data-dark=true] small{color:#a0ab94}nav[data-dark=true] button[aria-current=location]{color:#d2a278;border-color:#d2a278}nav[data-dark=true] .progress{background:#d2a278}@media(max-width:1000px){.note{display:none}.links{width:100%;justify-content:space-between;gap:8px}}@media(max-width:520px){.inside{width:calc(100% - 28px)}button{font-size:10px;min-width:34px}button small{display:block;margin:0 0 2px;font-size:9px}.links{gap:3px}}</style><nav aria-label="作品章节"><div class="inside"><span class="note">从果实到杯中</span><div class="links"></div></div><div class="progress" role="progressbar" aria-label="阅读进度" aria-valuemin="0" aria-valuemax="100"></div></nav>'
    const nav = root.querySelector('nav'), links = root.querySelector('.links'), progress = root.querySelector('.progress')
    function render() {
      if (disposed) return
      const nativeLinks = instance.data.links || [], nativeNext = JSON.stringify(nativeLinks)
      if (nativeNext !== nativeSignature) {
        nativeSignature = nativeNext; nativeStops.forEach(stop => stop()); nativeStops = []
        for (const link of nativeLinks) if (context.interactions) nativeStops.push(context.interactions.subscribeTrigger({type:'node.click',nodeId:link.instanceId}, () => {
          const location = port.read().locationId
          if (location) { const chapter=(instance.data.chapters||[]).find(x=>x.targetId===link.targetId); context.scope.events.emit('coffee.v08.navigation',{chapter:chapter?.number,targetId:link.targetId}); return port.execute({type:'scene.go',sceneId:location,targetInstanceId:link.targetId}) }
        }))
      }
      const state = port.read(), chapters = instance.data.chapters || [], nextSignature = JSON.stringify(chapters)
      if (signature !== nextSignature) {
        signature = nextSignature; links.replaceChildren()
        for (const chapter of chapters) {
          const button = document.createElement('button'), number = document.createElement('small')
          button.type = 'button'; button.dataset.target = chapter.targetId; number.textContent = chapter.number
          button.append(number, chapter.label); button.title = chapter.title || chapter.label
          button.addEventListener('click', () => {
            const state = port.read()
            if (state.locationId) { context.scope.events.emit('coffee.v08.navigation',{chapter:chapter.number,targetId:chapter.targetId}); void port.execute({ type: 'scene.go', sceneId: state.locationId, targetInstanceId: chapter.targetId }) }
          })
          links.append(button)
        }
      }
      const directory = state.scenes.find(scene => scene.id === state.locationId)?.targets || []
      const activeIndex = directory.findIndex(target => target.id === state.reading?.activeInstanceId)
      let active = chapters[0]
      for (const chapter of chapters) {
        const index = directory.findIndex(target => target.id === chapter.targetId)
        if (index >= 0 && index <= activeIndex) active = chapter
      }
      for (const button of links.children) {
        const selected = button.dataset.target === active?.targetId
        if (selected) button.setAttribute('aria-current', 'location'); else button.removeAttribute('aria-current')
        button.disabled = !state.locationId || !port.canExecute({ type: 'scene.go', sceneId: state.locationId, targetInstanceId: button.dataset.target })
      }
      const fraction = Math.max(0, Math.min(1, state.reading?.progress || 0))
      progress.style.width = fraction * 100 + '%'; progress.setAttribute('aria-valuenow', String(Math.round(fraction * 100)))
      nav.dataset.dark = String(active?.number === '05'); nav.dataset.activeChapter = active?.number || '01'
    }
    const off = port.subscribe(render); render()
    const reportHeight = () => { const input=context.layout?.read(); if(input?.mode==='flow-content') context.layout.reportSize({inlineSize:input.inlineSize,blockSize:48}) }
    root.style.height='48px'; root.style.display='block'; reportHeight()
    const offLayout=context.layout?.subscribe(reportHeight)
    const dispose = () => { if (disposed) return; disposed = true; off(); offLayout?.(); nativeStops.forEach(stop => stop()); root.replaceChildren() }
    context.scope.cleanup(dispose)
    return { update(next) { instance = next; render() }, dispose }
  }
}