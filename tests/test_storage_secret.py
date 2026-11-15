import os
import unittest
from unittest.mock import patch

from app.main import main


class StorageSecretTests(unittest.TestCase):
    def test_missing_or_short_secret_prevents_startup(self):
        for secret in ("", "short", " " * 32):
            with self.subTest(secret=secret), patch.dict(
                os.environ, {"KINETIC_STORAGE_SECRET": secret}
            ), patch("app.main.ui.run_with") as run_with:
                with self.assertRaisesRegex(RuntimeError, "KINETIC_STORAGE_SECRET"):
                    main()
                run_with.assert_not_called()

        with patch.dict(os.environ, {}, clear=True), patch("app.main.ui.run_with") as run_with:
            with self.assertRaisesRegex(RuntimeError, "KINETIC_STORAGE_SECRET"):
                main()
            run_with.assert_not_called()

    def test_configured_secret_is_used(self):
        secret = "s" * 32
        with (
            patch.dict(os.environ, {"KINETIC_STORAGE_SECRET": secret}),
            patch("app.main.ui.run_with") as run_with,
            patch("uvicorn.run") as uvicorn_run,
        ):
            main()

        self.assertEqual(run_with.call_args.kwargs["storage_secret"], secret)
        uvicorn_run.assert_called_once()


if __name__ == "__main__":
    unittest.main()
