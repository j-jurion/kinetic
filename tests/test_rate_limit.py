import os
import unittest
from unittest.mock import patch

from starlette.requests import Request

from app import rate_limit
from app.rate_limit import SlidingWindow


def request(headers=None, client=("203.0.113.9", 1234)):
    raw = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    return Request({"type": "http", "headers": raw, "client": client})


class SlidingWindowTests(unittest.TestCase):
    def test_limit_and_expiry(self):
        window = SlidingWindow(limit=3, window=60)
        for t in (0, 10, 20):
            self.assertEqual(window.retry_after("k", now=t), 0)
            window.hit("k", now=t)
        # The oldest hit (t=0) expires at t=60
        self.assertEqual(window.retry_after("k", now=30), 31)
        self.assertEqual(window.retry_after("other", now=30), 0)
        self.assertEqual(window.retry_after("k", now=60), 0)

    def test_reset(self):
        window = SlidingWindow(limit=1, window=60)
        window.hit("k", now=0)
        self.assertGreater(window.retry_after("k", now=1), 0)
        window.reset("k")
        self.assertEqual(window.retry_after("k", now=1), 0)

    def test_memory_is_bounded(self):
        window = SlidingWindow(limit=5, window=60)
        with patch.object(rate_limit, "_MAX_KEYS", 100):
            for i in range(1000):
                window.hit(str(i), now=i)
        self.assertLessEqual(len(window._events), 100)


class ClientIpTests(unittest.TestCase):
    def test_forwarded_headers_are_ignored_without_the_proxy(self):
        with patch.dict(os.environ, {"KINETIC_ORIGIN_SECRET": ""}):
            forged = request({"X-Forwarded-For": "1.2.3.4", "X-Real-IP": "1.2.3.4"})
            self.assertEqual(rate_limit.client_ip(forged), "203.0.113.9")

    def test_proxy_headers_are_used_behind_the_proxy(self):
        with patch.dict(os.environ, {"KINETIC_ORIGIN_SECRET": "s3cret"}):
            self.assertEqual(rate_limit.client_ip(request({"X-Real-IP": "198.51.100.7"})),
                             "198.51.100.7")
            self.assertEqual(
                rate_limit.client_ip(request({"X-Forwarded-For": "198.51.100.7, 10.0.0.1"})),
                "198.51.100.7",
            )
            self.assertEqual(rate_limit.client_ip(request()), "203.0.113.9")


if __name__ == "__main__":
    unittest.main()
