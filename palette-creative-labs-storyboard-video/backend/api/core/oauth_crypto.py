"""Encrypts/decrypts per-user OAuth tokens before they touch the database.

Plaintext access/refresh tokens are never persisted or logged — every write
to UserOAuthConnection goes through `encrypt_token`, every read through
`decrypt_token`. The symmetric key (`OAUTH_TOKEN_ENCRYPTION_KEY`, a Fernet
key) is an app-level secret, read the same way as FAL_KEY/OPENAI_KEY.
"""

from __future__ import annotations

from typing import Any

from cryptography.fernet import Fernet, InvalidToken

from backend.api.core.secrets import read_secret


def _fernet(ctx: Any) -> Fernet:
    key = read_secret(ctx, "OAUTH_TOKEN_ENCRYPTION_KEY")
    if not key:
        raise RuntimeError(
            "OAUTH_TOKEN_ENCRYPTION_KEY is not configured — cannot store OAuth tokens securely."
        )
    return Fernet(key.encode())


def encrypt_token(ctx: Any, plaintext: str) -> str:
    return _fernet(ctx).encrypt(plaintext.encode()).decode()


def decrypt_token(ctx: Any, ciphertext: str) -> str:
    try:
        return _fernet(ctx).decrypt(ciphertext.encode()).decode()
    except InvalidToken as e:
        raise RuntimeError("Stored OAuth token could not be decrypted (key rotated or corrupted).") from e
