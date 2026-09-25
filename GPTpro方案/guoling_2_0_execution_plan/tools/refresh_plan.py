"""Regenerate plan views only; never run a model or a product test.

Requires Python 3 and Markdown (python -m pip install Markdown).
The registry, acceptance JSON and narrative Markdown are the maintained inputs.
"""
from pathlib import Path
from collections import Counter
import hashlib
import json
import re
import sys
import markdown

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
CONVERGENCE = REPO / '果铃2.0收敛方案.md'
READER_ROOT_PATH = '../../果铃2.0收敛方案.md'
TASK_STATUSES = ('planned', 'in_progress', 'implemented', 'verified', 'blocked')
CASE_STATUSES = ('not_run', 'passed', 'failed', 'blocked', 'skipped')
CURRENT_SCOPE = '2.0'
DEFERRED_SCOPE = 'release-preparation'

def read(path):
    return path.read_text(encoding='utf-8-sig')

def write(path, text):
    path.write_text(text.rstrip() + '\n', encoding='utf-8')

def read_json(name):
    return json.loads(read(ROOT / name))

def dump(path, value):
    write(path, json.dumps(value, ensure_ascii=False, indent=2))

def status_counts(items, allowed):
    counts = Counter(item.get('status') for item in items)
    return {status: counts.get(status, 0) for status in allowed}

def format_status_counts(counts):
    return '、'.join(f'`{status}` {count}' for status, count in counts.items() if count)

def status_summary(tasks, cases):
    task_counts = status_counts(tasks, TASK_STATUSES)
    current = [case for case in cases if case['required_for'] == CURRENT_SCOPE]
    deferred = [case for case in cases if case['required_for'] == DEFERRED_SCOPE]
    case_counts = status_counts(current, CASE_STATUSES)
    deferred_counts = status_counts(deferred, CASE_STATUSES)
    owner_pending = [case['id'] for case in current if case.get('owner_required') is True and case.get('status') != 'passed']
    owner_summary = ('；Owner 待验收：' + ('、'.join(owner_pending) if owner_pending else '无'))
    return (f'当前开发范围有 **{len(tasks)} 个实施任务、{len(current)} 个验收用例**；'
            f'任务状态：{format_status_counts(task_counts)}；当前验收状态：{format_status_counts(case_counts)}{owner_summary}。'
            f'后续发行准备另有 **{len(deferred)} 个用例**（{format_status_counts(deferred_counts)}），未列入当前开发完成门。'
            '统计来自同源 JSON；`verified` / `passed` 是工程状态，不等于 Owner `accepted`，延期用例也不算通过。')

def reader_status_footer(tasks, cases):
    task_counts = format_status_counts(status_counts(tasks, TASK_STATUSES)).replace('`', '')
    current = [case for case in cases if case['required_for'] == CURRENT_SCOPE]
    deferred = [case for case in cases if case['required_for'] == DEFERRED_SCOPE]
    case_counts = format_status_counts(status_counts(current, CASE_STATUSES)).replace('`', '')
    return f"{len(tasks)}个2.0实施任务（{task_counts}） · 当前{len(current)}项验收（{case_counts}） · 后续发行{len(deferred)}项"

def replace_block(text, label, content):
    pattern = rf'<!-- BEGIN GENERATED {label} -->.*?<!-- END GENERATED {label} -->'
    new = f'<!-- BEGIN GENERATED {label} -->\n{content}\n<!-- END GENERATED {label} -->'
    if len(re.findall(pattern, text, flags=re.S)) != 1:
        raise ValueError(f'Expected one generated block: {label}')
    return re.sub(pattern, lambda _: new, text, flags=re.S)

