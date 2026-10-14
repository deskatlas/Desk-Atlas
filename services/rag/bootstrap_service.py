"""SPEC6-TC01: use Python 3.11+ for the SPEC-4 asyncio.timeout runtime."""
from pathlib import Path
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent


if __name__ == "__main__":
    if sys.version_info < (3, 11):
        raise SystemExit("Run bootstrap_service.py with Python 3.11 or newer")
    environment = ROOT / ".venv-service"
    if not environment.exists():
        venv.create(environment, with_pip=True)
    python = environment / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    subprocess.run([str(python), "-m", "pip", "install", "pip==25.2"], check=True)
    subprocess.run([str(python), "-m", "pip", "install", "torch==2.8.0",
                    "--index-url", "https://download.pytorch.org/whl/cpu", "--no-deps"], check=True)
    subprocess.run([str(python), "-m", "pip", "install", "-r",
                    str(ROOT / "runtime-requirements.lock.txt")], check=True)
    subprocess.run([str(python), "-m", "pip", "check"], check=True)
