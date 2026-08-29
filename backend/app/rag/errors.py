"""
Typed failures for the CASPEL AI pipeline.

The assistant used to answer a provider outage with a polite sentence inside an
HTTP 200 — "CASPEL AI is temporarily experiencing connection issues". To every
consumer that is a successful answer: the browser rendered it as a reply, it was
stored as an assistant message, and it counted toward answered questions. An
outage has to be distinguishable from an answer, so it travels as an exception
and leaves the API as 503.

Note what is NOT an error here: retrieval finding nothing relevant. That is a
real, correct answer — "not in our official exhibition materials" — and it is
returned as a normal 200 with no sources.
"""


class RagError(RuntimeError):
    """Base class for anything that makes the assistant unable to answer."""


class EmbeddingError(RagError):
    """The embedding provider could not produce a usable vector."""


class RetrievalError(RagError):
    """The vector store could not be queried."""


class GenerationError(RagError):
    """The chat provider could not produce an answer."""


class ProviderUnavailableError(RagError):
    """No live provider is configured, so the assistant cannot run at all."""


__all__ = [
    "RagError",
    "EmbeddingError",
    "RetrievalError",
    "GenerationError",
    "ProviderUnavailableError",
]
