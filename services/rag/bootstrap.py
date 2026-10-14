"""SPEC6-TC01: isolated pinned setup; never downloads weights at service startup."""
from pathlib import Path
import argparse
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--download-models", action="store_true")
    args = parser.parse_args()
    environment = ROOT / ".venv"
    if not environment.exists():
        venv.create(environment, with_pip=True)
    python = environment / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    subprocess.run([str(python), "-m", "pip", "install", "pip==25.2"], check=True)
    subprocess.run([str(python), "-m", "pip", "install", "torch==2.8.0", "--index-url",
                    "https://download.pytorch.org/whl/cpu", "--no-deps", "--only-binary=:all:"], check=True)
    lock = ROOT / "requirements.lock.txt"
    subprocess.run([str(python), "-m", "pip", "install", "-r",
                    str(lock if lock.is_file() else ROOT / "evaluation-requirements.txt")], check=True)
    if args.download_models:
        subprocess.run([str(python), str(ROOT / "provision_models.py")], check=True)


if __name__ == "__main__":
    main()
