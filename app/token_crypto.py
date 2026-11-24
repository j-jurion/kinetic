"""Encryption of the Garmin tokens and email kept on disk for each account.

The key comes from ``KINETIC_GARMIN_TOKEN_KEY``: one or more comma-separated Fernet keys
(generate one with ``python -m app.token_crypto``). The first key encrypts; every key can
decrypt, so a key can be rotated by putting the new key first and keeping the old one until
the tokens have been rewritten (each sync rewrites them).

For local development only (``KINETIC_ALLOW_INSECURE_HTTP=1``), a key is generated in the
token folder when none is configured. That key sits next to the tokens, so it does not
protect them; production must set the environment variable.
"""

import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.errors import UserError

KEY_ENV = "KINETIC_GARMIN_TOKEN_KEY"
DEV_KEY_FILE = ".dev-token-key"


class TokenKeyError(UserError):
    """No usable encryption key is configured."""


def warn_if_unconfigured() -> None:
    """Log at startup when production has no key, since Garmin sync will refuse to work."""
    if not os.environ.get(KEY_ENV) and os.environ.get("KINETIC_ALLOW_INSECURE_HTTP") != "1":
        from loguru import logger

        logger.warning("{} is not set: Garmin sync is disabled until it is", KEY_ENV)


def _dev_key(root: Path) -> bytes:
    path = root / DEV_KEY_FILE
    if not path.exists():
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(Fernet.generate_key())
    return path.read_bytes().strip()


def cipher(root: Path) -> MultiFernet:
    """The cipher for files under ``root`` (the token folder)."""
    keys = [k.strip() for k in os.environ.get(KEY_ENV, "").split(",") if k.strip()]
    if not keys:
        if os.environ.get("KINETIC_ALLOW_INSECURE_HTTP") != "1":
            raise TokenKeyError(
                "Garmin sync is not configured on this server (missing token encryption key)"
            )
        keys = [_dev_key(root).decode()]
    try:
        return MultiFernet([Fernet(k.encode()) for k in keys])
    except ValueError:
        raise TokenKeyError(
            "Garmin sync is not configured on this server (invalid token encryption key)"
        ) from None


def write_encrypted(path: Path, root: Path, data: str) -> None:
    """Encrypt ``data`` into ``path`` atomically, readable only by this user."""
    token = cipher(root).encrypt(data.encode("utf-8"))
    temporary = path.with_name(path.name + ".tmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(token)
    os.replace(temporary, path)


def read_encrypted(path: Path, root: Path) -> str | None:
    """The decrypted contents of ``path``; None when it is missing or cannot be decrypted."""
    if not path.exists():
        return None
    try:
        return cipher(root).decrypt(path.read_bytes()).decode("utf-8")
    except InvalidToken:
        return None


if __name__ == "__main__":
    print(Fernet.generate_key().decode())
