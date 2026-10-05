from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from .settings import settings


@contextmanager
def connect():
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not configured")
    with psycopg.connect(
        settings.database_url, row_factory=dict_row, connect_timeout=5
    ) as conn:
        yield conn


def one(sql, params=()):
    with connect() as c:
        return c.execute(sql, params).fetchone()


def many(sql, params=()):
    with connect() as c:
        return c.execute(sql, params).fetchall()


def execute(sql, params=()):
    with connect() as c:
        c.execute(sql, params)


__all__ = ["Jsonb", "connect", "execute", "many", "one"]
