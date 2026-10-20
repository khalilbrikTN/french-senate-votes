"""Settings read from environment variables, then backend/.env.local."""

from dataclasses import dataclass
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_DIR.parent
ENV_FILE = BACKEND_DIR / ".env.local"


def _read_env_file(path):
    values = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


@dataclass(frozen=True)
class Settings:
    database_url: str
    host: str
    port: int
    cors_origins: tuple
    db_pool_max_size: int


def load_settings():
    file_values = _read_env_file(ENV_FILE)

    def get(key, default=None):
        return os.environ.get(key) or file_values.get(key) or default

    database_url = get("DATABASE_URL")
    if not database_url:
        raise RuntimeError(f"Set DATABASE_URL in the environment or in {ENV_FILE}")
    return Settings(
        database_url=database_url,
        host=get("API_HOST", "127.0.0.1"),
        port=int(get("API_PORT", "8000")),
        cors_origins=tuple(o.strip() for o in get("CORS_ORIGINS", "*").split(",") if o.strip()),
        db_pool_max_size=int(get("DB_POOL_MAX_SIZE", "4")),
    )
