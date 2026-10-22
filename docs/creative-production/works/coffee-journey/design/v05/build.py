"""Build deterministic browser programs from the editorial data and templates.
No model or network calls. The v03 source and all previous candidates stay untouched.
"""
from pathlib import Path
import json,html
ROOT=Path(__file__).resolve().parent
D=json.loads((ROOT/'content.json').read_text(encoding='utf-8'))
esc=lambda s:html.escape(s,quote=True)
(ROOT/'content.js').write_text('window.COFFEE='+json.dumps(D,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
def shell(title,body,kind):
    return '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="'+('dark' if kind=='roast' else 'light')+'"><title>'+title+'</title><link rel="stylesheet" href="common.css"><link rel="stylesheet" href="labs.css"><script src="content.js" defer></script><script src="lab.js" defer></script></head><body class="'+('roast-page' if kind=='roast' else 'lab-page')+'">\n'+body+'\n</body></html>'
m=D['methods'][0]
buttons='\n'.join('<button class="method-button" type="button" data-method="'+x['id']+'" aria-pressed="'+str(i==0).lower()+'"><span class="number">'+x['no']+'</span><span class="name">'+x['name']+'</span><span class="english">'+x['en']+'</span><span class="mark" aria-hidden="true">↗</span></button>' for i,x in enumerate(D['methods']))
images='\n'.join('<img class="specimen-image" data-id="'+x['id']+'" data-active="'+str(i==0).lower()+'" aria-hidden="'+str(i!=0).lower()+'" src="assets/'+x['id']+'.webp" alt="'+esc(x['alt'])+'" width="1254" height="1254">' for i,x in enumerate(D['methods']))
compare='\n'.join('<figure><img src="assets/'+x['id']+'.webp" alt="'+esc(x['alt'])+'"><figcaption><h3>'+x['name']+'</h3><p>'+x['short']+'</p></figcaption></figure>' for x in D['methods'])
fallback=''.join('<h3>'+x['name']+'</h3><p>'+x['copy']+'</p>' for x in D['methods'])
body='''<main class="lab" data-process-lab data-method="natural" data-compare="false">
<button type="button" class="compare-close" data-compare-close>返回单独观察 ↙</button>
<div class="compare" aria-label="三种路线在开始干燥时的并列观察">'''+compare+'''</div>
<div class="specimen-layout">
  <figure class="specimen-view"><div class="specimen-stack">'''+images+'''<span class="specimen-index" data-number>01</span><span class="specimen-note">开始干燥时</span></div><figcaption class="view-caption" data-short>整果进入干燥</figcaption></figure>
  <div class="method-column"><p class="method-context">选择一种处理路线 / AT THE SAME MOMENT</p><div class="methods" role="group" aria-label="选择处理路线">'''+buttons+'''</div>
  <div class="method-response"><h3 data-method-title>让果实，陪着种子一起干燥。</h3><p data-method-copy>果皮、果肉和黏液仍在。种子留在果实里面，等干燥完成后，再去除外部组织。</p></div>
  <div class="method-actions"><button type="button" data-detail aria-expanded="false" aria-controls="layer-panel">看留下的层 ＋</button><button type="button" data-compare-button>三条路线并排看 ↗</button></div></div>
</div>
<div class="detail-panel" id="layer-panel" data-detail-panel data-open="false"><figure><img data-layer-image src="assets/natural-layers.svg" alt="日晒的组织去留示意"><figcaption>组织关系示意，颜色与厚度不作测量；银皮省略，虚线表示已去除的外层位置。</figcaption></figure><div><ul class="layer-list" data-layers></ul><ol class="route-steps" data-steps></ol><p class="route-note" data-note></p></div></div>
<div hidden aria-hidden="true"><img data-layer-resource="natural" src="assets/natural-layers.svg" alt=""><img data-layer-resource="washed" src="assets/washed-layers.svg" alt=""><img data-layer-resource="honey" src="assets/honey-layers.svg" alt=""></div><p class="sr-only" data-process-live aria-live="polite"></p>
<div class="lab-foot"><span class="principle">三条替代路线，比较时点相同；它们不构成先后顺序。</span><span>物件：AI 生成视觉示意 · 具体外观与工艺会有差异</span></div>
<noscript><div class="nojs">'''+fallback+'''</div></noscript></main>'''
(ROOT/'u03.html').write_text(shell('留下什么 · 三种处理路线',body,'process'),encoding='utf-8')
imgs=''.join('<img class="roast-image" data-phase="'+x['id']+'" src="assets/'+x['id']+'.webp" alt="'+x['name']+'阶段的生成物件示意" width="1254" height="1254">' for x in D['roast'])
presets=''.join('<button type="button" data-roast-value="'+str(x['value'])+'" aria-pressed="'+str(i==0).lower()+'"><small>'+x['no']+'</small>'+x['name']+'</button>' for i,x in enumerate(D['roast']))
body='''<main class="roast-lab" data-roast-lab data-phase="green">
<div class="roast-topline"><div class="chapter-label"><span class="chapter-num">05</span><span class="eyebrow">烘焙 / A CHANGE BY HEAT</span></div><span class="image-disclosure">生成物件 · 视觉示意</span></div>
<div class="roast-grid"><div class="roast-copy"><h2>热，改写<br><span>一粒豆。</span></h2><p class="roast-dek">它停留在生豆里的日子结束了。<br>这一次，颜色、表面与气味一起改变。</p><div class="roast-state"><span class="state-no" data-roast-number>01 / 生豆</span><h3 data-roast-title>变化开始以前。</h3><p data-roast-copy>灰绿色的表面，紧实的种子。熟悉的烘焙香气，还没有在这里出现。</p></div></div>
<div class="roast-view" data-roast-view data-zoom="false" tabindex="0" role="group" aria-label="咖啡豆表面观察"><div class="roast-pictures">'''+imgs+'''</div><button type="button" class="zoom-button" data-zoom aria-pressed="false">近看纹理 ＋</button></div></div>
<div class="roast-controls"><div class="roast-controls-top"><div class="roast-presets" role="group" aria-label="跳到一个烘焙观察点">'''+presets+'''</div><button class="play-button" data-play type="button" aria-pressed="false">自动走一遍 →</button></div><label for="roast-range" class="sr-only">拖动观察从生豆到熟豆的变化</label><div class="range-row"><span>生豆</span><input class="roast-range" id="roast-range" type="range" min="0" max="100" value="0" step="1" aria-valuetext="0%，生豆"><span>熟豆</span></div><p class="range-caption">慢慢拖动，或选择一处停留。画面为艺术关键帧过渡，不对应实际温度与时间。</p></div>
<noscript><div class="nojs">''' + ''.join('<h3>'+x['name']+'</h3><p>'+x['copy']+'</p>' for x in D['roast']) + '''</div></noscript></main>'''
(ROOT/'u05.html').write_text(shell('热，改写一粒豆 · 烘焙观察',body,'roast'),encoding='utf-8')
print('Built content.js, u03.html, u05.html')
