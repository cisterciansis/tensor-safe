"""Runnable SQLite constraint/CAS check; isolated in-memory database."""
import sqlite3
from pathlib import Path
sql = Path(__file__).parents[1].joinpath('db/migrations/0001_initial.sql').read_text()
db = sqlite3.connect(':memory:')
db.executescript(sql)
db.execute("INSERT INTO workspaces VALUES ('w','u','Test',0,'{}','initial')")
assert db.execute("UPDATE workspaces SET version=1,mutation='a' WHERE id='w' AND version=0").rowcount == 1
assert db.execute("UPDATE workspaces SET version=1,mutation='b' WHERE id='w' AND version=0").rowcount == 0
db.execute("INSERT INTO audit SELECT 'b','w','u','edit',1,'now','{}' WHERE EXISTS(SELECT 1 FROM workspaces WHERE id='w' AND mutation='b')")
assert db.execute('SELECT COUNT(*) FROM audit').fetchone()[0] == 0
db.execute("INSERT INTO settlements VALUES ('chain:block:1','w','p1')")
try:
    db.execute("INSERT INTO settlements VALUES ('chain:block:1','w','p2')")
except sqlite3.IntegrityError:
    pass
else:
    raise AssertionError('Settlement evidence must be unique')
print('PASS database CAS guards and settlement evidence uniqueness')
