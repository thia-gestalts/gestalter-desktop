"""SQLite adapter for Olymp. The manifest and the app's queryable view commit together."""
import base64
from contextlib import contextmanager
import hashlib
import json

from store import READS, WRITES, Store, identity


class AccountStore(Store):
    def __init__(self, directory):
        super().__init__(directory)
        self.changes = None
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS manifest (id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, data BLOB NOT NULL);
        """)

    def state(self):
        row = self.db.execute("SELECT state FROM manifest WHERE id=1").fetchone()
        return json.loads(row[0]) if row else None

    def chunk(self, id):
        row = self.db.execute("SELECT data FROM chunks WHERE id=?", (id,)).fetchone()
        return base64.b64encode(row[0]).decode() if row else None

    def save_chunk(self, id, encoded):
        with self.transaction():
            self.db.execute("INSERT OR REPLACE INTO chunks VALUES (?,?)",
                            (id, base64.b64decode(encoded, validate=True)))

    @contextmanager
    def transaction(self):
        if self.changes is None:
            with super().transaction():
                yield
        else:
            yield  # The proposed editor change runs inside prepare's savepoint.

    def put(self, record):
        self.track(*identity(record))
        super().put(record)

    def delete(self, kind, id):
        self.track(kind, id)
        super().delete(kind, id)

    def track(self, kind, id):
        key = (kind, id)
        if self.changes is not None and key not in self.changes:
            self.changes[key] = self.get(*key)

    def prepare(self, method, args):
        """Run normal validation/edit logic, describe its writes, then roll back.
        The SDK encrypts/stages bytes and calls save exactly once to commit.
        """
        self.db.execute("SAVEPOINT proposal")
        self.changes = {}
        try:
            result = getattr(self, WRITES[method])(*args)
            changes = []
            for (kind, id), old in self.changes.items():
                value = self.get(kind, id)
                if old == value:
                    continue
                images = {}
                if kind == "note" and value:
                    previous = {r["id"] for r in (old or {}).get("attachments", [])}
                    for ref in value.get("attachments", []):
                        if ref["id"] not in previous:
                            row = self.db.execute("SELECT name,data FROM images WHERE id=?", (ref["id"],)).fetchone()
                            images[ref["id"]] = {"name": row[0], "data": base64.b64encode(row[1]).decode()}
                changes.append({"kind": kind, "id": id, "value": value, "images": images})
            return {"result": result, "changes": changes}
        finally:
            self.db.execute("ROLLBACK TO proposal")
            self.db.execute("RELEASE proposal")
            self.changes = None

    def save(self, state, rows):
        with self.transaction():
            cleanup = set()
            for kind, id, value, images in rows:
                previous = self.get(kind, id)
                if previous and kind == "note":
                    cleanup.update(r["id"] for r in previous.get("attachments", []))
                if value is None:
                    self.delete(kind, id)
                    continue
                for image in images:
                    data = base64.b64decode(image["data"], validate=True)
                    digest = hashlib.sha256(data).hexdigest()
                    stored = self.db.execute("SELECT digest FROM images WHERE id=?", (image["id"],)).fetchone()
                    if stored and stored[0] != digest:
                        raise ValueError("Conflicting content for an image ID.")
                    self.db.execute("INSERT OR IGNORE INTO images VALUES (?,?,?,?,?)",
                                    (image["id"], image["name"], image["mediaType"], digest, data))
                self.put(value)
            for ref in cleanup:
                self.delete_unused_image(ref)
            self.db.execute("INSERT OR REPLACE INTO manifest VALUES (1,?)", (json.dumps(state),))

    def call(self, method, args):
        api = {**READS, "prepare": "prepare", "state": "state", "chunk": "chunk",
               "saveChunk": "save_chunk", "save": "save"}
        return getattr(self, api[method])(*args)
