import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class AccountIntegrationTests(unittest.TestCase):
    def test_accounts_and_private_activities(self):
        self._run_scenario("account_scenario.py")

    def test_friend_requests(self):
        self._run_scenario("friends_scenario.py")

    def test_activities_done_together(self):
        self._run_scenario("together_scenario.py")

    def test_account_deletion(self):
        self._run_scenario("account_deletion_scenario.py")

    def test_route_shapes_streams_cache_and_paging(self):
        self._run_scenario("performance_scenario.py")

    def test_deleting_activities_removes_unused_files(self):
        self._run_scenario("file_cleanup_scenario.py")

    def _run_scenario(self, script: str):
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
                [sys.executable, str(root / "tests" / script)],
                cwd=workdir,
                env=env,
                text=True,
                capture_output=True,
                timeout=60,
            )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
