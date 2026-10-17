"""Portable pnpm entry point into the approved isolated Python environment."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
COMMANDS = {"test-ms60": ["-m", "pytest", str(ROOT / "tests" / "test_ms60.py"), "-q"],"test-ms59-postgres": [str(ROOT.parents[1] / "tests" / "ms59-postgres-evidence.py")],"test-ms59": ["-m", "pytest", str(ROOT / "tests" / "test_ms59.py"), "-q"],"test-ms58": ["-m", "pytest", str(ROOT / "tests" / "test_ms58.py"), "-q"],
            "ms58-acceptance": [str(ROOT / "ms58_acceptance.py")],
            "test-ms57": ["-m", "pytest", str(ROOT / "tests" / "test_ms57.py"), "-q"],
            "ms57-compare": [str(ROOT / "ms57_compare.py")],
            "test-ms56": ["-m", "pytest", str(ROOT / "tests" / "test_ms56.py"), "-q"],
            "test-ms55": ["-m", "pytest", str(ROOT / "tests" / "test_ms55.py"), "-q"],
            "ms55-compare": [str(ROOT / "ms55_compare.py")],
            "test-ms54": ["-m", "pytest", str(ROOT / "tests" / "test_ms54.py"), "-q"],
            "ms54-baseline": [str(ROOT / "ms54_baseline.py")],
            "test-ms50": ["-m", "pytest", str(ROOT / "tests" / "test_ms50.py"), "-q"],
            "test-ms53": ["-m", "pytest", str(ROOT / "tests" / "test_ms53_retrieval.py"), str(ROOT / "tests" / "test_ms53_ingestion.py"), str(ROOT / "tests" / "test_ms53_metrics.py"), "-q"],
            "test-ms53-postgres": [str(ROOT.parents[1] / "tests" / "ms53-postgres-review.py")],
            "ms53-acceptance": [str(ROOT / "ms53_acceptance.py")],
            "test-ms52": ["-m", "pytest", str(ROOT / "tests" / "test_ms52.py"), "-q"],
            "test-ms52-postgres": [str(ROOT.parents[1] / "tests" / "ms52-postgres-cleanup.py")], "test-ms48-postgres": [str(ROOT.parents[1] / "tests" / "ms48-postgres-context.py")],
            "test-ms48": ["-m", "pytest", str(ROOT / "tests" / "test_ms48.py"), "-q"], "test-ms46": ["-m", "pytest", str(ROOT / "tests" / "test_ms46.py"), str(ROOT / "tests" / "test_operations.py"), str(ROOT / "tests" / "test_knowledge_ingestion.py"), "-q"],
            "test": ["-m", "pytest", str(ROOT / "tests" / "test_operations.py")],
            "test-ms44": ["-m", "pytest", str(ROOT / "tests" / "test_ms44.py"), str(ROOT / "tests" / "test_assistant.py"), "-q"],
            "gateway-benchmark": [str(ROOT / "gateway_benchmark.py")],
            "benchmark": [str(ROOT / "benchmark.py")], "readiness": [str(ROOT / "readiness.py")],
            "evaluate": [str(ROOT / "evaluate.py")], "load": [str(ROOT / "load_test.py")]}

COMMANDS['test-ms64'] = ['-m', 'pytest', str(ROOT / 'tests/test_ms64.py'), '-q']
COMMANDS['test-ms64-postgres'] = [str(ROOT.parents[1] / 'tests/ms64-postgres-publication.py')]
COMMANDS['test-ms61'] = ['-m', 'pytest', str(ROOT / 'tests/test_ms61.py'), '-q']
COMMANDS['test-ms63'] = ['-m', 'pytest', str(ROOT / 'tests/test_ms63.py'), '-q']
COMMANDS['ms63-acceptance'] = [str(ROOT / 'ms63_acceptance.py')]
COMMANDS['test-ms62'] = ['-m', 'pytest', str(ROOT / 'tests/test_ms62.py'), str(ROOT / 'tests/test_conversation_remediation.py'), str(ROOT / 'tests/test_ms57.py'), str(ROOT / 'tests/test_ms61.py'), '-q']
COMMANDS['ms61-localization'] = [str(ROOT / 'ms61_localization.py')]
COMMANDS['test-ms65-postgres'] = [str(ROOT.parents[1] / 'tests/ms65-postgres-document-support.py')]
COMMANDS['ms65-acceptance'] = [str(ROOT / 'ms65_acceptance.py')]
COMMANDS['test-ms65'] = ['-m', 'pytest', str(ROOT / 'tests/test_ms65.py'), '-q']

if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
    raise SystemExit("Use test, test-ms44, benchmark, gateway-benchmark, readiness, evaluate, or load")
environment = '.venv-service' if sys.argv[1] in ('test-ms60', 'test-ms59', 'test-ms44', 'test-ms50', 'ms53-acceptance', 'test-ms53', 'test-ms54', 'ms54-baseline', 'test-ms56', 'test-ms55', 'ms55-compare', 'test-ms57', 'ms57-compare', 'test-ms58', 'ms58-acceptance') else '.venv'
if sys.argv[1] in ('test-ms61', 'test-ms62', 'ms61-localization', 'test-ms63', 'ms63-acceptance', 'test-ms65', 'test-ms65-postgres', 'ms65-acceptance'):
    environment = '.venv-service'
python = ROOT / environment / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
if not python.is_file():
    raise SystemExit("Provision the approved isolated environment first; see services/rag/README.md")
if sys.argv[1] == 'test-ms53':
    # HTTP tests need Python 3.11+; real parsers use the approved evaluation
    # environment. Keep those existing environments separate without installs.
    status = subprocess.run([str(python), '-m', 'pytest',
        str(ROOT / 'tests/test_ms53_retrieval.py'), str(ROOT / 'tests/test_ms53_metrics.py'),
        str(ROOT / 'tests/test_runtime_identity.py'),
        str(ROOT / 'tests/test_ms53_governance.py'),
        '-q', *sys.argv[2:]]).returncode
    if status:
        raise SystemExit(status)
    parser_python = ROOT / '.venv' / ('Scripts/python.exe' if sys.platform == 'win32' else 'bin/python')
    if not parser_python.is_file():
        raise SystemExit('Provision the approved parser evaluation environment first')
    raise SystemExit(subprocess.run([str(parser_python), '-m', 'pytest',
        str(ROOT / 'tests/test_ms53_ingestion.py'), '-q', *sys.argv[2:]]).returncode)
raise SystemExit(subprocess.run([str(python), *COMMANDS[sys.argv[1]], *sys.argv[2:]]).returncode)
