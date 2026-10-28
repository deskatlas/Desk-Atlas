"""SDD-C21 / QAD-TC46: pinned tokenizer, no model weights or input cache."""
import hashlib
from functools import lru_cache
from pathlib import Path

from tokenizers import Tokenizer

REVISION = '9216db5781bf21249d130ec9da846c4624c16137'
SHA256 = 'aeb13307a71acd8fe81861d94ad54ab689df773318809eed3cbe794b4492dae4'
PATH = Path(__file__).resolve().parents[1] / '.cache' / 'qwen3-32b-tokenizer.json'


@lru_cache(maxsize=1)
def tokenizer():
    if hashlib.sha256(PATH.read_bytes()).hexdigest() != SHA256:
        raise RuntimeError('ANSWER_TOKENIZER_MISMATCH')
    return Tokenizer.from_file(str(PATH))


def token_count(text):
    return len(tokenizer().encode(text, add_special_tokens=False).ids)
