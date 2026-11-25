import os
from pathlib import Path
import sys


def data_directory():
    if sys.platform == "linux":
        configured = Path(os.environ.get("XDG_DATA_HOME", ""))
        base = configured if configured.is_absolute() else Path.home() / ".local" / "share"
        return base / "gestalter"
    raise RuntimeError(f"Gestalter storage paths are unavailable on {sys.platform}")
