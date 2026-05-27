#!/usr/bin/env python3
"""Sherpa-ONNX 流式识别常驻进程。stdin/stdout 一行一条 JSON。"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from pathlib import Path
from typing import Any

import numpy as np

DEBUG_ASR = os.environ.get("SR_DEBUG_ASR", "1") != "0"

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
if hasattr(sys.stdin, "reconfigure"):
    try:
        sys.stdin.reconfigure(encoding="utf-8")
    except Exception:
        pass


def emit(obj: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def find_model_files(model_dir: Path) -> dict[str, Path]:
    tokens = model_dir / "tokens.txt"
    if not tokens.is_file():
        raise FileNotFoundError(f"缺少 tokens.txt: {model_dir}")

    def pick(patterns: list[str], *, prefer_non_int8: bool = False) -> Path:
        hits: list[Path] = []
        for pat in patterns:
            hits.extend(sorted(model_dir.glob(pat)))
        if not hits:
            raise FileNotFoundError(f"在 {model_dir} 未找到 {patterns}")
        if prefer_non_int8:
            fp32 = [h for h in hits if ".int8." not in h.name.lower()]
            if fp32:
                return fp32[0]
        return hits[0]

    return {
        "tokens": tokens,
        "encoder": pick(["encoder*.onnx", "*encoder*.onnx"]),
        "decoder": pick(["decoder*.onnx", "*decoder*.onnx"], prefer_non_int8=True),
        "joiner": pick(["joiner*.onnx", "*joiner*.onnx"]),
    }


def result_text(result: Any) -> str:
    if result is None:
        return ""
    if isinstance(result, str):
        return result.strip()
    text = getattr(result, "text", None)
    if isinstance(text, str):
        return text.strip()
    return str(result).strip()


def safe_result_text(recognizer, stream) -> str:
    try:
        return result_text(recognizer.get_result(stream))
    except Exception:
        return ""


class Engine:
    def __init__(self) -> None:
        self.recognizer = None
        self.streams: dict[str, Any] = {}
        self.audio_counts: dict[str, int] = {}

    def load(self, model_dir: str) -> None:
        import sherpa_onnx

        paths = find_model_files(Path(model_dir))
        self.recognizer = sherpa_onnx.OnlineRecognizer.from_transducer(
            tokens=str(paths["tokens"]),
            encoder=str(paths["encoder"]),
            decoder=str(paths["decoder"]),
            joiner=str(paths["joiner"]),
            num_threads=2,
            sample_rate=16000,
            feature_dim=80,
            enable_endpoint_detection=True,
            rule1_min_trailing_silence=2.4,
            rule2_min_trailing_silence=1.2,
            rule3_min_utterance_length=20,
        )
        self.streams.clear()
        emit({"event": "loaded", "modelDir": model_dir})

    def begin(self, session_id: str) -> None:
        if self.recognizer is None:
            emit({"event": "error", "code": "ENGINE_NOT_LOADED", "message": "请先 load 模型"})
            return
        self.streams[session_id] = self.recognizer.create_stream()
        self.audio_counts[session_id] = 0
        emit({"event": "session_started", "sessionId": session_id})

    def audio(self, session_id: str, samples_b64: str) -> None:
        stream = self.streams.get(session_id)
        if stream is None:
            emit(
                {
                    "event": "error",
                    "sessionId": session_id,
                    "code": "NO_SESSION",
                    "message": "未知会话",
                }
            )
            return
        raw = base64.b64decode(samples_b64)
        samples = np.frombuffer(raw, dtype=np.float32)
        if samples.size == 0:
            return
        n = self.audio_counts.get(session_id, 0) + 1
        self.audio_counts[session_id] = n
        if DEBUG_ASR and (n == 1 or n % 10 == 0):
            rms = float(np.sqrt(np.mean(samples * samples))) if samples.size else 0.0
            print(
                f"[SR-ASR] audio #{n} session={session_id} samples={samples.size} rms={rms:.4f}",
                file=sys.stderr,
                flush=True,
            )
        stream.accept_waveform(16000, samples)
        while self.recognizer.is_ready(stream):
            self.recognizer.decode_stream(stream)
        text = safe_result_text(self.recognizer, stream)
        if text:
            emit({"event": "partial", "sessionId": session_id, "text": text})

    def end(self, session_id: str) -> None:
        count = self.audio_counts.pop(session_id, 0)
        stream = self.streams.pop(session_id, None)
        if stream is None:
            emit(
                {
                    "event": "error",
                    "sessionId": session_id,
                    "code": "NO_SESSION",
                    "message": "未知会话",
                }
            )
            return
        tail = np.zeros(int(0.5 * 16000), dtype=np.float32)
        stream.accept_waveform(16000, tail)
        stream.input_finished()
        while self.recognizer.is_ready(stream):
            self.recognizer.decode_stream(stream)
        text = safe_result_text(self.recognizer, stream)
        if DEBUG_ASR:
            print(
                f"[SR-ASR] final session={session_id} chunks={count} text={text!r}",
                file=sys.stderr,
                flush=True,
            )
        emit({"event": "final", "sessionId": session_id, "text": text})


def handle(engine: Engine, msg: dict[str, Any]) -> None:
    cmd = msg.get("cmd")
    if cmd == "ping":
        emit({"event": "pong"})
        return
    if cmd == "load":
        engine.load(str(msg.get("modelDir", "")).strip())
        return
    if cmd == "begin":
        engine.begin(str(msg.get("sessionId", "")))
        return
    if cmd == "audio":
        engine.audio(str(msg.get("sessionId", "")), str(msg.get("samples", "")))
        return
    if cmd == "end":
        engine.end(str(msg.get("sessionId", "")))
        return
    if cmd == "shutdown":
        emit({"event": "bye"})
        raise SystemExit(0)
    emit({"event": "error", "code": "UNKNOWN_CMD", "message": f"未知命令: {cmd}"})


def run_daemon() -> None:
    emit({"event": "ready", "version": "0.1.0"})
    engine = Engine()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError as exc:
            emit({"event": "error", "code": "BAD_JSON", "message": str(exc)})
            continue
        try:
            handle(engine, msg)
        except SystemExit:
            raise
        except Exception as exc:  # noqa: BLE001
            emit({"event": "error", "code": "EXCEPTION", "message": str(exc)})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--daemon", action="store_true")
    args = parser.parse_args()
    if not args.daemon:
        print("请使用 --daemon 由 SR 应用启动", file=sys.stderr)
        raise SystemExit(2)
    run_daemon()


if __name__ == "__main__":
    main()
