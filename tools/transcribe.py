#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Transcribe an audio/video file with faster-whisper and write a word-level JSON.

Usage:
    python transcribe.py --input voiceover.wav --output transcript.json \
        [--language ar] [--model small] [--device cpu] [--compute-type int8] \
        [--duration 207.9] [--download-root tools/models] [--no-vad]

The transcript JSON has this shape:

    {
      "language": "ar",
      "languageProbability": 0.99,
      "duration": 207.96,
      "model": "small",
      "segments": [
        {
          "id": 0,
          "start": 0.0,
          "end": 5.24,
          "text": "...",
          "words": [{"start": 0.0, "end": 0.4, "word": "...", "probability": 0.91}]
        }
      ]
    }

Progress is printed to stdout as ASCII-only lines so the Node UI can parse it
without depending on console code pages:

    @@PROGRESS 42 transcribing
    @@OK C:\\path\\transcript.json
    @@ERROR message

Anything faster-whisper prints (model download bars, warnings) goes to stderr
and is forwarded to the UI log as-is.
"""

import argparse
import json
import os
import sys
import time


# cheap "last time we printed progress" marker (list so it is mutable in main)
last_report_ts = [0.0]


def emit(line):
    """Write a machine-readable status line to stdout (ASCII safe)."""
    try:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()
    except Exception:
        pass


def emit_progress(percent, message):
    percent = max(0, min(100, int(round(percent))))
    # keep the message ASCII so cp1252 consoles never break the protocol
    safe = message.encode("ascii", "replace").decode("ascii")
    emit("@@PROGRESS:%d:%s" % (percent, safe))


def load_audio_with_ffmpeg(path, sample_rate=16000):
    """Decode any audio/video file to a mono float32 numpy array.

    faster-whisper decodes through PyAV, and recent PyAV releases removed the
    ``metadata_errors`` argument that faster-whisper still passes, which fails
    with "open() got an unexpected keyword argument 'metadata_errors'".
    Decoding with the ffmpeg CLI sidesteps that dependency mismatch.
    """
    import subprocess

    import numpy as np

    cmd = [
        "ffmpeg",
        "-nostdin",
        "-threads",
        "0",
        "-i",
        path,
        "-f",
        "f32le",
        "-ac",
        "1",
        "-acodec",
        "pcm_f32le",
        "-ar",
        str(sample_rate),
        "-",
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        tail = result.stderr.decode("utf-8", "replace").strip().splitlines()
        raise RuntimeError("ffmpeg could not decode the audio: " + (tail[-1] if tail else "unknown")[:300])
    return np.frombuffer(result.stdout, np.float32).copy()


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description="Word-level transcription with faster-whisper")
    parser.add_argument("--input", required=True, help="Path to the audio/video file")
    parser.add_argument("--output", required=True, help="Path of the transcript JSON to write")
    parser.add_argument("--language", default="ar", help="Language code, or 'auto' to detect")
    parser.add_argument("--model", default="small", help="tiny | base | small | medium | large-v3 | path")
    parser.add_argument("--device", default="cpu", help="cpu | cuda | auto")
    parser.add_argument("--compute-type", default="int8", help="int8 | int8_float16 | float16 | float32")
    parser.add_argument("--beam-size", type=int, default=5)
    parser.add_argument("--duration", type=float, default=0.0, help="Audio duration in seconds (for progress)")
    parser.add_argument("--download-root", default="", help="Folder that keeps the downloaded models")
    parser.add_argument("--no-vad", action="store_true", help="Disable voice activity detection")
    parser.add_argument("--initial-prompt", default="", help="Optional text that hints the spelling/vocabulary")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv)

    input_path = os.path.abspath(args.input)
    output_path = os.path.abspath(args.output)

    if not os.path.isfile(input_path):
        emit("@@ERROR input file not found: %s" % input_path)
        return 2

    try:
        from faster_whisper import WhisperModel
    except Exception as exc:  # pragma: no cover - environment problem
        emit(
            "@@ERROR faster-whisper is not installed (%s). Run: "
            "python -m pip install faster-whisper" % type(exc).__name__
        )
        return 3

    duration = float(args.duration or 0.0)
    language = None if not args.language or args.language == "auto" else args.language

    emit_progress(1, "loading model %s" % args.model)

    model_kwargs = {"device": args.device, "compute_type": args.compute_type}
    if args.download_root:
        os.makedirs(args.download_root, exist_ok=True)
        model_kwargs["download_root"] = os.path.abspath(args.download_root)

    started = time.time()
    last_report_ts[0] = 0.0
    try:
        model = WhisperModel(args.model, **model_kwargs)
    except Exception as exc:
        emit("@@ERROR could not load model '%s': %s" % (args.model, str(exc).replace("\n", " ")[:400]))
        return 4

    emit_progress(4, "transcribing")

    # decode ourselves (avoids PyAV/faster-whisper version clashes)
    audio_input = input_path
    try:
        audio_input = load_audio_with_ffmpeg(input_path)
        if not duration and len(audio_input):
            duration = len(audio_input) / 16000.0
    except Exception as exc:
        emit("@@WARN falling back to faster-whisper decoding")
        audio_input = input_path

    transcribe_kwargs = {
        "language": language,
        "word_timestamps": True,
        "beam_size": args.beam_size,
        "condition_on_previous_text": False,
        "vad_filter": not args.no_vad,
    }
    if not args.no_vad:
        transcribe_kwargs["vad_parameters"] = {
            "min_silence_duration_ms": 400,
            "speech_pad_ms": 120,
        }
    if args.initial_prompt:
        transcribe_kwargs["initial_prompt"] = args.initial_prompt

    try:
        segments_iter, info = model.transcribe(audio_input, **transcribe_kwargs)
    except Exception as exc:
        emit("@@ERROR transcription failed: %s" % str(exc).replace("\n", " ")[:400])
        return 5

    if not duration:
        duration = float(getattr(info, "duration", 0.0) or 0.0)

    out_segments = []
    last_report = 0.0

    try:
        for index, seg in enumerate(segments_iter):
            words = []
            for word in (seg.words or []):
                text = (word.word or "").strip()
                if not text:
                    continue
                words.append(
                    {
                        "start": round(float(word.start), 3),
                        "end": round(float(word.end), 3),
                        "word": text,
                        "probability": round(float(getattr(word, "probability", 0.0) or 0.0), 3),
                    }
                )

            text = (seg.text or "").strip()
            if not text and not words:
                continue

            out_segments.append(
                {
                    "id": index,
                    "start": round(float(seg.start), 3),
                    "end": round(float(seg.end), 3),
                    "text": text,
                    "words": words,
                }
            )

            # progress is based on how far into the audio we decoded
            if duration > 0:
                pct = 5 + 90.0 * min(1.0, float(seg.end) / duration)
                now = time.time()
                if pct - last_report >= 1.0 or now - last_report_ts[0] > 2.0:
                    last_report = pct
                    last_report_ts[0] = now
                    emit_progress(pct, "transcribing %d segments" % len(out_segments))
    except Exception as exc:
        emit("@@ERROR transcription aborted: %s" % str(exc).replace("\n", " ")[:400])
        return 6

    payload = {
        "language": getattr(info, "language", None) or language or "",
        "languageProbability": round(float(getattr(info, "language_probability", 0.0) or 0.0), 3),
        "duration": round(float(duration), 3),
        "model": args.model,
        "engine": "faster-whisper",
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "elapsedSeconds": round(time.time() - started, 1),
        "segments": out_segments,
    }

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    tmp_path = output_path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1)
    os.replace(tmp_path, output_path)

    emit_progress(100, "done")
    emit("@@OK %s" % output_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
