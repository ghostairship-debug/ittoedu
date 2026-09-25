"""Check validator behavior in disposable copies; never write repository files."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
import tempfile


SOURCE = Path(__file__).resolve().parents[1]
REPO = SOURCE.parents[1]
PACKAGE_PATH = Path('GPTpro方案/guoling_2_0_execution_plan')
DESIGN_PATH = Path('GPTpro方案/guoling_final_design_package')
ENTRY_PATH = Path('GPTpro方案/README.md')
CONVERGENCE_PATH = Path('果铃2.0收敛方案.md')


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def run(package, script):
    result = subprocess.run(
        [sys.executable, '-B', str(package / 'tools' / script)],
        cwd=package, capture_output=True, encoding='utf-8', errors='replace',
        env={**os.environ, 'PYTHONIOENCODING': 'utf-8'},
    )
    if result.stderr:
        raise AssertionError(f'{script} unexpected stderr:\n{result.stderr}')
    return result.returncode, result.stdout


def require_pass(package):
    code, output = run(package, 'validate_plan.py')
    result = json.loads(output)
    if code != 0 or result.get('package_validation') != 'passed':
        raise AssertionError('Clean-copy validation failed:\n' + output)


def refresh(package):
    code, output = run(package, 'refresh_plan.py')
    if code != 0:
        raise AssertionError('Copy refresh failed:\n' + output)


def require_rejection(package, expected):
    code, output = run(package, 'validate_plan.py')
    result = json.loads(output)
    errors = result.get('errors', [])
    matched = next((item for item in errors if expected in item), None)
    if code == 0 or result.get('package_validation') != 'failed' or matched is None:
        raise AssertionError(f'Expected rejection {expected!r}:\n{output}')
    print('PASS: ' + matched)


def main():
    with tempfile.TemporaryDirectory(prefix='guoling-plan-selfcheck-') as temporary:
        root = Path(temporary).resolve()
        # Cleanup is owned by TemporaryDirectory and confined to this unique root.
        if root.parent != Path(tempfile.gettempdir()).resolve():
            raise AssertionError('Unexpected temporary parent')
        package = root / PACKAGE_PATH
        shutil.copytree(REPO / DESIGN_PATH, root / DESIGN_PATH,
                        ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.pyo'))
        shutil.copy2(REPO / ENTRY_PATH, root / ENTRY_PATH)

        def restore():
            if package.exists():
                # The target is the package path inside the verified unique temporary root.
                if package.parent.parent != root:
                    raise AssertionError('Unexpected disposable package path')
                shutil.rmtree(package)
            shutil.copytree(SOURCE, package, dirs_exist_ok=True,
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.pyo'))
            shutil.copy2(REPO / CONVERGENCE_PATH, root / CONVERGENCE_PATH)
            refresh(package)

        restore()
        require_pass(package)
        print('PASS: clean copied package')

        # Real statuses are accepted only with evidence. A verified task covers all
        # engineering cases; only an explicit owner_required case remains separate.
        registry_path = package / 'task_registry.json'
        cases_path = package / 'acceptance_cases.json'
        evidence_path = package / 'evidence/selfcheck-status.log'
        evidence_path.write_text('disposable selfcheck evidence\n', encoding='utf-8')
        registry = read_json(registry_path)
        next(task for task in registry['tasks'] if task['id'] == 'S01')['status'] = 'verified'
        write_json(registry_path, registry)
        cases = read_json(cases_path)
        for case in cases['cases']:
            if case['id'] in {'S01-T01', 'S01-T02'}:
                case['status'] = 'passed'
                case['evidence_files'] = ['evidence/selfcheck-status.log']
            if case['id'] == 'S01-T05':
                case['owner_required'] = True
        write_json(cases_path, cases)
        refresh(package)
        require_pass(package)
        print('PASS: verified engineering status with traceable evidence; explicit Owner case stays separate')
        restore()

        # A manual layer is still an engineering case unless owner_required is explicit.
        evidence_path = package / 'evidence/selfcheck-manual.log'
        evidence_path.write_text('disposable manual engineering evidence\n', encoding='utf-8')
        registry = read_json(registry_path)
        next(task for task in registry['tasks'] if task['id'] == 'S01')['status'] = 'verified'
        write_json(registry_path, registry)
        cases = read_json(cases_path)
        for case in cases['cases']:
            if case['id'] in {'S01-T01', 'S01-T02'}:
                case['status'] = 'passed'
                case['evidence_files'] = ['evidence/selfcheck-manual.log']
        manual_case = next((case for case in cases['cases']
                            if case['task_id'] == 'S01'
                            and case.get('test_layer') == 'manual'
                            and case.get('owner_required') is not True), None)
        if manual_case is None:
            raise AssertionError('Expected S01 manual engineering case not marked owner_required')
        manual_case['status'] = 'not_run'
        manual_case['evidence_files'] = []
        write_json(cases_path, cases)
        refresh(package)
        require_rejection(package, 'Verified task has non-passed engineering cases: S01')
        restore()

        registry = read_json(registry_path)
        next(task for task in registry['tasks'] if task['id'] == 'S01')['status'] = 'done'
        write_json(registry_path, registry)
        require_rejection(package, 'Invalid task status: S01')
        restore()

        cases = read_json(cases_path)
        next(case for case in cases['cases'] if case['id'] == 'S01-T01')['status'] = 'done'
        write_json(cases_path, cases)
        require_rejection(package, 'Invalid case status: S01-T01')
        restore()

        cases = read_json(cases_path)
        next(case for case in cases['cases'] if case['id'] == 'S01-T01')['status'] = 'passed'
        next(case for case in cases['cases'] if case['id'] == 'S01-T01')['evidence_files'] = []
        write_json(cases_path, cases)
        require_rejection(package, 'Passed case missing evidence_files: S01-T01')
        restore()

        cases = read_json(cases_path)
        case = next(case for case in cases['cases'] if case['id'] == 'S01-T01')
        case['status'] = 'passed'
        case['evidence_files'] = ['evidence/does-not-exist.log']
        write_json(cases_path, cases)
        require_rejection(package, 'Missing evidence file: S01-T01 evidence/does-not-exist.log')
        restore()

        registry = read_json(registry_path)
        next(task for task in registry['tasks'] if task['id'] == 'S01')['status'] = 'verified'
        write_json(registry_path, registry)
        cases = read_json(cases_path)
        for case in cases['cases']:
            if case['task_id'] == 'S01':
                case['owner_required'] = True
        write_json(cases_path, cases)
        require_rejection(package, 'Verified task has non-passed engineering cases: S01')
        restore()

        # Move S04, rather than duplicate it, so the targeted failure is ordering.
        registry = read_json(registry_path)
        for batch in registry['integration_batches']:
            batch['tasks'] = [task for task in batch['tasks'] if task != 'S04']
        first = next(batch for batch in registry['integration_batches'] if batch['id'] == 'B01')
        first['tasks'].insert(first['tasks'].index('S03'), 'S04')
        write_json(registry_path, registry)
        refresh(package)
        require_rejection(package, 'schedules S04 before S03')
        restore()

        # Supply valid ownership and views; the retired-case rule must still reject it.
        cases = read_json(cases_path)
        revived = dict(next(case for case in cases['cases'] if case['task_id'] == 'S01'))
        revived['id'] = 'S01-T03'
        cases['cases'].append(revived)
        write_json(cases_path, cases)
        registry = read_json(registry_path)
        next(task for task in registry['tasks'] if task['id'] == 'S01')['acceptance_ids'].append('S01-T03')
        write_json(registry_path, registry)
        trace_path = package / 'requirements_traceability.json'
        trace = read_json(trace_path)
        next(req for req in trace['requirements'] if 'S01' in req['tasks'])['tests'].append('S01-T03')
        write_json(trace_path, trace)
        refresh(package)
        require_rejection(package, 'Removed migration case remains active')
        restore()

        task_path = package / 'short_term/S02.md'
        with task_path.open('a', encoding='utf-8') as task:
            task.write('\nSelfcheck intentionally changes a task narrative without refresh.\n')
        require_rejection(package, 'Reader content/render drift')
        restore()
        require_pass(package)
        print('selfcheck_plan: passed (1 positive status check, 9 rejection checks; repository files untouched)')


if __name__ == '__main__':
    main()