def render_cases(cases):
    blocks = []
    for c in cases:
        block = (f"### {c['id']}｜{c['title']}\n\n"
                 f"**环境／前置：** {c['preconditions']}\n\n"
                 f"**操作：** {c['steps']}\n\n"
                 f"**验收：** {c['expected']}\n\n"
                 f"**验证层：** {c['test_layer']}；范围：`{c['required_for']}`；当前状态：`{c['status']}`。")
        if c.get('deferred_reason'):
            block += f"\n\n**延期说明：** {c['deferred_reason']}"
        if c.get('evidence_files'):
            block += '\n\n**证据：** ' + '、'.join(f"`{path}`" for path in c['evidence_files'])
        if c.get('owner_required') is True:
            owner_state = '已通过' if c.get('status') == 'passed' else '待 Owner 验收'
            block += f'\n\n**Owner 验收：** `{owner_state}`；不由工程 `verified` 代替最终签收。'
        blocks.append(block)
    return '\n\n'.join(blocks)

def batch_table(registry):
    rows = ['| 批次 | 主题 | 完成任务 | 完成点 |', '|---|---|---|---|']
    for b in registry['integration_batches']:
        rows.append(f"| {b['id']} | {b['title']} | {'、'.join(b['tasks'])} | {b['exit']} |")
    return '\n'.join(rows)

def rendered_article(path, source):
    if path == READER_ROOT_PATH:
        group = 'overview'
    else:
        group = {'short_term':'short','mid_term':'mid','long_term':'long'}.get(path.split('/')[0], path.split('/')[0])
        if '/' not in path: group = 'overview'
        if group not in {'short','mid','long','delivery','evidence','contracts','overview'}: group = 'delivery'
    title = next((line[2:] for line in source.splitlines() if line.startswith('# ')), path)
    return dict(path=path, title=title, group=group,
                html=markdown.markdown(source, extensions=['tables','fenced_code','toc']), search=source)

