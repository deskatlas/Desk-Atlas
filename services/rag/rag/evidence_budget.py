"""MS56-TC08: unchanged versioned limits, including serialized overhead."""
import json
from pathlib import Path

LIMITS = json.loads(Path(__file__).with_name('evidence-budget.json').read_text())
