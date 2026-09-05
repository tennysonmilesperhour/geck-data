"""Regression tests for the shared Supabase client configuration."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

from supabase.client import ClientOptions  # noqa: E402


class SupabaseClientOptionsTests(unittest.TestCase):
    def test_sync_options_include_storage_and_custom_schema(self) -> None:
        options = ClientOptions(schema="geck_data")

        self.assertEqual(options.schema, "geck_data")
        self.assertTrue(hasattr(options, "storage"))


if __name__ == "__main__":
    unittest.main()
