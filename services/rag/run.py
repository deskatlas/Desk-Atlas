"""Portable pnpm entry point into the approved isolated Python environment."""
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
COMMANDS = {"test": ["-m", "pytest", str(ROOT / "tests" / "test_operations.py")],
            "test-ms44": ["-m", "pytest", str(ROOT / "tests" / "test_ms44.py"), str(ROOT / "tests" / "test_assistant.py"), "-q"],
            "gateway-benchmark": [str(ROOT / "gateway_benchmark.py")],
            "benchmark": [str(ROOT / "benchmark.py")], "readiness": [str(ROOT / "readiness.py")],
            "evaluate": [str(ROOT / "evaluate.py")], "load": [str(ROOT / "load_test.py")]}

if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
    raise SystemExit("Use test, test-ms44, benchmark, gateway-benchmark, readiness, evaluate, or load")
environment = '.venv-service' if sys.argv[1] == 'test-ms44' else '.venv'
python = ROOT / environment / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
if not python.is_file():
    raise SystemExit("Provision the approved isolated environment first; see services/rag/README.md")
raise SystemExit(subprocess.run([str(python), *COMMANDS[sys.argv[1]], *sys.argv[2:]]).returncode)
