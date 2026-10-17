"""QAD-TC46: preserve model integrity across Ollama manifest wrapping."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from verify_answer import MANIFEST_TYPE, verify


class AnswerArtifactTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "blobs").mkdir()
        self.named = self.root / "manifests/registry.ollama.ai/library/qwen3/4b"
        self.named.parent.mkdir(parents=True)
        self.original = {"schemaVersion": 2, "mediaType": MANIFEST_TYPE,
                         "config": self.blob(b"configuration"),
                         "layers": [self.blob(b"model weights")]}
        self.raw = json.dumps(self.original, separators=(",", ":")).encode()
        self.expected = hashlib.sha256(self.raw).hexdigest()
        self.named.write_bytes(self.raw)

    def blob(self, data):
        digest = hashlib.sha256(data).hexdigest()
        (self.root / "blobs" / ("sha256-" + digest)).write_bytes(data)
        return {"mediaType": "application/vnd.ollama.image.model",
                "digest": "sha256:" + digest, "size": len(data)}

    def wrap(self):
        self.blob(self.raw)
        self.wrapper = {**self.original, "layers": [*self.original["layers"],
            {"mediaType": MANIFEST_TYPE, "digest": "sha256:" + self.expected,
             "size": len(self.raw)}]}
        self.named.write_text(json.dumps(self.wrapper), encoding="utf-8")

    def test_original_manifest_passes(self):
        self.assertEqual(verify(self.root, self.expected), self.expected)

    def test_wrapped_manifest_passes(self):
        self.wrap()
        self.assertNotEqual(hashlib.sha256(self.named.read_bytes()).hexdigest(), self.expected)
        self.assertEqual(verify(self.root, self.expected), self.expected)

    def test_changed_wrapper_fails(self):
        self.wrap()
        self.wrapper["layers"][0]["size"] += 1
        self.named.write_text(json.dumps(self.wrapper), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "WRAPPER_MANIFEST_MISMATCH"):
            verify(self.root, self.expected)

    def test_changed_original_fails(self):
        self.wrap()
        (self.root / "blobs" / ("sha256-" + self.expected)).write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "ORIGINAL_MANIFEST_DIGEST_MISMATCH"):
            verify(self.root, self.expected)

    def test_corrupt_weights_fail(self):
        self.wrap()
        path = self.root / "blobs" / self.original["layers"][0]["digest"].replace(":", "-", 1)
        path.write_bytes(b"wrong weights")
        with self.assertRaisesRegex(ValueError, "MODEL_BLOB_MISMATCH"):
            verify(self.root, self.expected)


if __name__ == "__main__":
    unittest.main()
