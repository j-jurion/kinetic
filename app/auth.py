"""Username/password accounts and revocable browser sessions."""

import hashlib
import os
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from http.cookies import CookieError, SimpleCookie
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException, Request, Response
from loguru import logger
from pwdlib import PasswordHash
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, DateTime, ForeignKey, String, delete, inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

from app import rate_limit
from app.database import engine

COOKIE_NAME = "kinetic_auth"
SESSION_SECONDS = 12 * 60 * 60
USERNAME_PATTERN = re.compile(r"[a-z0-9][a-z0-9_.-]{2,31}")
USERNAME_RULES = "Username must be 3 to 32 characters: letters, digits, '.', '_' or '-'"
PASSWORD_RULES = "Password must be 12 to 1024 characters"
INVALID_LOGIN = "Invalid username or password"

password_hash = PasswordHash.recommended()
# Verified against unknown usernames so failed logins take similar time either way.
_DUMMY_HASH = password_hash.hash(secrets.token_urlsafe(16))


class AuthBase(DeclarativeBase):
    pass


class User(AuthBase):
    __tablename__ = "user"

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(1024))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class AccessToken(AuthBase):
    __tablename__ = "accesstoken"

    token: Mapped[str] = mapped_column(String(43), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("user.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime, index=True, default=lambda: datetime.now(timezone.utc)
    )


class IntegrationToken(AuthBase):
    """A long-lived token that lets an outside app (Health Auto Export) post to one account.

    Only a SHA-256 hash is stored; the token itself is shown once, when it is created.
    """

    __tablename__ = "integrationtoken"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("user.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Credentials(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=1024)


def public_origin() -> str:
    origin = os.environ.get("KINETIC_PUBLIC_ORIGIN", "")
    parsed = urlparse(origin)
    local_http = parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1")
    insecure_allowed = os.environ.get("KINETIC_ALLOW_INSECURE_HTTP") == "1"
    if (
        not origin
        or parsed.path not in ("", "/")
        or parsed.params
        or parsed.query
        or parsed.fragment
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or (parsed.scheme != "https" and not (insecure_allowed and local_http))
        or (insecure_allowed and not local_http)
    ):
        raise RuntimeError("Set KINETIC_PUBLIC_ORIGIN to the app's HTTPS origin")
    return origin.rstrip("/")


PREVIEW_ORIGINS_RULE = (
    "KINETIC_PREVIEW_ORIGINS takes comma-separated https origins with one '*' in the first "
    "part of the host name, e.g. https://kinetic-git-*-team.vercel.app"
)


def preview_origin_patterns() -> list[re.Pattern]:
    """Extra origins allowed to make requests: the preview deployments of the web app.

    ``KINETIC_PREVIEW_ORIGINS`` (optional) lists them as https origins whose first host label
    holds one ``*``, matching letters, digits and hyphens only, so a pattern cannot reach
    beyond its own domain. Unset, only ``KINETIC_PUBLIC_ORIGIN`` is allowed.

    An entry that breaks these rules is ignored with a warning in the log, never an error:
    a mistake in this optional setting must not take the API down.
    """
    return _parse_preview_origins(os.environ.get("KINETIC_PREVIEW_ORIGINS", ""))


@lru_cache(maxsize=8)
def _parse_preview_origins(setting: str) -> list[re.Pattern]:
    patterns = []
    for raw in setting.split(","):
        # Forgive quotes, spaces, upper case and a trailing slash pasted along with the origin
        value = raw.strip().strip("\"'").strip().lower().rstrip("/")
        if not value:
            continue
        pattern = _preview_pattern(value)
        if pattern is None:
            logger.warning(
                "Ignoring KINETIC_PREVIEW_ORIGINS entry {!r}: {}", value, PREVIEW_ORIGINS_RULE
            )
        else:
            patterns.append(pattern)
    return patterns


def _preview_pattern(value: str) -> re.Pattern | None:
    scheme, _, host = value.partition("://")
    first, _, rest = host.partition(".")
    if (
        scheme != "https"
        or host.count("*") != 1
        or "*" not in first
        or first == "*"  # would match every site on the domain
        or rest.count(".") < 1
        or not re.fullmatch(r"[a-z0-9*-]+", first)
        or not re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", rest)
    ):
        return None
    label = re.escape(first).replace(r"\*", "[a-z0-9-]+")
    return re.compile(f"https://{label}\\.{re.escape(rest)}")


def allowed_origin(origin: str) -> bool:
    """Whether a request's Origin is the web app: the public origin or one of its previews."""
    if origin == public_origin():
        return True
    return any(pattern.fullmatch(origin) for pattern in preview_origin_patterns())


def normalize_username(username: str) -> str:
    return username.strip().lower()


def validate_password(password: str) -> None:
    if not 12 <= len(password) <= 1024:
        raise ValueError(PASSWORD_RULES)


def _secure_cookies() -> bool:
    return os.environ.get("KINETIC_ALLOW_INSECURE_HTTP") != "1"


def _start_session(session: Session, user_id: str, request: Request, response: Response) -> None:
    previous = request.cookies.get(COOKIE_NAME)
    if previous:
        session.execute(delete(AccessToken).where(AccessToken.token == previous))
    token = secrets.token_urlsafe(32)
    session.add(AccessToken(token=token, user_id=user_id))
    session.commit()
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=_secure_cookies(),
        samesite="strict",
    )


router = APIRouter(prefix="/api/auth")


@router.post("/register", status_code=201)
def register(credentials: Credentials, request: Request, response: Response):
    rate_limit.check_registration_allowed(rate_limit.client_ip(request))
    username = normalize_username(credentials.username)
    if not USERNAME_PATTERN.fullmatch(username):
        raise HTTPException(status_code=400, detail=USERNAME_RULES)
    try:
        validate_password(credentials.password)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from None
    with Session(engine) as session:
        user = User(username=username, hashed_password=password_hash.hash(credentials.password))
        session.add(user)
        try:
            session.commit()
        except IntegrityError:
            raise HTTPException(status_code=400, detail="Username is already taken") from None
        _start_session(session, user.id, request, response)
    return {"username": username}


@router.post("/login", status_code=204)
def login(credentials: Credentials, request: Request, response: Response) -> None:
    username = normalize_username(credentials.username)
    ip = rate_limit.client_ip(request)
    rate_limit.check_login_allowed(ip, username)
    with Session(engine) as session:
        user = session.scalar(select(User).where(User.username == username))
        if user is None:
            password_hash.verify(credentials.password, _DUMMY_HASH)
            rate_limit.record_failed_login(ip, username)
            raise HTTPException(status_code=400, detail=INVALID_LOGIN)
        valid, updated_hash = password_hash.verify_and_update(
            credentials.password, user.hashed_password
        )
        if not valid or not user.is_active:
            rate_limit.record_failed_login(ip, username)
            raise HTTPException(status_code=400, detail=INVALID_LOGIN)
        rate_limit.record_successful_login(username)
        if updated_hash:
            user.hashed_password = updated_hash
        _start_session(session, user.id, request, response)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response) -> None:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        with Session(engine) as session:
            session.execute(delete(AccessToken).where(AccessToken.token == token))
            session.commit()
    response.delete_cookie(
        COOKIE_NAME, httponly=True, secure=_secure_cookies(), samesite="strict"
    )


