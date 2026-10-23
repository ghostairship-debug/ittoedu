from pathlib import Path
base=Path(__file__).resolve().parent.parent
p=base/'programs/u03/build_u03.py'
s=p.read_text(encoding='utf-8-sig')
a=s.index('def diagram('); b=s.index('\nstyle=',a)
replacement=r'''def annotations(mode,prefix):
    name=next(m['name'] for m in methods if m['id']==mode)
    outer='M7 -88 C-48 -92 -86 -43 -85 20 C-85 82 -51 118 5 118 C64 120 94 79 94 25 C93 -43 52 -91 7 -88Z'
    left='M -1 -45 C -14 -61 -39 -57 -49 -32 C -66 6 -58 48 -40 69 C -27 87 -5 86 0 66 C 5 38 5 -22 -1 -45 Z'
    right='M 14 -45 C 28 -60 43 -52 52 -31 C 66 6 66 44 53 67 C 44 86 22 89 14 67 C 9 34 8 -21 14 -45 Z'
    parts=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-140 -140 280 280" role="img" aria-labelledby="{prefix}-title {prefix}-desc"><title id="{prefix}-title">{name}：开始干燥时的组织关系</title><desc id="{prefix}-desc">材料图像与矢量标识叠合，三路线使用相同尺度。虚线表示被去除的外层原位置；组织厚度与颜色仅为说明。</desc>']
    if mode!='natural':
        parts.append(f'<path d="{outer}" fill="none" stroke="#8c927c" stroke-width=".8" stroke-dasharray="2.2 3.8" opacity=".72"/>')
    if mode=='washed':
        parts.append(f'<path d="{left} {right}" fill="none" stroke="#b99451" stroke-width="1" opacity=".7"/>')
    if mode=='honey':
        parts.append(f'<path d="{left} {right}" fill="none" stroke="#cb923e" stroke-width="1.1" opacity=".7"/>')
    # Hairline leaders identify the material layers without drawing another object.
    if mode=='natural':
        parts.append('<g class="material-leaders" fill="none" stroke-width=".85"><path d="M-72 -45H-107V-69" stroke="#a33d33"/><circle cx="-72" cy="-45" r="1.8" stroke="#a33d33"/><path d="M46 -41 90 -72H112" stroke="#ad7b2e"/><circle cx="46" cy="-41" r="1.8" stroke="#ad7b2e"/></g>')
    else:
        parts.append('<g class="material-leaders" fill="none" stroke-width=".85"><path d="M-48 6H-103" stroke="#b0975d"/><circle cx="-48" cy="6" r="1.8" stroke="#b0975d"/><path d="M36 23 88 56H108" stroke="#718757"/><circle cx="36" cy="23" r="1.8" stroke="#718757"/></g>')
    parts.append('</svg>')
    return ''.join(parts)

def diagram(mode,prefix):
    name=next(m['name'] for m in methods if m['id']==mode)
    return (f'<div class="material-diagram" data-material-route="{mode}">'
            f'<img class="material-photo" src="assets/{mode}-section.webp" width="900" height="900" alt="{name}：同尺度材料剖面示意，AI生成图像，非实测标本">'
            +annotations(mode,prefix)+'</div>')

for m in methods:
    (ROOT/'assets'/(m['id']+'-layers.svg')).write_text(annotations(m['id'],'asset-'+m['id']),encoding='utf-8')
'''
s=s[:a]+replacement+s[b:]
needle="\nphoto=''.join"
style=r'''
# Photographic materials and explanatory vectors occupy exactly the same frame.
style += '''+"'''"+r'''
.material-diagram{position:relative;aspect-ratio:1;isolation:isolate;overflow:hidden}
.material-diagram .material-photo{position:absolute;inset:0;display:block;width:100%;height:100%;object-fit:contain}
.material-diagram svg{position:absolute;inset:0;width:100%;height:100%;max-height:none!important;pointer-events:none}
.diagram-shell{background:linear-gradient(145deg,rgba(252,248,236,.93),rgba(237,228,206,.86));border-color:#c7bda6;box-shadow:0 12px 35px rgba(71,54,25,.035)}
.detail-panel .material-diagram{width:min(100%,370px);margin:0 auto}
.compare .material-diagram{width:100%;margin:0 auto}
.compare .material-leaders{display:none}
.diagram-caption,.comparison-note{color:#58614f}
@media(max-width:600px){.detail-panel .material-diagram{width:min(100%,300px)}.compare .diagram-shell{padding:9px 2px 9px}.compare .material-diagram{aspect-ratio:.89}.material-diagram .material-photo{object-fit:contain}.compare .material-diagram svg{height:100%;object-fit:contain}.comparison-note{line-height:1.9}}
'''+"'''"+r'''
'''
s=s.replace(needle,'\n'+style+needle)
s=s.replace('物件：AI 生成视觉示意 · 结构图：代码绘制','图像：AI 生成材料示意 · 组织关系：同尺度矢量标识')
s=s.replace('¹ 去皮及去除大部分果肉。厚度、颜色为关系示意；银皮省略。','¹ 去皮及去除大部分果肉。图像为材料示意，非实测剖面；厚度不作测量，银皮省略。')
s=s.replace('已去除组织的位置。颜色与厚度为关系示意，银皮省略。','已去除外层的原位置。材料图像与矢量标识叠合；厚度仅为说明，银皮省略。')
s=s.replace("print('Built U03',len(html.encode()),'bytes; SVGs inline; photos remain assets/*.webp')","print('Built U03 hybrid material edition',len(html.encode()),'bytes; same interactive script, three registered material images')")
p.write_text(s,encoding='utf-8')
print('Updated self-contained U03 generator:',p)
