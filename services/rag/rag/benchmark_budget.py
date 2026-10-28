"""QAD-TC46: conservative $1 admission for explicitly authorized benchmarks."""
import json
import os
from contextlib import closing
from uuid import uuid4
from decimal import Decimal
from pathlib import Path


PRICES = {
    'google/gemini-3.1-flash-lite': (Decimal('0.25'), Decimal('1.50')),
    'google/gemini-3.5-flash': (Decimal('1.50'), Decimal('9.00')),
    'deepseek-ai/DeepSeek-V4-Flash': (Decimal('0.09'), Decimal('0.18')),
}


class BenchmarkBudget:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / 'authorized-one-dollar.json'
        self.lock = self.directory / 'authorized-one-dollar.lock'
        self.fd = os.open(self.lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        try:
            self.state = json.loads(self.path.read_text()) if self.path.exists() else {'ceiling_usd': '1.00', 'reserved_usd': '0', 'calls': []}
            if self.state['ceiling_usd'] != '1.00' or not Decimal(self.state['reserved_usd']).is_finite() or Decimal(self.state['reserved_usd']) < 0:
                raise ValueError('INVALID_BENCHMARK_LEDGER')
        except Exception:
            self.close()
            raise

    def reserve(self, model, input_bytes, output_tokens):
        if type(input_bytes) is not int or type(output_tokens) is not int or input_bytes < 0 or output_tokens < 0:
            raise ValueError('INVALID_BENCHMARK_RESERVATION')
        input_price, output_price = PRICES[model]
        # UTF-8 bytes conservatively bound input tokens for these candidates.
        cost = (input_bytes * input_price + output_tokens * output_price) / Decimal(1000000)
        total = Decimal(self.state['reserved_usd']) + cost
        if total > Decimal('1.00'):
            raise ValueError('BENCHMARK_BUDGET_EXHAUSTED')
        self.state['reserved_usd'] = str(total)
        entry = {'id': str(uuid4()), 'model': model, 'input_byte_bound': input_bytes, 'output_token_bound': output_tokens,
            'reserved_usd': str(cost)}
        self.state['calls'].append(entry)
        self.save()
        return entry

    def save(self):
        target = self.path.with_suffix('.tmp')
        target.write_text(json.dumps(self.state, indent=2), encoding='utf-8')
        target.replace(self.path)

    def settle(self, entry, usage):
        entry = next(call for call in self.state['calls'] if call.get('id') == entry['id'])
        if 'settled_usd' in entry:
            return
        entry['reported_usage'] = {key: usage.get(key) for key in ('prompt_tokens', 'completion_tokens', 'estimated_cost')}
        inputs, outputs = usage.get('prompt_tokens'), usage.get('completion_tokens')
        if type(inputs) is int and type(outputs) is int and 0 <= inputs <= entry['input_byte_bound'] and 0 <= outputs <= entry['output_token_bound']:
            input_price, output_price = PRICES[entry['model']]
            cost = (inputs * input_price + outputs * output_price) / Decimal(1000000)
            # Use undiscounted token prices, never an optimistic cache estimate.
            self.state['reserved_usd'] = str(Decimal(self.state['reserved_usd']) - Decimal(entry['reserved_usd']) + cost)
            entry['settled_usd'] = str(cost)
        self.save()

    def close(self):
        os.close(self.fd)
        self.lock.unlink()


def reserve_request(model, input_bytes, output_tokens):
    with closing(BenchmarkBudget(Path(__file__).resolve().parents[1] / '.cache/answer-diagnostic')) as ledger:
        return ledger.reserve(model, input_bytes, output_tokens)


def settle_request(entry, usage):
    with closing(BenchmarkBudget(Path(__file__).resolve().parents[1] / '.cache/answer-diagnostic')) as ledger:
        ledger.settle(entry, usage)
