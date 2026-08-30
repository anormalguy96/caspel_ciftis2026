"""Voice-message transcription.

A visitor records a short question, it is transcribed, and the text lands in
the composer for them to check before sending. The audio exists for exactly as
long as the transcription call and is then deleted from disk and from the
provider.

Nothing in this module logs the audio, the file path, the provider file URI,
the transcript, or the key. A transcript is a visitor's question in the most
personal form the product ever handles -- spoken -- so it is treated as
strictly as the chat message it becomes.
"""
from __future__ import annotations

import logging
import os
import tempfile
from dataclasses import dataclass
from typing import Optional

from app.core.config import settings
from app.rag.errors import ProviderUnavailableError

logger = logging.getLogger(__name__)

#: Container formats a browser MediaRecorder actually produces. Anything else
#: is refused rather than handed to a provider to identify.
ALLOWED_MIME_TYPES = {
    "audio/webm",
    "audio/webm;codecs=opus",
    "audio/ogg",
    "audio/ogg;codecs=opus",
    "audio/mp4",
    "audio/mpeg",
    "audio/aac",
}

#: 10 MiB. A 60-second Opus recording is well under 1 MiB; this is headroom for
#: a less efficient codec, not an invitation to upload a file.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

#: Matches the browser-side recording cap.
MAX_DURATION_SECONDS = 60

#: The assistant's own vocabulary. Speech models reliably mangle product names
#: they have never seen, and "IRISSEA" becoming "Irisi" produces a question the
#: corpus cannot answer.
VOCABULARY = (
    "CASPEL",
    "Caspel ERP",
    "Caspel PMS",
    "IRISSEA",
    "LRIT",
    "CIFTIS",
    "Corporate Presentation",
    "Enterprise Resource Planning",
)

_PROMPT = (
    "Transcribe this audio exactly as spoken. Detect the language "
    "automatically and transcribe in that language; do not translate. "
    "Return only the transcript, with no commentary. "
    "These proper nouns may appear and must be spelled exactly as listed: "
    + ", ".join(VOCABULARY)
    + "."
)


class TranscriptionRejected(ValueError):
    """The upload is not something we accept. Reported as 4xx, not 5xx."""


@dataclass(frozen=True)
class Transcript:
    text: str


def normalise_mime(raw: Optional[str]) -> str:
    """Lower-case and strip parameters we do not care about, keeping codecs."""
    if not raw:
        return ""
    return raw.split(",")[0].strip().lower().replace("; ", ";")


def validate_upload(content_type: Optional[str], size_bytes: int) -> str:
    """Reject anything outside the allowlist before a byte reaches a provider."""
    mime = normalise_mime(content_type)
    base = mime.split(";")[0]

    if mime not in ALLOWED_MIME_TYPES and base not in ALLOWED_MIME_TYPES:
        # The rejected value is not echoed back: it is attacker-controlled text.
        raise TranscriptionRejected("unsupported_media_type")

    if size_bytes <= 0:
        raise TranscriptionRejected("empty_upload")

    if size_bytes > MAX_UPLOAD_BYTES:
        raise TranscriptionRejected("upload_too_large")

    return base


class TranscriptionService:
    """Wraps the provider call, its temporary file, and their cleanup."""

    def __init__(self) -> None:
        self.api_key = settings.GEMINI_API_KEY
        self.model_name = getattr(
            settings, "GEMINI_TRANSCRIPTION_MODEL", "gemini-3.5-transcribe"
        )
        self._client = None

        if self.api_key:
            try:
                from google import genai

                self._client = genai.Client(api_key=self.api_key)
                logger.info("Transcription service initialised with model: %s", self.model_name)
            except Exception:
                # No exception text: a provider client can put configuration
                # into its message.
                logger.error("Failed to initialise the transcription client")

    @property
    def is_live_provider(self) -> bool:
        return bool(self._client is not None and self.api_key)

    def transcribe(self, audio: bytes, mime_type: str) -> Transcript:
        """Transcribe one recording. Raises rather than returning a stand-in.

        The temporary file and the provider-side upload are both removed in
        `finally`, so a timeout or a crash mid-call does not leave visitor
        audio behind on either side.
        """
        if not self.is_live_provider:
            raise ProviderUnavailableError("Transcription provider is unavailable")

        from google.genai import types

        tmp_path: Optional[str] = None
        uploaded = None

        try:
            suffix = {
                "audio/webm": ".webm",
                "audio/ogg": ".ogg",
                "audio/mp4": ".m4a",
                "audio/mpeg": ".mp3",
                "audio/aac": ".aac",
            }.get(mime_type, ".bin")

            fd, tmp_path = tempfile.mkstemp(suffix=suffix, prefix="caspel-voice-")
            with os.fdopen(fd, "wb") as handle:
                handle.write(audio)

            uploaded = self._client.files.upload(file=tmp_path)

            result = self._client.models.generate_content(
                model=self.model_name,
                contents=[uploaded, _PROMPT],
                config=types.GenerateContentConfig(
                    temperature=0.0,
                    # A transcript longer than this is not a booth question.
                    max_output_tokens=512,
                ),
            )

            text = (getattr(result, "text", "") or "").strip()
            if not text:
                raise ProviderUnavailableError("Transcription returned nothing")

            return Transcript(text=text)

        except ProviderUnavailableError:
            raise
        except Exception as exc:
            # Type only. A provider exception can carry the prompt, the file URI
            # or fragments of the audio payload in its message.
            logger.error("Transcription failed: %s", type(exc).__name__)
            raise ProviderUnavailableError("Transcription provider failure") from exc
        finally:
            if uploaded is not None:
                try:
                    self._client.files.delete(name=uploaded.name)
                except Exception:
                    # Best effort. The provider expires uploads on its own, and
                    # failing to delete must not turn a good transcript into an
                    # error for the visitor.
                    logger.warning("Provider-side audio cleanup did not complete")
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except OSError:
                    logger.warning("Temporary audio cleanup did not complete")


transcription_service = TranscriptionService()
