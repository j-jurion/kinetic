"""Account management and revocable browser sessions."""

import asyncio
import os
import smtplib
import ssl
import uuid
from collections.abc import AsyncGenerator
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from http.cookies import CookieError, SimpleCookie
from urllib.parse import urlparse

from fastapi import Depends, HTTPException, Request
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin, schemas
from fastapi_users.authentication import AuthenticationBackend, CookieTransport
from fastapi_users.authentication.strategy.db import DatabaseStrategy
from fastapi_users.db import SQLAlchemyBaseUserTableUUID, SQLAlchemyUserDatabase
from fastapi_users.exceptions import InvalidPasswordException
from fastapi_users_db_sqlalchemy.access_token import (
    SQLAlchemyAccessTokenDatabase,
    SQLAlchemyBaseAccessTokenTableUUID,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Session

from app.database import engine

COOKIE_NAME = "kinetic_auth"
SESSION_SECONDS = 12 * 60 * 60


class AuthBase(DeclarativeBase):
    pass


class User(SQLAlchemyBaseUserTableUUID, AuthBase):
    pass


class AccessToken(SQLAlchemyBaseAccessTokenTableUUID, AuthBase):
    pass


class UserRead(schemas.BaseUser[uuid.UUID]):
    pass


class UserCreate(schemas.BaseUserCreate):
    pass


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


def smtp_configured() -> bool:
    return all(
        os.environ.get(name)
        for name in ("KINETIC_SMTP_HOST", "KINETIC_SMTP_USER", "KINETIC_SMTP_PASSWORD",
                     "KINETIC_SMTP_FROM")
    )


def require_smtp() -> None:
    if not smtp_configured():
        raise HTTPException(status_code=503, detail="Email service is not configured")


def _send_email(recipient: str, subject: str, path: str, token: str) -> None:
    require_smtp()
    message = EmailMessage()
    message["From"] = os.environ["KINETIC_SMTP_FROM"]
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content(f"{subject}: {public_origin()}/{path}#{token}")
    with smtplib.SMTP(
        os.environ["KINETIC_SMTP_HOST"], int(os.environ.get("KINETIC_SMTP_PORT", "587")),
        timeout=15,
    ) as smtp:
        smtp.starttls(context=ssl.create_default_context())
        smtp.login(os.environ["KINETIC_SMTP_USER"], os.environ["KINETIC_SMTP_PASSWORD"])
        smtp.send_message(message)


async_engine = create_async_engine("sqlite+aiosqlite:///./app.db")
async_sessions = async_sessionmaker(async_engine, expire_on_commit=False)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_sessions() as session:
        yield session


async def get_user_db(session: AsyncSession = Depends(get_async_session)):
    yield SQLAlchemyUserDatabase(session, User)


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    def __init__(self, user_db: SQLAlchemyUserDatabase[User, uuid.UUID]):
        super().__init__(user_db)
        self.db_session = user_db.session
        secret = os.environ.get("KINETIC_STORAGE_SECRET", "")
        if len(secret.strip()) < 32:
            raise RuntimeError("KINETIC_STORAGE_SECRET must be at least 32 characters")
        self.reset_password_token_secret = secret
        self.verification_token_secret = secret

    async def validate_password(self, password: str, user):
        if not 12 <= len(password) <= 1024:
            raise InvalidPasswordException(reason="Password must be 12 to 1024 characters")

    async def on_after_register(self, user: User, request: Request | None = None):
        await self.request_verify(user, request)

    async def on_after_login(self, user: User, request: Request | None = None, response=None):
        if request is not None:
            previous = request.cookies.get(COOKIE_NAME)
            if previous:
                from sqlalchemy import delete

                await self.db_session.execute(
                    delete(AccessToken).where(AccessToken.__table__.c.token == previous)
                )
                await self.db_session.commit()

    async def on_after_request_verify(
        self, user: User, token: str, request: Request | None = None
    ):
        await asyncio.to_thread(
            _send_email, user.email, "Verify your Kinetic account", "verify", token
        )

    async def on_after_forgot_password(
        self, user: User, token: str, request: Request | None = None
    ):
        await asyncio.to_thread(
            _send_email, user.email, "Reset your Kinetic password", "reset", token
        )

    async def on_after_reset_password(self, user: User, request: Request | None = None):
        from sqlalchemy import delete

        await self.db_session.execute(
            delete(AccessToken).where(AccessToken.__table__.c.user_id == user.id)
        )
        await self.db_session.commit()


async def get_user_manager(user_db=Depends(get_user_db)):
    yield UserManager(user_db)


async def get_token_db(session: AsyncSession = Depends(get_async_session)):
    yield SQLAlchemyAccessTokenDatabase(session, AccessToken)


async def get_strategy(token_db=Depends(get_token_db)):
    return DatabaseStrategy(token_db, lifetime_seconds=SESSION_SECONDS)


cookie_transport = CookieTransport(
    cookie_name=COOKIE_NAME,
    cookie_max_age=SESSION_SECONDS,
    cookie_secure=os.environ.get("KINETIC_ALLOW_INSECURE_HTTP") != "1",
    cookie_httponly=True,
    cookie_samesite="strict",
)
backend = AuthenticationBackend(
    name="cookie", transport=cookie_transport, get_strategy=get_strategy
)
users = FastAPIUsers[User, uuid.UUID](get_user_manager, [backend])


def create_auth_tables() -> None:
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
            select(User, AccessToken)
            .join(AccessToken, AccessToken.__table__.c.user_id == User.__table__.c.id)
            .where(
                AccessToken.__table__.c.token == token,
                User.__table__.c.is_active.is_(True),
                User.__table__.c.is_verified.is_(True),
            )
        ).first()
        if not result:
            return None
        user, access_token = result
        created = access_token.created_at
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - created >= timedelta(seconds=SESSION_SECONDS):
            return None
        return str(user.id)
