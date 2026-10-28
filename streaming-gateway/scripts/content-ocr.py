import base64
import contextlib
import json
import os
import sys

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")

with contextlib.redirect_stdout(sys.stderr):
    import cv2
    from rapidocr import RapidOCR

    cv2.setNumThreads(1)
    engine = RapidOCR(params={
        "EngineConfig.onnxruntime.intra_op_num_threads": 1,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
        "Global.use_cls": False,
    })

data = sys.stdin.buffer.read(8 * 1024 * 1024 + 1)
if len(data) > 8 * 1024 * 1024:
    raise ValueError("content_sample_too_large")
images = json.loads(data)["images"]
if not isinstance(images, list) or len(images) > 2:
    raise ValueError("invalid_content_sample")
samples = []
for value in images:
    with contextlib.redirect_stdout(sys.stderr):
        result = engine(base64.b64decode(value, validate=True))
    samples.append([
        {"text": str(text), "confidence": round(float(score) * 100, 2)}
        for text, score in zip(result.txts if result.txts is not None else [], result.scores if result.scores is not None else [])
        if float(score) >= 0.5
    ])
print(json.dumps(samples, ensure_ascii=True))
