"""PRD-F26 / SDD-C20/C22 / QAD-TC44: audit-only intent-gate reproduction.

Compile only the actual pure routing functions, avoiding app startup and secrets.
Exit 1 records the broad current-status admission gap; it is not full RAG QA.
"""
import ast
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
source = ast.parse((root / 'services/rag/app.py').read_text(encoding='utf-8'))
names = {'measured_data_request', 'data_continuation', 'workflow_question'}
module = ast.Module(body=[node for node in source.body
                         if isinstance(node, ast.FunctionDef) and node.name in names],
                    type_ignores=[])
namespace = {'re': re}
exec(compile(module, 'services/rag/app.py', 'exec'), namespace)
cases = [
    ('broad-current-status', 'How are things looking today? Anything I need to deal with?', True),
    ('explicit-count-control', 'How many reservations and check-ins do we have today?', True),
]
passed = True
for name, question, expected in cases:
    actual = namespace['measured_data_request'](question)
    print(f'{name}: measured_data_request={actual}, expected={expected}, passed={actual == expected}')
    passed = passed and actual == expected
raise SystemExit(0 if passed else 1)
