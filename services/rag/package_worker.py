"""SDD-C23: export an explicit source allowlist, never credentials or models."""
from pathlib import Path
import io
import tarfile

root = Path(__file__).resolve().parent
output = root / 'artifacts' / 'hosted-worker.tar.gz'
output.parent.mkdir(exist_ok=True)
paths = [root / name for name in ('models.json', 'service-requirements.lock.txt', 'knowledge-parser.Dockerfile')]
paths += [path for folder in ('rag', 'knowledge') for path in (root / folder).glob('*.py')]
paths += list((root / 'rag').glob('*.json'))
paths += [root / 'deploy' / name for name in ('install-worker.sh', 'configure-worker.py', 'deskatlas-worker.service')]
with tarfile.open(output, 'w:gz') as archive:
    for path in paths:
        if not path.is_file() or path.is_symlink():
            raise ValueError('EXPECTED_SOURCE_FILE_REQUIRED')
        data = path.read_bytes().replace(b'\r\n', b'\n')
        info = tarfile.TarInfo(path.relative_to(root).as_posix())
        info.size, info.mode = len(data), 0o644
        archive.addfile(info, io.BytesIO(data))
print('Created allowlisted worker archive: services/rag/artifacts/hosted-worker.tar.gz')
