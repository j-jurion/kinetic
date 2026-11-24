"""In-memory sliding-window limits for the login and registration endpoints.

Limits are kept per process. Kinetic runs as a single API machine, so that is enough to stop
password guessing; with several machines each one would count on its own.
"""

import os
import threading
import time
from collections import deque
from typing import Optional

from fastapi import HTTPException, Request

WINDOW_SECONDS = 15 * 60
# Failed logins from one client address, across all usernames
FAILED_LOGINS_PER_IP = 20
# Failed logins for one username, from any address (slows down distributed guessing)
FAILED_LOGINS_PER_USERNAME = 10
REGISTER_WINDOW_SECONDS = 60 * 60
REGISTRATIONS_PER_IP = 10
TOO_MANY_ATTEMPTS = "Too many attempts. Try again later."
_MAX_KEYS = 50_000


class SlidingWindow:
    """Counts events per key over the last ``window`` seconds."""

    def __init__(self, limit: int, window: float):
        self.limit = limit
        self.window = window
        self._events: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def _recent(self, key: str, now: float) -> Optional[deque[float]]:
        events = self._events.get(key)
        if events is None:
            return None
        while events and events[0] <= now - self.window:
            events.popleft()
        if not events:
            del self._events[key]
            return None
        return events

    def retry_after(self, key: str, now: Optional[float] = None) -> int:
        """Seconds until ``key`` may try again; 0 when it is under the limit."""
        now = time.monotonic() if now is None else now
        with self._lock:
            events = self._recent(key, now)
            if events is None or len(events) < self.limit:
                return 0
            return max(1, int(events[0] + self.window - now) + 1)

    def hit(self, key: str, now: Optional[float] = None) -> None:
        now = time.monotonic() if now is None else now
        with self._lock:
            if len(self._events) >= _MAX_KEYS:
                self._prune(now)
            events = self._recent(key, now)
            if events is None:
                events = self._events[key] = deque()
            events.append(now)

    def reset(self, key: str) -> None:
        with self._lock:
            self._events.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._events.clear()

    def _prune(self, now: float) -> None:
        for key in list(self._events):
            self._recent(key, now)
        if len(self._events) >= _MAX_KEYS:
            # Still full of active keys: drop the oldest half rather than grow without bound
            oldest = sorted(self._events, key=lambda k: self._events[k][-1])
            for key in oldest[: len(oldest) // 2]:
                del self._events[key]


failed_logins_by_ip = SlidingWindow(FAILED_LOGINS_PER_IP, WINDOW_SECONDS)
failed_logins_by_username = SlidingWindow(FAILED_LOGINS_PER_USERNAME, WINDOW_SECONDS)
registrations_by_ip = SlidingWindow(REGISTRATIONS_PER_IP, REGISTER_WINDOW_SECONDS)


def client_ip(request: Request) -> str:
    """The address of the browser that sent the request.

    Behind the Vercel proxy (``KINETIC_ORIGIN_SECRET`` set, and already checked by the auth
    guard) every request comes from Vercel, which overwrites ``X-Real-IP`` and
    ``X-Forwarded-For`` with the real client address, so those can be trusted. Without the
    proxy they could be forged, and the connection's own address is used.
    """
    if os.environ.get("KINETIC_ORIGIN_SECRET"):
        real_ip = request.headers.get("x-real-ip", "").strip()
        if real_ip:
            return real_ip
        forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if forwarded:
            return forwarded
    return request.client.host if request.client else "unknown"


def _reject(retry_after: int) -> None:
    raise HTTPException(
        status_code=429, detail=TOO_MANY_ATTEMPTS, headers={"Retry-After": str(retry_after)}
    )


def check_login_allowed(ip: str, username: str) -> None:
    """Refuse before the password is checked, so blocked guesses also cost no hashing."""
    wait = max(
        failed_logins_by_ip.retry_after(ip),
        failed_logins_by_username.retry_after(username),
    )
    if wait:
        _reject(wait)


def record_failed_login(ip: str, username: str) -> None:
    failed_logins_by_ip.hit(ip)
    failed_logins_by_username.hit(username)


def record_successful_login(username: str) -> None:
    failed_logins_by_username.reset(username)


def check_registration_allowed(ip: str) -> None:
    wait = registrations_by_ip.retry_after(ip)
    if wait:
        _reject(wait)
    registrations_by_ip.hit(ip)


def reset_all() -> None:
    """Forget every counter (for tests)."""
    for limiter in (failed_logins_by_ip, failed_logins_by_username, registrations_by_ip):
        limiter.clear()
