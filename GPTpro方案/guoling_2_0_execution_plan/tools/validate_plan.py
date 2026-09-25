"""Validate plan definitions and generated views; never certify product behavior."""
from pathlib import Path
from pathlib import PurePosixPath
import hashlib, json, re, sys
from urllib.parse import urlsplit, unquote
from refresh_plan import (ROOT, CONVERGENCE, READER_ROOT_PATH, TASK_STATUSES, CASE_STATUSES,
                          CURRENT_SCOPE, DEFERRED_SCOPE, rendered_article, render_cases, batch_table, status_counts,
                          status_summary, reader_status_footer)

errors=[]
def fail(message): errors.append(message)
def read(path): return path.read_text(encoding='utf-8-sig')
def get(name): return json.loads(read(ROOT/name))

def validate():
    for p in ROOT.rglob('*.json'):
        try: json.loads(read(p))
        except Exception as exc: fail(f'Invalid JSON {p.relative_to(ROOT)}: {exc}')
    registry=get('task_registry.json');tasks=registry['tasks'];by_id={t['id']:t for t in tasks}
    cases=get('acceptance_cases.json')['cases'];by_case={c['id']:c for c in cases}
    sources=get('evidence/sources.json');trace=get('requirements_traceability.json')['requirements']
    if len(by_id)!=len(tasks): fail('Duplicate task ID')
    if len(by_case)!=len(cases): fail('Duplicate case ID')
    if len({r['id'] for r in trace})!=len(trace): fail('Duplicate requirement ID')
    visited=set(); active=set()
    def visit(id):
        if id in active: fail('Dependency cycle: '+id); return
        if id in visited: return
        if id not in by_id: fail('Unknown task: '+id); return
        active.add(id)
        for dep in by_id[id]['dependencies']: visit(dep)
        active.remove(id); visited.add(id)
    for t in tasks:
        visit(t['id'])
        if t.get('status') not in TASK_STATUSES: fail('Invalid task status: '+t['id'])
        if t['release']!='2.0' or not t['required']: fail('Invalid planning scope: '+t['id'])
        actual=[c['id'] for c in cases if c['task_id']==t['id']]
        if not actual or set(actual)!=set(t['acceptance_ids']): fail('Case ownership mismatch: '+t['id'])
        if len(t['acceptance_ids'])!=len(set(t['acceptance_ids'])): fail('Repeated owned case: '+t['id'])
        p=ROOT/t['document']
        if not p.is_file(): fail('Missing task document: '+t['id']); continue
        s=read(p)
        if s.splitlines()[0]!=f"# {t['id']}｜{t['title']}":fail('Task title drift: '+t['id'])
        deps='**实施依赖：** '+('、'.join(t['dependencies']) or '无')
        if deps not in s.splitlines():fail('Task dependencies drift: '+t['id'])
        expected=render_cases([c for c in cases if c['task_id']==t['id']])
        if expected not in s: fail('Task acceptance drift: '+t['id'])
        for ref in t['sources']:
            if ref not in sources:fail('Unknown source: '+ref)
    covered=set();batch_ids=set()
    for batch in registry['integration_batches']:
        if batch['id'] in batch_ids:fail('Repeated batch ID: '+batch['id'])
        batch_ids.add(batch['id'])
        for id in batch['tasks']:
            if id not in by_id:fail('Unknown batch task: '+id);continue
            if id in covered:fail('Repeated completion ownership: '+id)
            for dep in by_id[id]['dependencies']:
                if dep not in covered:fail(f"{batch['id']} schedules {id} before {dep}")
            covered.add(id)
    if covered!=set(by_id):fail('Batches do not cover all tasks')
    for c in cases:
        if c['task_id'] not in by_id and c['task_id']!='RELEASE':fail('Unknown case owner: '+c['id'])
        if c.get('status') not in CASE_STATUSES:fail('Invalid case status: '+c['id'])
        if c.get('required_for') not in (CURRENT_SCOPE, DEFERRED_SCOPE):fail('Invalid case scope: '+c['id'])
        if c.get('required_for')==DEFERRED_SCOPE and (c.get('status')!='not_run' or not c.get('deferred_reason')):
            fail('Deferred case must remain not_run with reason: '+c['id'])
        if 'owner_required' in c and not isinstance(c['owner_required'],bool):fail('owner_required must be boolean: '+c['id'])
        for key in ['title','preconditions','steps','expected','test_layer']:
            if not c.get(key):fail('Empty case field: '+c['id']+' '+key)
        evidence=c.get('evidence_files',[])
        if not isinstance(evidence,list):
            fail('Invalid evidence_files: '+c['id']);evidence=[]
        if c.get('status')=='passed' and not evidence:fail('Passed case missing evidence_files: '+c['id'])
        if len(evidence)!=len(set(path for path in evidence if isinstance(path,str))):fail('Repeated evidence file: '+c['id'])
        for value in evidence:
            if not isinstance(value,str) or not value:
                fail('Invalid evidence file: '+c['id']);continue
            relative=PurePosixPath(value)
            if '\\' in value or relative.is_absolute() or '..' in relative.parts or '.' in relative.parts or not value.startswith('evidence/'):
                fail('Evidence file must be package-relative under evidence/: '+c['id']+' '+value);continue
            evidence_path=ROOT.joinpath(*relative.parts)
            if not evidence_path.is_file():fail('Missing evidence file: '+c['id']+' '+value)
    for task in tasks:
        if task.get('status')!='verified':continue
        engineering=[c for c in cases if c['task_id']==task['id'] and c['required_for']==CURRENT_SCOPE and c.get('owner_required') is not True]
        non_passed=[c['id'] for c in engineering if c.get('status')!='passed']
        if not engineering or non_passed:
            detail=','.join(non_passed) if non_passed else 'no engineering cases'
            fail('Verified task has non-passed engineering cases: '+task['id']+' ('+detail+')')
    traced=set()
    for r in trace:
        if not r['tasks'] or not r['tests']:fail('Empty requirement coverage: '+r['id'])
        for id in r['tasks']:
            if id not in by_id:fail('Unknown requirement task: '+id)
        for id in r['tests']:
            if id not in by_case:fail('Unknown requirement case: '+id)
            else:traced.add(id)
    untraced=set(by_case)-traced
    # Release cases are also explicitly enumerated in the release gate.
    untraced={id for id in untraced if by_case[id]['task_id']!='RELEASE'}
    if untraced:fail('Cases missing requirement coverage: '+','.join(sorted(untraced)))
    for item in registry['removed_acceptance']:
        if item['id'] in by_case:fail('Removed migration case remains active: '+item['id'])
    all_cases=read(ROOT/'delivery/ACCEPTANCE.md')
    for c in cases:
        if render_cases([c]) not in all_cases:fail('Acceptance view drift: '+c['id'])
    release=read(ROOT/'delivery/RELEASE.md')
    for c in cases:
        if c['task_id']=='RELEASE' and render_cases([c]) not in release:fail('Release view drift: '+c['id'])
    table=batch_table(registry)
    if table not in read(CONVERGENCE) or table not in read(ROOT/'delivery/SEQUENCE.md'):fail('Batch table drift')
    summary=status_summary(tasks,cases)
    if summary not in read(CONVERGENCE) or summary not in read(ROOT/'evidence/STATUS.md'):fail('Status summary drift')
    doc_paths=list(ROOT.rglob('*.md'))+[CONVERGENCE]
    doc_paths+=list((ROOT.parent/'guoling_final_design_package').rglob('*.md'))+[ROOT.parent/'README.md']
    for p in doc_paths:
        for target in re.findall(r'\]\(([^)]+)\)',read(p)):
            target=target.strip().split(' "',1)[0].strip('<>')
            if urlsplit(target).scheme:continue
            local=unquote(target.split('#')[0])
            if local and not (p.parent/local).resolve().exists():fail(f'Broken link {p.name} -> {target}')
    html=read(ROOT/'index.html')
    data_match=re.search(r'<script type="application/json" id="data">(.*?)</script>',html,re.S)
    if not data_match:fail('Missing reader data');articles=[]
    else:articles=json.loads(data_match.group(1))
    article_map={a['path']:a for a in articles}
    expected_sources={p.relative_to(ROOT).as_posix():read(p) for p in ROOT.rglob('*.md')}
    expected_sources[READER_ROOT_PATH]=read(CONVERGENCE)
    if set(article_map)!=set(expected_sources) or len(article_map)!=len(articles):fail('Reader document inventory drift')
    for path,source in expected_sources.items():
        if article_map.get(path)!=rendered_article(path,source):fail('Reader content/render drift: '+path)
    if reader_status_footer(tasks,cases) not in html:fail('Reader footer drift')
    if 'https://plan.invalid/GPTpro方案/guoling_2_0_execution_plan/' not in html:fail('Reader missing root link resolution')
    manifest=get('package_manifest.json')
    for key,value in [('task_count',len(tasks)),('product_acceptance_count',len(cases)),('markdown_document_count',len(expected_sources)-1),('reader_article_count',len(articles))]:
        if manifest.get(key)!=value:fail('Manifest count drift: '+key)
    if manifest.get('convergence_sha256')!=hashlib.sha256(CONVERGENCE.read_bytes()).hexdigest():fail('Manifest root artifact drift')
    if manifest.get('task_status_counts')!=status_counts(tasks,TASK_STATUSES):fail('Manifest task status drift')
    if manifest.get('acceptance_status_counts')!=status_counts(cases,CASE_STATUSES):fail('Manifest acceptance status drift')
    listed=set()
    for item in manifest['files']:
        p=ROOT/item['path'];listed.add(item['path'])
        if not p.is_file():fail('Missing manifest file: '+item['path']);continue
        if p.stat().st_size!=item['bytes'] or hashlib.sha256(p.read_bytes()).hexdigest()!=item['sha256']:fail('Manifest artifact drift: '+item['path'])
    actual={p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*') if p.is_file() and p.name!='package_manifest.json' and '__pycache__' not in p.parts and p.suffix not in {'.pyc','.pyo'}}
    if listed!=actual:fail('Manifest inventory drift')
    qa=get('PACKAGE_QA.json')
    if qa.get('product_code_modified') or qa.get('product_tests_run'):fail('QA claims product work')
    return dict(package_validation='failed' if errors else 'passed',tasks=len(tasks),product_cases=len(cases),requirements=len(trace),reader_articles=len(articles),product_tests_executed=False,errors=list(errors))

if __name__=='__main__':
    try: result=validate()
    except Exception as exc:fail(str(exc));result=dict(package_validation='failed',errors=errors,product_tests_executed=False)
    print(json.dumps(result,ensure_ascii=False,indent=2))
    sys.exit(bool(errors))
