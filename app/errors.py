"""Errors whose message may be shown to the user, and a helper for everything else.

Messages of unexpected exceptions (parsers, database, HTTP clients) can reveal file paths,
SQL, library internals or upstream responses, so they are logged and replaced by a generic
message. Raise a ``UserError`` (or a subclass) when the message is written for the user.
"""

from loguru import logger


class UserError(ValueError):
    """An error whose message is safe and meant to be shown to the user."""


def public_message(exc: BaseException, fallback: str, context: str = "") -> str:
    """The exception's message when it is a ``UserError``; otherwise log it and use ``fallback``."""
    if isinstance(exc, UserError):
        return str(exc)
    logger.opt(exception=exc).warning("{}: {}", context or fallback, type(exc).__name__)
    return fallback
