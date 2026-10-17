"""MS46-TC21: Python AST boundary lint without installing dependencies."""
import ast
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / 'services/rag'
failures = []
paths = [SERVICE / 'app.py', *sorted((SERVICE / 'knowledge').glob('*.py')), *sorted((SERVICE / 'rag').glob('*.py'))]
paths.append(SERVICE / 'ms58_acceptance.py')
paths.append(SERVICE / 'ms61_localization.py')
paths.append(SERVICE / 'ms63_acceptance.py')
for path in paths:
    try:
        source = path.read_text(encoding='utf-8')
        tree = ast.parse(source, filename=str(path))
    except (OSError, SyntaxError):
        failures.append((path, 1, 'Python syntax'))
        continue
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name) and node.func.id in {'eval', 'exec', 'compile', 'breakpoint'}:
                failures.append((path, node.lineno, 'Executable input'))
            if isinstance(node.func, ast.Attribute) and node.func.attr in {'run', 'Popen', 'call', 'check_call', 'check_output'}:
                if any(keyword.arg == 'shell' and not (isinstance(keyword.value, ast.Constant) and keyword.value.value is False) for keyword in node.keywords):
                    failures.append((path, node.lineno, 'Subprocess shell interpolation'))
            if isinstance(node.func, ast.Attribute) and isinstance(node.func.value, ast.Name) and node.func.value.id in {'logger', 'logging'}:
                if node.func.attr in {'debug', 'info', 'warning', 'error', 'exception', 'critical'}:
                    failures.append((path, node.lineno, 'Runtime payload diagnostics require metadata adapter'))
        if isinstance(node, ast.ExceptHandler) and node.type is None:
            failures.append((path, node.lineno, 'Bare exception handler'))
    for index, line in enumerate(source.splitlines(), 1):
        if line.lstrip().startswith('#') and '\u2014' in line:
            failures.append((path, index, 'BAN-PUNCT-01'))
for path, line, rule in failures:
    print(f'{path.relative_to(ROOT)}:{line}: {rule}', file=sys.stderr)
print(f'RAG Python boundary lint: {len(paths)} files, {len(failures)} failures.')
raise SystemExit(1 if failures else 0)
