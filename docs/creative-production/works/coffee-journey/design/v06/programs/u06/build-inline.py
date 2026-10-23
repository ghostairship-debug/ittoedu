from pathlib import Path
import re
p=Path(__file__).resolve().parent
template=(p/'u06.html').read_text(encoding='utf-8')
for target,config in [('u06-inline.html',p/'water.config.js'),('sugar-inline.html',p/'sugar/water.config.js')]:
    html=template
    html=html.replace('<link rel="stylesheet" href="common.css">','<style>'+ (p/'common.css').read_text(encoding='utf-8')+'</style>')
    html=html.replace('<link rel="stylesheet" href="water.css">','<style>'+ (p/'water.css').read_text(encoding='utf-8')+'</style>')
    html=html.replace('<script src="water.config.js" defer></script>','')
    html=html.replace('<script src="water.js" defer></script>','')
    html=html.replace('</body>','<script>'+config.read_text(encoding='utf-8')+'</script><script>'+(p/'water.js').read_text(encoding='utf-8')+'</script></body>')
    (p/target).write_text(html, encoding='utf-8')
    print(target,len(html.encode('utf-8')))
