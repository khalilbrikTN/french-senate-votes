"""Data importers: load Sénat open data into the Supabase database.

Run from backend/:  python -m importers --help
Unlike the API in app/, these write to the database. Dry run is the default.
"""

import sys
from pathlib import Path

# `app.config` (settings) lives next to this package; make it importable even
# when python is started from another folder.
_BACKEND_DIR = str(Path(__file__).resolve().parents[1])
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)