@router.get("/me")
def me(request: Request) -> dict:
    owner_id = request.scope.get("state", {}).get("owner_id")
    if owner_id is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    with Session(engine) as session:
        user = session.get(User, owner_id)
        if user is None:
            raise HTTPException(status_code=401, detail="Authentication required")
        return {"username": user.username}


def reset_password(username: str) -> str:
    """Set a generated password for an account, revoke its sessions and return the password."""
    password = secrets.token_urlsafe(18)
    with Session(engine) as session:
        user = session.scalar(select(User).where(User.username == normalize_username(username)))
        if user is None:
            raise LookupError(f"No account named {username!r}")
        user.hashed_password = password_hash.hash(password)
        session.execute(delete(AccessToken).where(AccessToken.user_id == user.id))
        session.commit()
    return password


def _username_from_email(email: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9_.-]", "", email.split("@")[0].lower())
    base = re.sub(r"^[^a-z0-9]+", "", base)[:28]
    if len(base) < 3:
        base = "user"
    candidate, suffix = base, 2
    while candidate in taken:
        candidate, suffix = f"{base}-{suffix}", suffix + 1
    taken.add(candidate)
    return candidate


def _migrate_email_accounts(connection) -> None:
    """Convert accounts from the former email-based schema to usernames."""
    rows = connection.execute(
        text('SELECT id, email, hashed_password, is_active FROM "user" ORDER BY email')
    ).all()
    taken: set[str] = set()
    connection.execute(
        text(
            "CREATE TABLE user_new (id CHAR(36) NOT NULL PRIMARY KEY, "
            "username VARCHAR(32) NOT NULL, hashed_password VARCHAR(1024) NOT NULL, "
            "is_active BOOLEAN NOT NULL)"
        )
    )
    for row in rows:
        connection.execute(
            text("INSERT INTO user_new VALUES (:id, :username, :hashed_password, :is_active)"),
            {
                "id": row.id,
                "username": _username_from_email(row.email, taken),
                "hashed_password": row.hashed_password,
                "is_active": row.is_active,
            },
        )
    connection.execute(text('DROP TABLE "user"'))
    connection.execute(text('ALTER TABLE user_new RENAME TO "user"'))
    connection.execute(text('CREATE UNIQUE INDEX ix_user_username ON "user" (username)'))


