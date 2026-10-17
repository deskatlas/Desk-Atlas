"""MS46-TC11: freeze one content-free manifest before a multi-profile run."""
import argparse
import json
from pathlib import Path
from rag.identity import freeze_identity

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--cases', required=True, type=Path)
    parser.add_argument('--corpus-manifest', required=True, type=Path)
    parser.add_argument('--runtime-settings', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    try:
        output = args.out.resolve()
        if not output.is_relative_to(ROOT / 'services/rag/benchmark-results'):
            raise ValueError('IGNORED_METADATA_DIRECTORY_REQUIRED')
        identity = freeze_identity(ROOT, json.loads(args.corpus_manifest.read_text(encoding='utf-8')),
                                   json.loads(args.cases.read_text(encoding='utf-8')),
                                   json.loads(args.runtime_settings.read_text(encoding='utf-8')))
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('x', encoding='utf-8') as target:
            json.dump(identity, target, sort_keys=True, indent=2)
        print(json.dumps({'status': 'FROZEN', 'identity': identity, 'release_evidence': False}))
        return 0
    except (ValueError, KeyError, TypeError, OSError):
        print(json.dumps({'status': 'FAILED', 'error_code': 'RUN_MANIFEST_NOT_FROZEN'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
