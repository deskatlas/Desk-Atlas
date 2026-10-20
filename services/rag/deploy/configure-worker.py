"""SDD-C23: local VM secret prompts, never put secrets in shell history."""
import getpass
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlparse

if os.geteuid() != 0:
    raise SystemExit('Run with sudo python3 deploy/configure-worker.py')
gateway = input('Paste the deployed ADMIN website URL (https://...): ').strip().rstrip('/')
parsed = urlparse(gateway)
if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
    raise SystemExit('Enter only the HTTPS origin of the admin website.')
token = getpass.getpass('Paste its existing KB_WORKER_TOKEN (hidden): ')
key = getpass.getpass('Paste your DeepInfra API key (hidden): ')
if len(token) < 32 or not key or any(char.isspace() for char in token + key) or not re.fullmatch(r'[A-Za-z0-9_./+=:-]+', token + key):
    raise SystemExit('Invalid credential format.')
image = subprocess.run(['docker', 'image', 'inspect', 'deskatlas-knowledge-parser:hosted', '--format={{.Id}}'],
                       capture_output=True, text=True, check=True).stdout.strip()
if not re.fullmatch(r'sha256:[a-f0-9]{64}', image):
    raise SystemExit('Build the parser image first.')
target = Path('/etc/deskatlas-worker.env')
descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.fchmod(descriptor, 0o600)
with os.fdopen(descriptor, 'w') as stream:
    stream.write('KB_ENABLED=true\nKB_WORKER_MODE=all\nRAG_EMBEDDING_PROVIDER=deepinfra\n')
    stream.write('KB_GATEWAY_URL=' + gateway + '\nKB_WORKER_TOKEN=' + token + '\nDEEPINFRA_API_KEY=' + key + '\n')
    stream.write('KB_PARSER_IMAGE=' + image + '\nPYTHONDONTWRITEBYTECODE=1\n')
print('Saved root-readable worker configuration. Worker has not been started.')