def create_auth_tables() -> None:
    with engine.begin() as connection:
        inspector = inspect(connection)
        if inspector.has_table("user") and "username" not in {
            column["name"] for column in inspector.get_columns("user")
        }:
            _migrate_email_accounts(connection)
    AuthBase.metadata.create_all(engine)


def authenticated_owner(scope) -> str | None:
    cookie_header = next(
        (value.decode("latin-1") for name, value in scope.get("headers", []) if name == b"cookie"),
        "",
    )
    cookie = SimpleCookie()
    try:
        cookie.load(cookie_header)
    except CookieError:
        return None
    if COOKIE_NAME not in cookie:
        return None
    token = cookie[COOKIE_NAME].value
    with Session(engine) as session:
        result = session.execute(
            select(User.id, AccessToken.created_at)
            .join(AccessToken, AccessToken.user_id == User.id)
            .where(AccessToken.token == token, User.is_active.is_(True))
        ).first()
        if not result:
            return None
        user_id, created = result
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - created >= timedelta(seconds=SESSION_SECONDS):
            return None
        return user_id


# ── Integration tokens ────────────────────────────────────────────────────────

APPLE_HEALTH = "apple_health"
_BEARER = "bearer "


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_integration_token(user_id: str, kind: str) -> str:
    """Replace the account's token of this kind with a new one and return it."""
    token = secrets.token_urlsafe(32)
    with Session(engine) as session:
        session.execute(
            delete(IntegrationToken).where(
                IntegrationToken.user_id == user_id, IntegrationToken.kind == kind
            )
        )
        session.add(IntegrationToken(token_hash=_hash_token(token), user_id=user_id, kind=kind))
        session.commit()
    return token


def revoke_integration_token(user_id: str, kind: str) -> None:
    with Session(engine) as session:
        session.execute(
            delete(IntegrationToken).where(
                IntegrationToken.user_id == user_id, IntegrationToken.kind == kind
            )
        )
        session.commit()


def integration_token_info(user_id: str, kind: str) -> dict | None:
    with Session(engine) as session:
        row = session.scalar(
            select(IntegrationToken).where(
                IntegrationToken.user_id == user_id, IntegrationToken.kind == kind
            )
        )
        if row is None:
            return None
        return {"created_at": row.created_at, "last_used_at": row.last_used_at}


def integration_owner(scope, kind: str) -> str | None:
    """The account a request's ``Authorization: Bearer <token>`` header belongs to."""
    header = next(
        (
            value.decode("latin-1")
            for name, value in scope.get("headers", [])
            if name == b"authorization"
        ),
        "",
    )
    if not header.lower().startswith(_BEARER):
        return None
    token = header[len(_BEARER):].strip()
    if not token or len(token) > 128:
        return None
    with Session(engine) as session:
        row = session.execute(
            select(IntegrationToken, User.is_active)
            .join(User, User.id == IntegrationToken.user_id)
            .where(IntegrationToken.token_hash == _hash_token(token))
        ).first()
        if row is None or row[0].kind != kind or not row[1]:
            return None
        row[0].last_used_at = datetime.now(timezone.utc)
        session.commit()
        return row[0].user_id
