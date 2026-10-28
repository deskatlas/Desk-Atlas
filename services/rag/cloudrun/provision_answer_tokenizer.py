"""SDD-C21: immutable upstream tokenizer, verified before image creation."""
import hashlib
from pathlib import Path
import sys
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from rag.hosted_tokenizer import PATH, REVISION, SHA256

with urllib.request.urlopen('https://huggingface.co/Qwen/Qwen3-32B/resolve/' + REVISION + '/tokenizer.json', timeout=60) as response:
    artifact = response.read()
if hashlib.sha256(artifact).hexdigest() != SHA256:
    raise SystemExit('ANSWER_TOKENIZER_MISMATCH')
PATH.parent.mkdir(parents=True, exist_ok=True)
PATH.write_bytes(artifact)
print('ANSWER_TOKENIZER_VERIFIED')
