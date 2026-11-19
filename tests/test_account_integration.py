import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class AccountIntegrationTests(unittest.TestCase):
    def test_accounts_and_private_activities(self):
        root = Path(__file__).resolve().parent.parent
        env = os.environ.copy()
        env.update(
            {
                "PYTHONPATH": str(root),
                "KINETIC_PUBLIC_ORIGIN": "http://localhost:5173",
                "KINETIC_ALLOW_INSECURE_HTTP": "1",
            }
        )
        with tempfile.TemporaryDirectory() as workdir:
            result = subprocess.run(
                [sys.executable, str(root / "tests" / "account_scenario.py")],
                cwd=workdir,
                env=env,
                text=True,
                capture_output=True,
                timeout=60,
            )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
