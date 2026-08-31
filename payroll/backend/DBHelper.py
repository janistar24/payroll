import os
from contextlib import contextmanager
import psycopg
from dotenv import load_dotenv

load_dotenv()


class DBHelper:

    def __init__(self):
        self.host = os.getenv("POSTGRES_HOST")
        self.port = os.getenv("POSTGRES_PORT", "5432")
        self.user = os.getenv("POSTGRES_USER")
        self.password = os.getenv("POSTGRES_PASSWORD")
        self.db = os.getenv("POSTGRES_DB")

    def __connect__(self):
        self.con = psycopg.connect(
            host=self.host,
            port=self.port,
            user=self.user,
            password=self.password,
            dbname=self.db
        )
        self.cur = self.con.cursor()

    def __disconnect__(self):
        self.cur.close()
        self.con.close()

    def fetch(self, sql, params=None):
        self.__connect__()
        try:
            self.cur.execute(sql, params or ())
            data = self.cur.fetchall()
            columns = tuple(desc.name for desc in self.cur.description)
            return data, columns
        finally:
            self.__disconnect__()

    def execute(self, sql, params=None):
        self.__connect__()
        try:
            self.cur.execute(sql, params or ())
            self.con.commit()
        except Exception:
            self.con.rollback()
            raise
        finally:
            self.__disconnect__()

    @contextmanager
    def transaction(self):
        self.__connect__()
        try:
            yield self.cur
            self.con.commit()
        except Exception:
            self.con.rollback()
            raise
        finally:
            self.__disconnect__()
