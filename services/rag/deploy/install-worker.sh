#!/bin/bash
# PRD-F27 / SDD-C23: run inside the Ubuntu 24.04 VM, after extracting the bundle.
set -euo pipefail
cd /opt/deskatlas/rag
sudo apt-get update
sudo apt-get install -y python3-venv docker.io
sudo systemctl enable --now docker
if ! id deskatlas >/dev/null 2>&1; then
    sudo useradd --system --home /opt/deskatlas --shell /usr/sbin/nologin deskatlas
fi
sudo usermod -aG docker deskatlas
sudo python3 -m venv /opt/deskatlas/rag/.venv-worker
sudo /opt/deskatlas/rag/.venv-worker/bin/pip install -r service-requirements.lock.txt
sudo docker build -f knowledge-parser.Dockerfile -t deskatlas-knowledge-parser:hosted .
sudo cp deploy/deskatlas-worker.service /etc/systemd/system/deskatlas-worker.service
sudo systemctl daemon-reload
echo 'Installed. Configure credentials before enabling the worker.'
