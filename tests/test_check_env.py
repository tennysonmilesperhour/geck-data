"""Tests that the preflight accepts only the consolidated project."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import check_env  # noqa: E402


class SupabaseProjectGuardTests(unittest.TestCase):
    def _check(self, url: str) -> int:
        with (
            patch.object(check_env, "get_supabase_url", return_value=url),
            patch.dict(os.environ, {"SUPABASE_SERVICE_KEY": "sb_secret_test"}),
        ):
            return check_env.check_supabase()

    def test_accepts_consolidated_geck_inspect(self) -> None:
        self.assertEqual(
            self._check("https://mmuglfphhwlaluyfyxsp.supabase.co"),
            0,
        )

    def test_rejects_retired_geck_data(self) -> None:
        self.assertEqual(
            self._check("https://dhotmtgryuovkmsncdby.supabase.co"),
            1,
        )


if __name__ == "__main__":
    unittest.main()
