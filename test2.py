import argparse
import os
from pathlib import Path
import sys
from faster_whisper import WhisperModel


def fmt_srt_time(seconds: float) -> str:
    # SRT: HH:MM:SS,mmm
    ms = int(round(seconds * 1000))
    hh = ms // 3_600_000
    ms %= 3_600_000
    mm = ms // 60_000
    ms %= 60_000
    ss = ms // 1000
    ms %= 1000
    return f"{hh:02d}:{mm:02d}:{ss:02d},{ms:03d}"


def is_cuda_runtime_error(err: Exception) -> bool:
    msg = str(err).lower()
    cuda_markers = ("cublas", "cuda", "cudnn", "cannot be loaded", "is not found")
    return any(marker in msg for marker in cuda_markers)


def setup_cuda_dll_dirs() -> None:
    if os.name != "nt":
        return

    candidate_dirs = [
        Path(sys.prefix) / "Lib" / "site-packages" / "nvidia" / "cublas" / "bin",
        Path(sys.prefix) / "Lib" / "site-packages" / "nvidia" / "cudnn" / "bin",
        Path("C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v13.0/bin"),
        Path("C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.9/bin"),
        Path("C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.8/bin"),
        Path("C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.6/bin"),
        Path("C:/Program Files/NVIDIA GPU Computing Toolkit/CUDA/v12.4/bin"),
    ]

    added = []
    for dll_dir in candidate_dirs:
        if dll_dir.exists():
            try:
                os.add_dll_directory(str(dll_dir))
                added.append(str(dll_dir))
            except (FileNotFoundError, OSError):
                pass

    if added:
        print("🧩 DLL dirs CUDA registradas:")
        for dll_dir in added:
            print(f"   - {dll_dir}")


def main():
    ap = argparse.ArgumentParser(description="Transcripción PRO (GPU + progreso + TXT + SRT) con faster-whisper.")
    ap.add_argument("audio", help="Ruta al audio (mp3/wav/m4a)")
    ap.add_argument("--lang", default="es", help="Idioma: es | auto (default: es)")
    ap.add_argument("--model", default="medium", help="tiny/base/small/medium/large-v3 (default: medium)")
    ap.add_argument("--device", default="cuda", help="cuda o cpu (default: cuda)")
    ap.add_argument("--compute", default="float16",
                    help="float16 (preciso en GPU) | int8_float16 (más rápido) | int8 (más ligero)")
    ap.add_argument("--beam", type=int, default=5, help="beam_size: más alto=más preciso, más lento (default: 5)")
    ap.add_argument("--out", default=None, help="Salida TXT (default: mismo nombre .txt)")
    ap.add_argument("--srt", action="store_true", help="Generar archivo .srt")
    args = ap.parse_args()

    audio_path = Path(args.audio)
    if not audio_path.exists():
        raise FileNotFoundError(f"No existe el archivo: {audio_path}")

    out_txt = Path(args.out) if args.out else audio_path.with_suffix(".txt")
    out_srt = audio_path.with_suffix(".srt")

    if args.device == "cuda":
        setup_cuda_dll_dirs()

    # Transcribe con VAD (recorta silencios) y beam
    language = None if args.lang.lower() == "auto" else args.lang

    def run_transcribe(device: str, compute: str):
        print(f"🔎 Cargando modelo: {args.model} | device={device} | compute={compute}")
        model = WhisperModel(args.model, device=device, compute_type=compute)
        print("🎧 Transcribiendo (con VAD)...")
        segments_iter, info_obj = model.transcribe(
            str(audio_path),
            language=language,
            beam_size=args.beam,
            vad_filter=True,
        )
        return segments_iter, info_obj

    selected_device = args.device
    selected_compute = args.compute

    try:
        segments, info = run_transcribe(selected_device, selected_compute)
        segments = list(segments)
    except RuntimeError as err:
        if selected_device == "cuda" and is_cuda_runtime_error(err):
            print("⚠️ CUDA no disponible correctamente (faltan DLLs). Reintentando en CPU...")
            selected_device = "cpu"
            selected_compute = "int8" if args.compute == "float16" else args.compute
            segments, info = run_transcribe(selected_device, selected_compute)
            segments = list(segments)
        else:
            raise

    # Duración total estimada del audio (para % real)
    total_dur = getattr(info, "duration", None)
    if total_dur is None:
        # fallback: si no viene, estimamos al final con el último segmento
        total_dur = 0.0

    txt_lines = []
    srt_lines = []
    last_end = 0.0
    idx = 1

    for seg in segments:
        # Progreso basado en tiempo
        last_end = max(last_end, float(seg.end))
        if total_dur and total_dur > 0:
            pct = min(100.0, (last_end / total_dur) * 100.0)
            sys.stdout.write(f"\r⏳ Progreso: {pct:6.2f}%   ")
            sys.stdout.flush()

        text = (seg.text or "").strip()
        if text:
            txt_lines.append(text)

            if args.srt:
                start = fmt_srt_time(float(seg.start))
                end = fmt_srt_time(float(seg.end))
                srt_lines.append(str(idx))
                srt_lines.append(f"{start} --> {end}")
                srt_lines.append(text)
                srt_lines.append("")  # línea en blanco
                idx += 1

    sys.stdout.write("\r⏳ Progreso: 100.00%   \n")
    sys.stdout.flush()

    full_text = " ".join(txt_lines).strip()
    out_txt.write_text(full_text + "\n", encoding="utf-8")
    print(f"✅ TXT guardado en: {out_txt}")

    if args.srt:
        out_srt.write_text("\n".join(srt_lines).strip() + "\n", encoding="utf-8")
        print(f"✅ SRT guardado en: {out_srt}")

    print("\n--- PREVIEW ---\n")
    print(full_text[:1200] + ("..." if len(full_text) > 1200 else ""))


if __name__ == "__main__":
    main()