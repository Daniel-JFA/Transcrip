import argparse
from pathlib import Path
import whisper
import torch

def main():
    parser = argparse.ArgumentParser(description="Transcribe audio with Whisper (GPU + Progress).")
    parser.add_argument("audio", help="Path to audio file")
    parser.add_argument("--lang", default="es")
    parser.add_argument("--model", default="small")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()

    audio_path = Path(args.audio)
    if not audio_path.exists():
        raise FileNotFoundError(f"No existe el archivo: {audio_path}")

    out_path = Path(args.out) if args.out else audio_path.with_suffix(".txt")

    print("🔎 Cargando modelo...")
    model = whisper.load_model(args.model)

    # GPU
    if torch.cuda.is_available():
        print("🚀 Usando GPU:", torch.cuda.get_device_name(0))
        model = model.to("cuda")
        fp16 = True
    else:
        print("⚠️ Usando CPU")
        fp16 = False

    print("🎧 Transcribiendo...")

    result = model.transcribe(
        str(audio_path),
        language=args.lang,
        fp16=fp16,
        verbose=False
    )

    # ===== PROGRESO =====
    segments = result["segments"]
    total = len(segments)

    print("\n📊 Progreso:")
    text_parts = []

    for i, seg in enumerate(segments, start=1):
        percent = (i / total) * 100
        print(f"\r⏳ {percent:6.2f}% completado", end="")
        text_parts.append(seg["text"].strip())

    print("\n\n✅ Transcripción finalizada.")

    text = " ".join(text_parts)
    out_path.write_text(text + "\n", encoding="utf-8")

    print(f"💾 Guardado en: {out_path}")
    print("\n--- PREVIEW ---\n")
    print(text[:1200] + ("..." if len(text) > 1200 else ""))


if __name__ == "__main__":
    main()