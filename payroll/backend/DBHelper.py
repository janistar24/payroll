import os
from contextlib import contextmanager
import psycopg
from psycopg.conninfo import make_conninfo
try:
    from psycopg_pool import ConnectionPool
except ImportError:  # Keep local development available until optional pooling is installed.
    ConnectionPool = None
from dotenv import load_dotenv
from threading import Lock

load_dotenv()


class DBHelper:
    _pool = None
    _pool_lock = Lock()

    def __init__(self):
        self.host = os.getenv("POSTGRES_HOST")
        self.port = os.getenv("POSTGRES_PORT", "5432")
        self.user = os.getenv("POSTGRES_USER")
        self.password = os.getenv("POSTGRES_PASSWORD")
        self.db = os.getenv("POSTGRES_DB")

    def _get_pool(self):
        """Use a bounded shared pool; cursors remain request-local and thread-safe."""
        if ConnectionPool is None:
            return None
        if self.__class__._pool is None:
            with self.__class__._pool_lock:
                if self.__class__._pool is None:
                    conninfo = make_conninfo(
                        host=self.host, port=self.port, user=self.user,
                        password=self.password, dbname=self.db,
                    )
                    max_size = int(os.getenv("POSTGRES_POOL_MAX_SIZE", "10"))
                    min_size = min(int(os.getenv("POSTGRES_POOL_MIN_SIZE", "4")), max_size)
                    self.__class__._pool = ConnectionPool(
                        conninfo=conninfo,
                        min_size=max(1, min_size),
                        max_size=max_size,
                        timeout=int(os.getenv("POSTGRES_POOL_TIMEOUT_SECONDS", "10")),
                        # Hosted PostgreSQL may close idle sockets while the
                        # application is sleeping. Validate every checked-out
                        # connection so a dead socket is replaced before a
                        # user request reaches a cursor.
                        check=ConnectionPool.check_connection,
                        max_idle=float(os.getenv("POSTGRES_POOL_MAX_IDLE_SECONDS", "300")),
                        max_lifetime=float(os.getenv("POSTGRES_POOL_MAX_LIFETIME_SECONDS", "1800")),
                        reconnect_timeout=float(os.getenv("POSTGRES_POOL_RECONNECT_TIMEOUT_SECONDS", "30")),
                        kwargs={
                            "connect_timeout": int(os.getenv("POSTGRES_CONNECT_TIMEOUT_SECONDS", "5")),
                            "options": f"-c statement_timeout={int(os.getenv('POSTGRES_STATEMENT_TIMEOUT_MS', '15000'))}",
                        },
                    )
        return self.__class__._pool

    def warm_pool(self):
        """Establish the small reusable pool before the first employee logs in."""
        pool = self._get_pool()
        if pool is not None:
            pool.wait(timeout=int(os.getenv("POSTGRES_POOL_WARMUP_TIMEOUT_SECONDS", "10")))

    @classmethod
    def close_pool(cls):
        if cls._pool is not None:
            cls._pool.close()
            cls._pool = None

    @contextmanager
    def _connection(self):
        pool = self._get_pool()
        if pool is not None:
            with pool.connection() as connection:
                yield connection
            return

        connection = psycopg.connect(
            host=self.host, port=self.port, user=self.user,
            password=self.password, dbname=self.db,
            connect_timeout=int(os.getenv("POSTGRES_CONNECT_TIMEOUT_SECONDS", "5")),
            options=f"-c statement_timeout={int(os.getenv('POSTGRES_STATEMENT_TIMEOUT_MS', '15000'))}",
        )
        try:
            yield connection
        finally:
            connection.close()

    def fetch(self, sql, params=None):
        with self._connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(sql, params or ())
                data = cursor.fetchall()
                columns = tuple(desc.name for desc in cursor.description)
                return data, columns

    def fetch_many(self, statements):
        """Run independent read queries in one PostgreSQL pipeline round-trip.

        Hosted databases make network latency more expensive than these small
        reads.  This is intentionally read-only and falls back to the normal
        cursor behavior when a driver does not support pipelining.
        """
        with self._connection() as connection:
            try:
                with connection.pipeline():
                    cursors = [connection.execute(sql, params or ()) for sql, params in statements]
                return [(cursor.fetchall(), tuple(desc.name for desc in cursor.description)) for cursor in cursors]
            except (AttributeError, NotImplementedError, psycopg.NotSupportedError):
                with connection.cursor() as cursor:
                    results = []
                    for sql, params in statements:
                        cursor.execute(sql, params or ())
                        results.append((cursor.fetchall(), tuple(desc.name for desc in cursor.description)))
                    return results

    def execute(self, sql, params=None):
        with self._connection() as connection:
            with connection.cursor() as cursor:
                cursor.execute(sql, params or ())
                connection.commit()

    @contextmanager
    def transaction(self):
        with self._connection() as connection:
            with connection.cursor() as cursor:
                try:
                    yield cursor
                    connection.commit()
                except Exception:
                    connection.rollback()
                    raise
