"""Local text embeddings for semantic search.

Runs the BAAI/bge-small-en-v1.5 model (MIT license) with onnxruntime on this computer.
Nothing is sent anywhere; the only network access is the one-time model download, which
is pinned to a fixed commit and checked against known SHA-256 hashes.

Optional: without numpy, onnxruntime and tokenizers (requirements-semantic.txt) search
stays keyword only. Set X9_SEMANTIC=0 to turn semantic search off even when they are
installed.
"""
import hashlib
import os
import re
import urllib.request
from pathlib import Path

MODEL_NAME = "BAAI/bge-small-en-v1.5"
MODEL_REVISION = "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a"  # 2024-02-22, "onnx support"
MODEL_FILES = {
    "onnx/model.onnx": "828e1496d7fabb79cfa4dcd84fa38625c0d3d21da474a00f08db0f559940cf35",
    "tokenizer.json": "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66",
}
MODEL_DIR = Path(os.environ.get("X9_MODEL_DIR") or Path(__file__).resolve().parent / "models" / "bge-small-en-v1.5")
# bge v1.5 is trained to put this in front of search queries (not in front of documents).
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "
MAX_TOKENS = 512
BATCH_SIZE = 32


def semantic_disabled_reason():
    """None when semantic search can run, otherwise a short reason."""
    if os.environ.get("X9_SEMANTIC") == "0":
        return "turned off (X9_SEMANTIC=0)"
    needed = ["numpy"] if os.environ.get("X9_EMBEDDER") == "hash" else ["numpy", "onnxruntime", "tokenizers"]
    for mod in needed:
        try:
            __import__(mod)
        except ImportError:
            return "not installed (see x9_search_engine/requirements-semantic.txt)"
    return None


def _download(rel, sha256):
    target = MODEL_DIR / rel
    # Checked against the hash when it was downloaded (only a verified file is ever moved
    # into place), so a search does not re-hash 133 MB every time.
    if target.exists():
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    url = f"https://huggingface.co/{MODEL_NAME}/resolve/{MODEL_REVISION}/{rel}"
    tmp = target.with_name(target.name + ".part")
    print(f"[X9 Embed] Downloading {rel} from {MODEL_NAME} (one time)...")
    with urllib.request.urlopen(url, timeout=120) as r, open(tmp, "wb") as f:
        while chunk := r.read(1 << 20):
            f.write(chunk)
    got = _sha256(tmp)
    if got != sha256:
        tmp.unlink()
        raise RuntimeError(f"Model file {rel} failed its hash check (got {got}). Not used.")
    os.replace(tmp, target)
    return target


def _sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


class OnnxEmbedder:
    """bge-small-en-v1.5: CLS pooling, then L2 normalization, 384 dimensions."""
    model_id = f"{MODEL_NAME}@{MODEL_REVISION[:12]}"
    dims = 384

    def __init__(self):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        model_path = _download("onnx/model.onnx", MODEL_FILES["onnx/model.onnx"])
        tok_path = _download("tokenizer.json", MODEL_FILES["tokenizer.json"])
        self.tokenizer = Tokenizer.from_file(str(tok_path))
        self.tokenizer.enable_truncation(MAX_TOKENS)
        self.tokenizer.enable_padding(pad_id=0, pad_token="[PAD]")
        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        # Half the cores: the background rebuild should not make the PC sluggish.
        opts.intra_op_num_threads = max(1, (os.cpu_count() or 2) // 2)
        # Measured on 800 chunks: the memory arena is about 45% faster but peaks at 2.1 GB
        # instead of 1.1 GB. This runs in the background, so memory wins.
        opts.enable_cpu_mem_arena = False
        self.session = ort.InferenceSession(str(model_path), opts, providers=["CPUExecutionProvider"])
        self.input_names = {i.name for i in self.session.get_inputs()}

    def _embed(self, texts):
        import numpy as np
        out = np.zeros((len(texts), self.dims), dtype=np.float32)
        # Sort by length so each batch pads to similar lengths (much faster on long logs).
        order = sorted(range(len(texts)), key=lambda i: len(texts[i]))
        for start in range(0, len(order), BATCH_SIZE):
            idx = order[start:start + BATCH_SIZE]
            enc = self.tokenizer.encode_batch([texts[i] for i in idx])
            feeds = {
                "input_ids": np.array([e.ids for e in enc], dtype=np.int64),
                "attention_mask": np.array([e.attention_mask for e in enc], dtype=np.int64),
                "token_type_ids": np.array([e.type_ids for e in enc], dtype=np.int64),
            }
            hidden = self.session.run(None, {k: v for k, v in feeds.items() if k in self.input_names})[0]
            out[idx] = hidden[:, 0]
        return _normalize(out)

    def embed_documents(self, texts):
        return self._embed(texts)

    def embed_query(self, text):
        return self._embed([QUERY_PREFIX + text])[0]


class HashEmbedder:
    """Test stand-in: hashed bag of words. It finds shared words, not meaning, but it
    exercises the whole pipeline (chunking, storage, reuse, ranking) without a model."""
    model_id = "hash-test"
    dims = 2048  # wide enough that unrelated test words rarely share a slot

    def _vec(self, text):
        import numpy as np
        v = np.zeros(self.dims, dtype=np.float32)
        for word in re.findall(r"[a-z0-9]{3,}", text.lower()):
            v[int.from_bytes(hashlib.blake2b(word.encode(), digest_size=4).digest(), "little") % self.dims] += 1.0
        return v

    def embed_documents(self, texts):
        import numpy as np
        return _normalize(np.stack([self._vec(t) for t in texts])) if texts else np.zeros((0, self.dims), np.float32)

    def embed_query(self, text):
        return _normalize(self._vec(text)[None, :])[0]


def _normalize(m):
    import numpy as np
    norms = np.linalg.norm(m, axis=1, keepdims=True)
    return (m / np.where(norms == 0, 1, norms)).astype(np.float32)


def get_embedder():
    return HashEmbedder() if os.environ.get("X9_EMBEDDER") == "hash" else OnnxEmbedder()


CHUNK_CHARS = 1000
CHUNK_OVERLAP = 150


def chunk_text(text, size=CHUNK_CHARS, overlap=CHUNK_OVERLAP):
    """Split text into overlapping pieces of about `size` characters, preferring to cut
    at a blank line, then a line break, then a sentence end, then a space."""
    text = text.strip()
    chunks = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            window = text[start:end]
            for sep in ("\n\n", "\n", ". ", " "):
                cut = window.rfind(sep)
                if cut > size // 2:
                    end = start + cut + len(sep)
                    break
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return chunks
