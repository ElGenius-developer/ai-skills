"""Read stdin aloud: Egyptian VoiceTut-TTS (Hugging Face Space), edge-tts Salma as fallback."""
import os
import re
import shutil
import subprocess
import sys
import tempfile

SPACE = "mohammedaly22/VoiceTut-TTS"
SPEAKER = os.environ.get("SPEAK_REPLY_SPEAKER", "Mohammed")
FIRST_CHUNK_CHARS = 400  # short first chunk so playback starts within seconds
CHUNK_CHARS = 2500  # the Space refuses more than 3000 characters per request
EDGE_TTS = shutil.which("edge-tts") or os.path.expanduser("~/.local/bin/edge-tts")


def chunks(text):
    limit, buf = FIRST_CHUNK_CHARS, ""
    for sentence in re.split(r"(?<=[.!?؟\n])\s+", text):
        while len(sentence) > limit:
            if buf:
                yield buf
                buf, limit = "", CHUNK_CHARS
            yield sentence[:limit]
            sentence, limit = sentence[limit:], CHUNK_CHARS
        if buf and len(buf) + len(sentence) + 1 > limit:
            yield buf
            buf, limit = sentence, CHUNK_CHARS
        else:
            buf = f"{buf} {sentence}".strip()
    if buf:
        yield buf


def voicetut(client, text):
    wav, _ = client.predict(text, "arz", "speaker", SPEAKER, None, "", 32, 2.0, 1.0, True, api_name="/synthesize")
    return wav


def salma(text):
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as file:
        out = file.name
    subprocess.run([EDGE_TTS, "--voice", "ar-EG-SalmaNeural", "--text", text, "--write-media", out], check=True)
    return out


def main():
    text = sys.stdin.read().strip()
    if not text:
        return
    try:
        from gradio_client import Client

        client = Client(SPACE, verbose=False)
    except Exception as error:
        client = None
        print(f"FALLBACK: {error}", flush=True)
    player = None
    for part in chunks(text):
        try:
            wav = voicetut(client, part) if client else salma(part)
        except Exception as error:
            if client:
                print(f"FALLBACK: {error}", flush=True)
            client, wav = None, salma(part)
        if player:
            player.wait()
        player = subprocess.Popen(["afplay", wav])
    if player:
        player.wait()


if __name__ == "__main__":
    main()
