"""Read-only PostgreSQL connection pool."""

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

_pool = None


def _make_read_only(connection):
    # The Supabase session pooler does not forward the `options` startup parameter,
    # so set the session read-only explicitly once the connection is open.
    connection.execute("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY")


def open_pool(settings):
    global _pool
    # Every session is read-only: this API never writes to the database.
    # Autocommit: each statement runs in its own (read-only) transaction, which saves
    # the BEGIN and COMMIT round trips (~45 ms each to Supabase) on every request.
    _pool = ConnectionPool(
        settings.database_url,
        min_size=1,
        max_size=settings.db_pool_max_size,
        kwargs={
            "sslmode": "require",
            "row_factory": dict_row,
            "autocommit": True,
            "options": "-c default_transaction_read_only=on",
        },
        configure=_make_read_only,
        open=True,
    )
    return _pool


def close_pool():
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def database_is_reachable(timeout=5):
    try:
        with _pool.connection(timeout=timeout) as connection:
            connection.execute("SELECT 1")
        return True
    except Exception:
        return False


def connection(timeout=None):
    """Context manager for a pooled connection, for code outside FastAPI dependencies."""
    return _pool.connection(timeout=timeout)


def get_connection():
    """FastAPI dependency yielding a pooled connection."""
    with _pool.connection() as connection:
        yield connection
