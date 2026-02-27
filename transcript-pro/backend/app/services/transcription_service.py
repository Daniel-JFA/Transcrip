import asyncio
import gc
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Callable

import numpy as np

from app.schemas.transcription import (
    JobStatus,
    TranscriptionJob,
    TranscriptionOptions,
    TranscriptionSegment,
)
from app.services.websocket_manager import ws_manager

_DLL_HANDLES: list[object] = []


def _configure_windows_cuda_dll_paths() -> None:
    if os.name != "nt":
        return

    site_packages = Path(sys.prefix) / "Lib" / "site-packages"
    candidate_dirs = [
        site_packages / "nvidia" / "cublas" / "bin",
        site_packages / "nvidia" / "cudnn" / "bin",
    ]

    for dll_dir in candidate_dirs:
        if not dll_dir.exists():
            continue

        path_value = str(dll_dir)
        if path_value.lower() not in os.environ.get("PATH", "").lower():
            os.environ["PATH"] = f"{path_value};{os.environ.get('PATH', '')}"

        if hasattr(os, "add_dll_directory"):
            try:
                _DLL_HANDLES.append(os.add_dll_directory(path_value))
            except OSError:
                pass


_configure_windows_cuda_dll_paths()


def _srt_timestamp(seconds: float) -> str:
    total_ms = int(round(seconds * 1000))
    hours = total_ms // 3_600_000
    total_ms %= 3_600_000
    minutes = total_ms // 60_000
    total_ms %= 60_000
    secs = total_ms // 1000
    millis = total_ms % 1000
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def _is_cuda_oom(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "out of memory" in msg or ("cuda" in msg and "memory" in msg)


def _model_fallback_order(requested_model: str) -> list[str]:
    sizes = ["tiny", "base", "small", "medium", "large-v3"]
    if requested_model not in sizes:
        return [requested_model]

    index = sizes.index(requested_model)
    # Requested model first, then progressively smaller models.
    return [sizes[i] for i in range(index, -1, -1)]


def _gpu_batch_size_candidates(model_name: str) -> list[int]:
    if model_name == "large-v3":
        return [4, 2, 1]
    if model_name == "medium":
        return [8, 4, 2, 1]
    return [16, 8, 4, 2, 1]


def _kmeans(features: np.ndarray, k: int, max_iter: int = 50) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(42)
    n_samples = features.shape[0]
    if k <= 1 or n_samples == 1:
        return np.zeros(n_samples, dtype=np.int32), features[[0]]

    centroids = features[rng.choice(n_samples, size=k, replace=False)]
    labels = np.zeros(n_samples, dtype=np.int32)

    for _ in range(max_iter):
        distances = np.sum((features[:, None, :] - centroids[None, :, :]) ** 2, axis=2)
        new_labels = np.argmin(distances, axis=1).astype(np.int32)

        new_centroids = centroids.copy()
        for cluster in range(k):
            members = features[new_labels == cluster]
            if members.size == 0:
                new_centroids[cluster] = features[rng.integers(0, n_samples)]
            else:
                new_centroids[cluster] = members.mean(axis=0)

        if np.array_equal(new_labels, labels) and np.allclose(
            new_centroids, centroids, atol=1e-4
        ):
            labels = new_labels
            centroids = new_centroids
            break

        labels = new_labels
        centroids = new_centroids

    return labels, centroids


def _silhouette_score(features: np.ndarray, labels: np.ndarray) -> float:
    unique_labels = np.unique(labels)
    if unique_labels.size < 2:
        return -1.0

    distances = np.sqrt(np.sum((features[:, None, :] - features[None, :, :]) ** 2, axis=2))
    scores: list[float] = []

    for idx in range(features.shape[0]):
        own_label = labels[idx]
        own_mask = labels == own_label
        own_mask[idx] = False

        if np.any(own_mask):
            a = float(np.mean(distances[idx, own_mask]))
        else:
            a = 0.0

        b_candidates = []
        for candidate in unique_labels:
            if candidate == own_label:
                continue
            candidate_mask = labels == candidate
            if np.any(candidate_mask):
                b_candidates.append(float(np.mean(distances[idx, candidate_mask])))

        if not b_candidates:
            scores.append(0.0)
            continue

        b = min(b_candidates)
        denom = max(a, b)
        scores.append(0.0 if denom == 0 else (b - a) / denom)

    return float(np.mean(scores))


def _segment_feature_vector(audio: np.ndarray, start: float, end: float, sr: int) -> np.ndarray | None:
    start_idx = max(0, int(start * sr))
    end_idx = min(audio.shape[0], int(end * sr))
    segment = audio[start_idx:end_idx]
    if segment.size < int(0.2 * sr):
        return None

    segment = segment.astype(np.float32)
    segment -= float(np.mean(segment))

    frame_len = 400
    hop_len = 160
    if segment.size < frame_len:
        segment = np.pad(segment, (0, frame_len - segment.size))

    n_frames = 1 + (segment.size - frame_len) // hop_len
    if n_frames <= 0:
        return None

    frames = np.stack(
        [segment[i * hop_len : i * hop_len + frame_len] for i in range(n_frames)], axis=0
    )
    window = np.hanning(frame_len).astype(np.float32)
    frames = frames * window[None, :]

    spectrum = np.abs(np.fft.rfft(frames, n=512, axis=1)) ** 2
    mean_spectrum = np.mean(spectrum, axis=0)
    bands = np.array_split(mean_spectrum, 24)
    band_energy = np.log1p(np.array([np.mean(band) for band in bands], dtype=np.float32))

    rms = np.sqrt(np.mean(segment**2))
    zcr = float(np.mean(np.abs(np.diff(np.sign(segment)))))

    return np.concatenate(
        [
            band_energy,
            np.array([np.log1p(rms * 1000.0), zcr], dtype=np.float32),
        ]
    )


class TranscriptionService:
    def __init__(self) -> None:
        self._jobs: dict[str, TranscriptionJob] = {}
        self._sources: dict[str, Path] = {}
        self._options: dict[str, TranscriptionOptions] = {}

    def create_job(
        self,
        *,
        job_id: str,
        filename: str,
        source_path: Path,
        options: TranscriptionOptions,
    ) -> TranscriptionJob:
        now = datetime.now(UTC)
        job = TranscriptionJob(
            id=job_id,
            filename=filename,
            created_at=now,
            updated_at=now,
        )

        self._jobs[job_id] = job
        self._sources[job_id] = source_path
        self._options[job_id] = options
        asyncio.create_task(self._run_job(job_id))
        return job

    def get_job(self, job_id: str) -> TranscriptionJob | None:
        return self._jobs.get(job_id)

    async def _update_job(self, job_id: str, **changes: object) -> None:
        job = self._jobs[job_id]
        if "progress" in changes:
            try:
                proposed = float(changes["progress"])  # type: ignore[arg-type]
            except (TypeError, ValueError):
                proposed = job.progress

            # Progress bar must be monotonic to avoid visual resets on retries/fallbacks.
            if proposed < job.progress and proposed < 100.0:
                changes["progress"] = job.progress

        updated = job.model_copy(update={**changes, "updated_at": datetime.now(UTC)})
        self._jobs[job_id] = updated
        await ws_manager.broadcast(
            job_id,
            {"type": "job.update", "data": updated.model_dump(mode="json")},
        )

    async def _run_job(self, job_id: str) -> None:
        await self._update_job(
            job_id,
            status=JobStatus.RUNNING,
            progress=1.0,
            message="Loading model",
        )

        loop = asyncio.get_running_loop()

        def progress_callback(progress: float, message: str) -> None:
            asyncio.run_coroutine_threadsafe(
                self._update_job(
                    job_id,
                    progress=max(1.0, min(99.0, round(progress, 2))),
                    message=message,
                ),
                loop,
            )

        try:
            source_path = self._sources[job_id]
            options = self._options[job_id]
            text, srt_text, segments = await asyncio.to_thread(
                self._transcribe_sync, source_path, options, progress_callback
            )

            await self._update_job(
                job_id,
                status=JobStatus.COMPLETED,
                progress=100.0,
                message="Completed",
                text=text,
                srt=srt_text,
                segments=segments,
            )
        except Exception as exc:
            await self._update_job(
                job_id,
                status=JobStatus.FAILED,
                progress=100.0,
                message="Failed",
                error=str(exc),
            )

    def _apply_diarization(
        self,
        source_path: Path,
        segments: list[TranscriptionSegment],
        options: TranscriptionOptions,
        progress_callback: Callable[[float, str], None],
    ) -> None:
        if not options.diarization or not segments:
            return

        from faster_whisper.audio import decode_audio

        progress_callback(96.0, "Distinguishing speakers")

        sample_rate = 16_000
        audio = decode_audio(str(source_path), sampling_rate=sample_rate)
        if audio is None or len(audio) == 0:
            return

        features: list[np.ndarray] = []
        valid_indexes: list[int] = []
        for index, segment in enumerate(segments):
            feature = _segment_feature_vector(audio, segment.start, segment.end, sample_rate)
            if feature is not None:
                features.append(feature)
                valid_indexes.append(index)

        if len(valid_indexes) < 2:
            segments[0].speaker = "SPEAKER_01"
            return

        feature_matrix = np.stack(features, axis=0)
        feature_matrix = (feature_matrix - feature_matrix.mean(axis=0)) / (
            feature_matrix.std(axis=0) + 1e-6
        )

        max_k = min(4, feature_matrix.shape[0])
        if options.diarization_speakers:
            min_k = max(1, min(options.diarization_speakers, max_k))
            candidate_ks = [min_k]
        else:
            candidate_ks = list(range(1, max_k + 1))

        best_labels = np.zeros(feature_matrix.shape[0], dtype=np.int32)
        best_score = -1.0
        for k in candidate_ks:
            labels, _ = _kmeans(feature_matrix, k)
            score = _silhouette_score(feature_matrix, labels) if k > 1 else -1.0
            if score > best_score:
                best_score = score
                best_labels = labels

        if not options.diarization_speakers and best_score < 0.08:
            best_labels = np.zeros(feature_matrix.shape[0], dtype=np.int32)

        label_to_speaker: dict[int, str] = {}
        speaker_count = 1
        for feature_index, label in enumerate(best_labels):
            if int(label) not in label_to_speaker:
                label_to_speaker[int(label)] = f"SPEAKER_{speaker_count:02d}"
                speaker_count += 1
            segments[valid_indexes[feature_index]].speaker = label_to_speaker[int(label)]

        # Fill short/invalid segments with the nearest known speaker.
        nearest_speaker = "SPEAKER_01"
        for segment in segments:
            if segment.speaker:
                nearest_speaker = segment.speaker
            else:
                segment.speaker = nearest_speaker

    def _transcribe_sync(
        self,
        source_path: Path,
        options: TranscriptionOptions,
        progress_callback: Callable[[float, str], None],
    ) -> tuple[str, str | None, list[TranscriptionSegment]]:
        try:
            from faster_whisper import BatchedInferencePipeline, WhisperModel
        except ImportError as exc:
            raise RuntimeError(
                "faster-whisper is not installed. Install backend requirements first."
            ) from exc

        language = None if options.lang.lower() == "auto" else options.lang
        model_candidates = _model_fallback_order(options.model)

        gpu_runtime_candidates: list[tuple[str, str]] = []
        cpu_runtime_candidates: list[tuple[str, str]] = []
        if options.device == "cuda":
            for candidate in [
                ("cuda", options.compute_type),
                ("cuda", "int8_float16"),
                ("cuda", "int8"),
                ("cuda", "float16"),
            ]:
                if candidate not in gpu_runtime_candidates:
                    gpu_runtime_candidates.append(candidate)
            for candidate in [("cpu", "int8"), ("cpu", "float32")]:
                if candidate not in cpu_runtime_candidates:
                    cpu_runtime_candidates.append(candidate)
            runtime_phases: list[list[tuple[str, str]]] = [
                gpu_runtime_candidates,
                cpu_runtime_candidates,
            ]
        else:
            for candidate in [
                ("cpu", options.compute_type),
                ("cpu", "int8"),
                ("cpu", "float32"),
            ]:
                if candidate not in cpu_runtime_candidates:
                    cpu_runtime_candidates.append(candidate)
            runtime_phases = [cpu_runtime_candidates]

        beam_candidates = [options.beam_size]
        if options.beam_size > 1:
            beam_candidates.append(1)

        segments: list[TranscriptionSegment] = []
        last_exc: Exception | None = None

        for runtime_candidates in runtime_phases:
            for model_name in model_candidates:
                for device, compute_type in runtime_candidates:
                    progress_callback(
                        2.0,
                        f"Loading model {model_name} on {device} ({compute_type})",
                    )

                    try:
                        model = WhisperModel(
                            model_name,
                            device=device,
                            compute_type=compute_type,
                        )
                    except Exception as exc:  # pragma: no cover - hardware/runtime dependent
                        last_exc = exc
                        if _is_cuda_oom(exc):
                            progress_callback(
                                2.0,
                                f"CUDA OOM loading {model_name} ({compute_type}), trying fallback",
                            )
                        continue

                    progress_callback(
                        5.0,
                        f"Model ready ({model_name}, {device}, {compute_type})",
                    )

                    runtime_failed = False
                    for beam_size in beam_candidates:
                        try:
                            if device == "cuda":
                                pipeline = BatchedInferencePipeline(model=model)
                                batch_sizes = _gpu_batch_size_candidates(model_name)
                            else:
                                pipeline = model
                                batch_sizes = [1]

                            run_succeeded = False
                            for batch_size in batch_sizes:
                                try:
                                    if device == "cuda":
                                        segments_iter, info = pipeline.transcribe(
                                            str(source_path),
                                            language=language,
                                            beam_size=beam_size,
                                            vad_filter=True,
                                            batch_size=batch_size,
                                        )
                                        progress_callback(
                                            6.0,
                                            f"GPU decode running (beam={beam_size}, batch={batch_size})",
                                        )
                                    else:
                                        segments_iter, info = pipeline.transcribe(
                                            str(source_path),
                                            language=language,
                                            beam_size=beam_size,
                                            vad_filter=True,
                                        )

                                    total_duration = float(getattr(info, "duration", 0.0) or 0.0)
                                    segments = []
                                    last_end = 0.0

                                    for segment in segments_iter:
                                        segment_text = (segment.text or "").strip()
                                        if segment_text:
                                            segments.append(
                                                TranscriptionSegment(
                                                    start=float(segment.start),
                                                    end=float(segment.end),
                                                    text=segment_text,
                                                )
                                            )

                                        last_end = max(last_end, float(segment.end))
                                        if total_duration > 0:
                                            progress = (last_end / total_duration) * 95.0
                                        else:
                                            progress = min(95.0, 10.0 + len(segments) * 1.5)
                                        progress_callback(progress, "Transcribing audio")

                                    run_succeeded = True
                                    break
                                except Exception as exc:  # pragma: no cover - hardware/runtime dependent
                                    last_exc = exc
                                    if device == "cuda" and _is_cuda_oom(exc) and batch_size != 1:
                                        progress_callback(
                                            8.0,
                                            f"CUDA OOM with batch={batch_size}, retrying lower batch",
                                        )
                                        continue
                                    raise

                            if run_succeeded:
                                break
                        except Exception as exc:  # pragma: no cover - hardware/runtime dependent
                            last_exc = exc
                            if device == "cuda" and _is_cuda_oom(exc) and beam_size != 1:
                                progress_callback(
                                    8.0,
                                    "CUDA OOM during decode, retrying with beam_size=1",
                                )
                                continue
                            runtime_failed = True
                            break

                    if segments and not runtime_failed:
                        break

                    del model
                    gc.collect()

                if segments:
                    break
            if segments:
                break

        if not segments:
            raise RuntimeError(
                "No se pudo transcribir con la configuraci?n solicitada ni con fallbacks "
                "autom?ticos (GPU/CPU y modelos m?s peque?os)."
            ) from last_exc

        self._apply_diarization(source_path, segments, options, progress_callback)

        text_parts = []
        for seg in segments:
            if seg.speaker and options.diarization:
                text_parts.append(f"[{seg.speaker}] {seg.text}")
            else:
                text_parts.append(seg.text)
        full_text = " ".join(text_parts).strip()

        srt_lines: list[str] = []
        if options.generate_srt:
            for index, seg in enumerate(segments, start=1):
                start = _srt_timestamp(seg.start)
                end = _srt_timestamp(seg.end)
                line_text = f"[{seg.speaker}] {seg.text}" if seg.speaker and options.diarization else seg.text
                srt_lines.append(str(index))
                srt_lines.append(f"{start} --> {end}")
                srt_lines.append(line_text)
                srt_lines.append("")

        srt_text = "\n".join(srt_lines).strip() + "\n" if options.generate_srt else None
        return full_text, srt_text, segments


transcription_service = TranscriptionService()