def refresh():
    registry = read_json('task_registry.json')
    revision = registry.get('plan_revision', '2.0')
    cases = read_json('acceptance_cases.json')['cases']
    requirements = read_json('requirements_traceability.json')['requirements']
    sources = read_json('evidence/sources.json')
    tasks = registry['tasks']
    n, c = len(tasks), len(cases)
    for task in tasks:
        path = ROOT / task['document']
        content = read(path)
        content = re.sub(r'^# .*$', f"# {task['id']}｜{task['title']}", content, count=1, flags=re.M)
        content = re.sub(r'^\*\*实施依赖：\*\*.*$', '**实施依赖：** ' + ('、'.join(task['dependencies']) or '无'), content, flags=re.M)
        selected = [x for x in cases if x['task_id'] == task['id']]
        section = '## 验收用例\n\n<!-- 由 acceptance_cases.json 生成；修改定义后运行 tools/refresh_plan.py -->\n\n' + render_cases(selected) + '\n'
        pattern = r'## 验收用例\n.*?(?=\n## [^#]|\Z)'
        if not re.search(pattern, content, flags=re.S):
            raise ValueError('Missing acceptance section: '+task['id'])
        content = re.sub(pattern, lambda _: section, content, count=1, flags=re.S)
        if '## 代码与技术依据' not in content and '## 依据' not in content:
            content += '\n## 代码与技术依据\n\n' + '\n'.join(
                f"- [{key} · {sources[key]['title']}]({sources[key]['url']})：{sources[key]['locator']}"
                for key in task['sources']) + '\n'
        write(path, content)

    index = ['# 问题与任务索引', '',
             f'当前修订 v{revision}：{n} 个 S/M 实施任务属于当前开发；验收按 `required_for` 区分当前开发和后续发行准备，延期用例不进入当前完成门。', '',
             '先读[根目录收敛稿](../../果铃2.0收敛方案.md)。任务依赖/批次以 task_registry.json 为准，验收以 acceptance_cases.json 为准。', '']
    for phase,title in [('S','短期：基础设施'),('M','中期：完整产品体验')]:
        index += [f'## {title}', '', '| 编号 | 任务 | 实施依赖 |', '|---|---|---|']
        index += [f"| [{t['id']}]({t['document']}) | {t['title']} | {'、'.join(t['dependencies']) or '无'} |" for t in tasks if t['phase']==phase]
        index += ['']
    index += ['## 长期：2.x–3.0', '']
    for p in sorted((ROOT/'long_term').glob('*.md')):
        index.append(f'- [{read(p).splitlines()[0][2:]}](long_term/{p.name})')
    write(ROOT/'03_TASK_INDEX.md', '\n'.join(index))

    table = batch_table(registry)
    write(ROOT/'delivery/SEQUENCE.md', f'''# 实施顺序与完成门

本表由 task_registry.json 生成。每个任务只有一个完成归属；同批任务按依赖顺序集成。稳定窄接口后的独立叶子可提前并行，但不能将部分实现/演示标为任务完成。

当前依赖只约束 `required_for: 2.0` 的开发验收。安装包、便携版、干净 Windows 首次使用、重装卸载和分发资产许可延期到后续发行准备；不创建当前任务或 DAG 前置，相关用例保持 `not_run`。

{table}

## 开发与集成

S02/S03 同时建立 Markdown 和薄 V9 Driver 的行为验证，纯内核与主进程/投影在任务内部推进。两份课件和未保存 Markdown 并存、非当前页修改、撤销/恢复/保存重开贯穿内核开发。

S04 做直接工具演示，S05/S06/S07 在真实窗口完成 API 正文流和停止。S08/S09 的稳定接口可与独立支线并行；S12 只依赖工具/基础事件/文件服务，不等待整个 UI。S13/S14 加入构建与图像，S11 再验证它们经 MCP 工具目录和 UI 的共同边界。

同批有依赖不等于可以无序开发。共享类型、DocumentRegistry、ToolGateway 与提交入口由唯一集成人管理写域；不建立多套暂时可写内核。M01 布局先建立共享壳，M07/M02 随后接入；后续按依赖推进。

## G-INFRA

全部 S 任务完成。API 主链的真实编辑流、附件、低成本组合、图像生成/编辑、构建修复/导入、取消/恢复与外部 MCP 互通有证据。单 writer、单 History、无普通候选必经链、无三家 CLI 深度嵌入依赖。OAuth 与各模型按实际支持矩阵验证，不强迫用户启用。

## G-PRODUCT

M01–M19 当前 2.0 产品任务全部完成；其中 M15–M19 是 2026-09-25 追加的 Runtime/HTML/Flow 创作能力收口。正常、空态、失败、取消、恢复及额度/冲突/外部接手状态齐备。Markdown、Flow、Slides、Spatial、Runtime、HTML 导入、附件、图片成果、Explorer、会话及 API 配置均无必须绕开的核心缺口。

## G-2.0

当前开发完成须同时满足 G-INFRA、G-PRODUCT、B13–B17 新增收口批次及 [发布门](RELEASE.md) 中 `required_for: 2.0` 的核心行为用例，形成工程候选。后续正式发行再验证 `release-preparation` 用例并由 Owner 签收。核心内容能力不因重构退化；每项声明有实际证据，not_run/blocked/skipped 不汇总为 passed。外部 MCP 兜底不代替自建主执行器完成产品任务。
''')

    count_line = status_summary(tasks, cases)
    convergence = replace_block(read(CONVERGENCE), 'BATCHES', table)
    convergence = replace_block(convergence, 'COUNTS', count_line)
    write(CONVERGENCE, convergence)
    status = replace_block(read(ROOT/'evidence/STATUS.md'), 'STATUS', count_line)
    write(ROOT/'evidence/STATUS.md', status)

    all_cases = [f'# 验收总表\n\n由 acceptance_cases.json 生成：{n} 个实施任务，{c} 个产品场景。'
                 '下列状态与证据引用来自同源 JSON；工程 `passed` 不等于 Owner `accepted`。修改定义后同步生成，不手改此表。']
    for id in [t['id'] for t in tasks] + ['RELEASE']:
        all_cases.append(f'## {id}\n\n' + render_cases([x for x in cases if x['task_id']==id]))
    write(ROOT/'delivery/ACCEPTANCE.md', '\n\n'.join(all_cases))
    release = read(ROOT/'delivery/RELEASE.md')
    release = re.sub(r'## 发布场景\n.*?(?=\n## 签收记录)', lambda _: '## 发布场景\n\n'+render_cases([x for x in cases if x['task_id']=='RELEASE'])+'\n', release, flags=re.S)
    write(ROOT/'delivery/RELEASE.md',release)

    rows = ['# 需求追踪', '', '由 requirements_traceability.json 生成；完整用例对应关系见 JSON。', '', '| 需求 | 内容 | 任务 | 验收数量 |','|---|---|---|---|']
    for req in requirements:
        rows.append(f"| {req['id']} | {req['requirement']} | {', '.join(req['tasks'])} | {len(req['tests'])} |")
    write(ROOT/'delivery/TRACEABILITY.md','\n'.join(rows))
    source_rows=['# 资料索引', '', '固定源码链接保留原始核查基线；外部资料用于技术依据，不等于产品实测。', '']
    for id, source in sources.items():
        source_rows += [f"## {id} · {source['title']}", '', f"[{source['title']}]({source['url']})", '', source['locator'], '', f"类型：{source['kind']}；核对日期：{source.get('checked_on','原始包记录')}。", '']
    write(ROOT/'evidence/SOURCES.md','\n'.join(source_rows))

    articles=[rendered_article(READER_ROOT_PATH,read(CONVERGENCE))]
    articles += [rendered_article(p.relative_to(ROOT).as_posix(),read(p)) for p in sorted(ROOT.rglob('*.md'))]
    # Embed JSON safely; no external fetch/CDN is needed to read the updated narrative.
    payload=json.dumps(articles,ensure_ascii=False).replace('<','\\u003c').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
    reader=read(ROOT/'index.html')
    pattern=r'(<script type="application/json" id="data">).*?(</script>)'
    reader=re.sub(pattern,lambda m:m.group(1)+payload+m.group(2),reader,count=1,flags=re.S)
    footer = reader_status_footer(tasks, cases)
    reader=re.sub(r"document.getElementById\('sidebarfoot'\)\.textContent=.*?;", f"document.getElementById('sidebarfoot').textContent=articles.length+'份阅读文档 · {footer}';",reader)
    # Resolve root-level convergence links and nested task links against a virtual repo URL.
    reader=re.sub(r'function normalized\(base,target\)\{.*?\}\nfunction show', '''function normalized(base,target){const origin='https://plan.invalid/GPTpro方案/guoling_2_0_execution_plan/';const resolved=new URL(target,new URL(base,origin)).href;const match=articles.find(a=>new URL(a.path,origin).href===resolved);return match?match.path:target;}
function show''',reader,flags=re.S)
    write(ROOT/'index.html',reader)

    manifest=read_json('package_manifest.json')
    task_status_counts = status_counts(tasks, TASK_STATUSES)
    acceptance_status_counts = status_counts(cases, CASE_STATUSES)
    manifest.update(plan_revision=registry.get('plan_revision', '2.0'),task_count=n,product_acceptance_count=c,
                    markdown_document_count=len(list(ROOT.rglob('*.md'))),reader_article_count=len(articles),
                    product_tests_run=False,convergence_document=READER_ROOT_PATH,
                    convergence_sha256=hashlib.sha256(CONVERGENCE.read_bytes()).hexdigest(),
                    task_status_counts=task_status_counts,
                    acceptance_status_counts=acceptance_status_counts)
    manifest['files']=[dict(path=p.relative_to(ROOT).as_posix(),bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
                       for p in sorted(ROOT.rglob('*')) if p.is_file() and p.name!='package_manifest.json' and '__pycache__' not in p.parts and p.suffix not in {'.pyc','.pyo'}]
    dump(ROOT/'package_manifest.json',manifest)
    print(json.dumps(dict(plan_views_refreshed=True,tasks=n,product_cases=c,reader_articles=len(articles),
                          task_status_counts=task_status_counts,acceptance_status_counts=acceptance_status_counts,
                          product_tests_executed=False),ensure_ascii=False))

if __name__ == '__main__':
    refresh()
