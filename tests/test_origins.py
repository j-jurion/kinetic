import os
import unittest
from unittest.mock import patch

from app.auth import allowed_origin, preview_origin_patterns

PUBLIC = "https://kinetic.vercel.app"


def env(previews: str = ""):
    return patch.dict(
        os.environ, {"KINETIC_PUBLIC_ORIGIN": PUBLIC, "KINETIC_PREVIEW_ORIGINS": previews}
    )


class OriginTests(unittest.TestCase):
    def test_only_the_public_origin_without_previews(self):
        with env():
            self.assertTrue(allowed_origin(PUBLIC))
            self.assertFalse(allowed_origin("https://kinetic-git-main-team.vercel.app"))
            self.assertFalse(allowed_origin(""))

    def test_preview_deployments_of_the_project(self):
        with env("https://kinetic-*-jj1-0863.vercel.app"):
            for origin in (
                PUBLIC,
                "https://kinetic-git-ccr-feb04047-cleanup-jj1-0863.vercel.app",
                "https://kinetic-4fz8x2kq1-jj1-0863.vercel.app",
            ):
                self.assertTrue(allowed_origin(origin), origin)
            for origin in (
                "https://kinetic--jj1-0863.vercel.app",  # the * matches at least one character
                "https://kinetic-a.evil.com-jj1-0863.vercel.app",  # not across a dot
                "https://kinetic-a-jj1-0863.vercel.app.evil.com",
                "https://evil-kinetic-a-jj1-0863.vercel.app",
                "http://kinetic-a-jj1-0863.vercel.app",
                "https://kinetic-a-jj1-0863.vercel.app:8443",
            ):
                self.assertFalse(allowed_origin(origin), origin)

    def test_several_patterns(self):
        with env("https://a-*.example.com, https://b-*.example.org/"):
            self.assertTrue(allowed_origin("https://a-1.example.com"))
            self.assertTrue(allowed_origin("https://b-2.example.org"))

    def test_too_broad_or_malformed_patterns_are_refused(self):
        for value in (
            "http://kinetic-*.vercel.app",  # not https
            "https://*.vercel.app",  # the whole first label
            "https://kinetic-*.app",  # a bare top-level domain
            "https://kinetic.*.vercel.app",  # not in the first label
            "https://kinetic-*-*.vercel.app",  # more than one *
            "https://kinetic.vercel.app",  # no * at all: use KINETIC_PUBLIC_ORIGIN
            "https://kinetic-*.vercel.app/path",
        ):
            with env(value), self.subTest(value=value):
                with self.assertRaises(RuntimeError):
                    preview_origin_patterns()


if __name__ == "__main__":
    unittest.main()
