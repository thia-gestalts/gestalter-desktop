from contextlib import contextmanager
import base64
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import time
from uuid import UUID, uuid4

import academic
import bibtex
from inbox import INBOX
from outline import BRANCHES, EXCLUDE, FOLLOWS, ROOT, is_place, outline

MAX_IMAGE_BYTES = 12 * 1024 * 1024
MAX_IMPORT_BYTES = 16 * 1024 * 1024

READS = {
    "listNotes": "list_notes", "linkTargets": "link_targets", "getNote": "note", "getImage": "image",
    "recentPractice": "recent_practice", "learningHistory": "learning_history", "zettelkasten": "zettelkasten",
    "listInbox": "list_inbox", "getInboxItem": "inbox_item",
    "sourceLibrary": "source_library", "previewBibtex": "preview_bibtex",
    "sourceLinks": "source_links", "sourceDetails": "source_details", "exportBibtex": "export_bibtex",
}
WRITES = {
    "saveNote": "edit_note", "deleteNote": "delete_note", "link": "link",
    "attachImage": "attach_image", "detachImage": "detach_image", "importPractice": "import_practice",
    "placeNote": "place_note", "importInbox": "import_inbox", "deferInbox": "defer_inbox",
    "removeInbox": "remove_inbox", "restoreRecord": "restore_record",
    "importSources": "import_sources", "saveSource": "save_source", "deleteSource": "delete_source", "editSourceLinks": "edit_source_links",
    "reconcileSource": "reconcile_source", "addAnnotation": "add_annotation",
}

PRACTICE = """
WITH ranked AS (
    SELECT e.id AS eventId, ref.value ->> '$.kind' AS kind,
           ref.value ->> '$.id' AS id, e.body ->> '$.occurredAtMs' AS occurredAtMs,
           ROW_NUMBER() OVER (
               PARTITION BY ref.value ->> '$.kind', ref.value ->> '$.id'
               ORDER BY e.body ->> '$.occurredAtMs' DESC, e.id DESC
           ) AS rank
    FROM records e, json_each(e.body, '$.targets') ref
    WHERE e.kind = 'learning-event' AND e.body ->> '$.type' = 'attempt'
      AND ref.type = 'object'
      AND ref.value ->> '$.kind' IN ('fact', 'skill')
)
SELECT ranked.kind, ranked.id, eventId, occurredAtMs,
       COALESCE(CASE ranked.kind WHEN 'fact' THEN t.body ->> '$.statement'
                                 WHEN 'skill' THEN t.body ->> '$.name' END, ranked.id) AS label
FROM ranked
LEFT JOIN records t ON t.kind = ranked.kind AND t.id = ranked.id
WHERE rank = 1
ORDER BY occurredAtMs DESC, ranked.kind, ranked.id
LIMIT 100
"""


def headline(note):
    raw_title = note.get("title")
    title = raw_title.strip() if isinstance(raw_title, str) else ""
    if title:
        return title
    text = note.get("text")
    first = next((line.strip() for line in text.splitlines() if line.strip()), "") if isinstance(text, str) else ""
    return re.sub(r"^(#{1,6}\s+|>\s*|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)", "", first)


def media_type(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    raise ValueError("Choose a PNG, JPEG, GIF, or WebP image.")


def identity(record):
    if not isinstance(record, dict):
        raise ValueError("Expected a record object.")
    kind, key = record.get("kind"), record.get("id")
    if not isinstance(kind, str) or not kind or not isinstance(key, str) or not key:
        raise ValueError("Every record needs a kind and ID.")
    return kind, key


class Store:
    def __init__(self, directory):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(directory / "learner.sqlite3")
        self.db.row_factory = sqlite3.Row
        self.db.create_function("casefold", 1, str.casefold, deterministic=True)
        self.db.executescript("""
            PRAGMA journal_mode = WAL;
            CREATE TABLE IF NOT EXISTS records (
                kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL,
                PRIMARY KEY (kind, id)
            );
            CREATE TABLE IF NOT EXISTS images (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, media_type TEXT NOT NULL,
                digest TEXT NOT NULL, data BLOB NOT NULL
            );
            CREATE INDEX IF NOT EXISTS practice_time
              ON records ((body ->> '$.occurredAtMs') DESC)
              WHERE kind = 'learning-event' AND body ->> '$.type' = 'attempt';
        """)

    def close(self):
        self.db.close()

    @contextmanager
    def transaction(self):
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            yield

    def put(self, record):
        self.db.execute(
            "INSERT INTO records VALUES (?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET body=excluded.body",
            (*identity(record), json.dumps(record, allow_nan=False, ensure_ascii=False)),
        )

    def get(self, kind, id):
        row = self.db.execute("SELECT body FROM records WHERE kind=? AND id=?", (kind, id)).fetchone()
        return json.loads(row["body"]) if row else None

    def delete(self, kind, id):
        self.db.execute("DELETE FROM records WHERE kind=? AND id=?", (kind, id))

    def label(self, ref):
        kind, id = identity(ref)
        target = self.get(kind, id)
        if target is None:
            return None
        if kind == "note":
            return headline(target)
        return target.get("name") or target.get("statement") or id

    def list_notes(self, query=""):
        rows = self.db.execute("""
            SELECT id, body FROM records
            WHERE kind='note' AND instr(casefold(
                coalesce(body ->> '$.title', '') || char(10) ||
                coalesce(body ->> '$.text', '') || char(10) ||
                coalesce(body ->> '$.aliases', '')
            ), ?) > 0
            ORDER BY rowid DESC
        """, (query.strip().casefold(),))
        return [{"id": row["id"], "title": headline(json.loads(row["body"]))} for row in rows]

    def note(self, id):
        record = self.get("note", id)
        if record is None:
            return None
        attachments = []
        for ref in record.get("attachments", []):
            row = self.db.execute("SELECT name FROM images WHERE id=?", (ref["id"],)).fetchone()
            attachments.append({**ref, "name": row["name"] if row else None})
        return {
            **record,
            "attachments": attachments,
            "related": [{**ref, "label": self.label(ref)} for ref in record.get("related", [])],
        }

    def edit_note(self, id, text, create=False, inbox_id=None, artifact_id=None):
        patch = {"text": text} if isinstance(text, str) else text
        if not isinstance(patch, dict) or not patch.keys() <= {"title", "text", "extra", "aliases", "tags"}:
            raise ValueError("Invalid note fields.")
        for field, value in patch.items():
            if field in ("aliases", "tags"):
                if not isinstance(value, list) or any(not isinstance(item, str) or not item.strip() for item in value):
                    raise ValueError(f"Invalid {field}.")
            elif not isinstance(value, str) or len(value) > 1_000_000:
                raise ValueError(f"Invalid note {field}.")
        with self.transaction():
            record = self.get("note", id)
            if record is None and create:
                key = UUID(id)
                if key.version != 4 or str(key) != id:
                    raise ValueError("Invalid note ID.")
                record = {"kind": "note", "id": id}
                if inbox_id is not None:
                    item = self.require_inbox_item(inbox_id)
                    item["notes"] = [*item.get("notes", []), id]
                    self.put(item)
                if artifact_id is not None:
                    record["related"] = [self.artifact_reference(artifact_id)]
            if record is None:
                raise ValueError("This note has been deleted.")
            record.update(patch)
            if not any(record.get(field, "").strip() for field in ("title", "text", "extra")) and not any(
                record.get(field) for field in ("aliases", "tags", "attachments", "related")
            ):
                raise ValueError("Add some content before saving the note.")
            self.put(record)
        return self.note(record["id"])

    def require_note(self, id):
        record = self.get("note", id)
        if record is None:
            raise ValueError("This note has been deleted.")
        return record

    def delete_note(self, id):
        """Return what undo needs: the stored record and its image bytes."""
        with self.transaction():
            record = self.require_note(id)
            images = []
            for ref in record.get("attachments", []):
                row = self.db.execute("SELECT id, name, media_type, data FROM images WHERE id=?", (ref["id"],)).fetchone()
                if row:
                    images.append({"id": row["id"], "name": row["name"], "mediaType": row["media_type"],
                                   "data": base64.b64encode(row["data"]).decode("ascii")})
            self.delete("note", id)
            for ref in record.get("attachments", []):
                self.delete_unused_image(ref["id"])
        return {"record": record, "images": images}

    def restore_record(self, record, images=()):
        """Undo a deletion. Only puts back records that are still absent."""
        kind, id = identity(record)
        if kind not in ("note", INBOX, academic.SOURCE):
            raise ValueError("This record cannot be restored.")
        with self.transaction():
            if self.get(kind, id) is not None:
                raise ValueError("This record already exists again.")
            if kind == academic.SOURCE:
                self.check_source_keys([record], self.list_sources())
            for image in images if kind == "note" else ():
                data = base64.b64decode(image["data"], validate=True)
                self.db.execute("INSERT OR IGNORE INTO images VALUES (?, ?, ?, ?, ?)",
                                (image["id"], image["name"], media_type(data), hashlib.sha256(data).hexdigest(), data))
            self.put(record)

    def link_targets(self, query=""):
        rows = self.db.execute("""
            SELECT body FROM records
            WHERE kind IN ('note', 'artifact', 'topic')
            AND instr(casefold(body), ?) > 0
            ORDER BY rowid DESC
            LIMIT 50
        """, (query.strip().casefold(),))
        targets = []
        for row in rows:
            record = json.loads(row["body"])
            label = headline(record) if record["kind"] == "note" else record["name"]
            if label:
                targets.append({"id": record["id"], "kind": record["kind"], "label": label})
        return targets

    def link(self, id, kind, target, remove=False, relation=None):
        if relation is not None and (not isinstance(relation, str) or relation in (FOLLOWS, BRANCHES)):
            raise ValueError("Choose a regular relationship label.")
        with self.transaction():
            record = self.require_note(id)
            refs = record.get("related", [])
            key = (kind, target)
            if remove:
                refs = [ref for ref in refs if is_place(ref) or identity(ref) != key]
            elif key != ("note", id):
                match = next((ref for ref in refs if not is_place(ref) and identity(ref) == key), None)
                if match is None:
                    if self.get(*key) is None:
                        raise ValueError("This record is unavailable.")
                    match = {"kind": kind, "id": target}
                    refs.append(match)
                if relation:
                    match["relation"] = relation
                elif relation == "":
                    match.pop("relation", None)
            record["related"] = refs
            self.put(record)
        return self.note(id)

    def zettelkasten(self):
        rows = self.db.execute("SELECT body FROM records WHERE kind='note' ORDER BY id")
        notes = []
        for row in rows:
            note = json.loads(row["body"])
            notes.append({
                "id": note["id"], "title": headline(note), "tags": note.get("tags", []),
                "places": [{"id": ref["id"], "relation": ref["relation"]}
                           for ref in note.get("related", []) if is_place(ref)],
            })
        return outline(notes)

    def place_note(self, id, action, target=None):
        with self.transaction():
            record = self.require_note(id)
            entries = {entry["id"]: entry for entry in self.zettelkasten()["entries"]}
            status = entries[id]["status"]
            refs = record.get("related", [])
            tags = record.get("tags", [])
            if action == "root":
                if status != "unplaced" or any(entry["status"] == "root" for entry in entries.values()):
                    raise ValueError("Choose an unplaced note while the outline has no root.")
                record["tags"] = [*tags, ROOT]
            elif action == "clearRoot":
                record["tags"] = [tag for tag in tags if tag != ROOT]
            elif action == "exclude":
                if status != "unplaced":
                    raise ValueError("Only unplaced notes can be excluded.")
                record["tags"] = [*tags, EXCLUDE]
            elif action == "include":
                record["tags"] = [tag for tag in tags if tag != EXCLUDE]
            elif action == "unplace":
                record["related"] = [ref for ref in refs if not is_place(ref)]
            elif action in (FOLLOWS, BRANCHES):
                parent = entries.get(target)
                if status in ("root", "excluded") or parent is None or parent["status"] not in ("root", "attached"):
                    raise ValueError("Choose a placed target and a note eligible for placement.")
                cursor = parent
                while True:
                    if cursor["id"] == id:
                        raise ValueError("This placement would create a cycle.")
                    if cursor["status"] == "root":
                        break
                    cursor = entries[cursor["place"]["id"]]
                if action == FOLLOWS and parent["hasFollower"]:
                    if any(entry["id"] != id and entry["status"] != "root"
                           and entry["place"] == {"id": target, "relation": FOLLOWS} for entry in entries.values()):
                        raise ValueError("A note already follows this target.")
                record["related"] = [ref for ref in refs if not is_place(ref)]
                record["related"].append({"kind": "note", "id": target, "relation": action})
                record["tags"] = [tag for tag in tags if tag not in (ROOT, EXCLUDE)]
            else:
                raise ValueError("Unknown placement action.")
            self.put(record)
        return self.note(id)

    def import_inbox(self, files):
        added = duplicates = 0
        with self.transaction():
            for file in files:
                name, text, digest = (file[field] for field in ("name", "text", "digest"))
                if (not isinstance(name, str) or not name or not isinstance(text, str) or not text.strip()
                        or not isinstance(digest, str) or not re.fullmatch("[0-9a-f]{64}", digest)):
                    raise ValueError("Invalid plaintext import.")
                id = hashlib.sha256(f"{name}\0{digest}".encode()).hexdigest()
                if self.get(INBOX, id) is None:
                    self.put({"kind": INBOX, "id": id, "name": name, "text": text})
                    added += 1
                else:
                    duplicates += 1
        return {"added": added, "duplicates": duplicates}

    def list_inbox(self):
        return [dict(row) for row in self.db.execute("""
            SELECT id, body ->> '$.name' AS name, body ->> '$.deferredAt' AS deferredAt
            FROM records WHERE kind=?
            ORDER BY deferredAt, name COLLATE NOCASE, id
        """, (INBOX,))]

    def inbox_item(self, id):
        item = self.get(INBOX, id)
        if item is None:
            return None
        notes = []
        for note_id in item.get("notes", []):
            label = self.label({"kind": "note", "id": note_id})
            if label is not None:
                notes.append({"id": note_id, "title": label})
        return {**item, "notes": notes}

    def require_inbox_item(self, id):
        item = self.get(INBOX, id)
        if item is None:
            raise ValueError("This imported text is unavailable.")
        return item

    def defer_inbox(self, id):
        with self.transaction():
            item = self.require_inbox_item(id)
            item["deferredAt"] = time.time_ns() // 1_000_000
            self.put(item)

    def remove_inbox(self, id):
        with self.transaction():
            item = self.require_inbox_item(id)
            self.delete(INBOX, id)
        return item

    def list_sources(self):
        rows = self.db.execute("""
            SELECT body FROM records WHERE kind=?
            ORDER BY body ->> '$.citationKey' COLLATE NOCASE, id
        """, (academic.SOURCE,))
        return [json.loads(row["body"]) for row in rows]

    def preview_bibtex(self, text):
        return academic.preview(text)

    def source_library(self):
        artifacts = self.db.execute("""
            SELECT body FROM records WHERE kind='artifact'
            ORDER BY body ->> '$.name' COLLATE NOCASE, id
        """)
        return {"entries": self.list_sources(), "artifacts": [json.loads(row["body"]) for row in artifacts]}

    def export_bibtex(self):
        sources = self.list_sources()
        self.check_source_keys(sources)
        return bibtex.render(academic.validate_bib(source) for source in sources)

    def artifact_reference(self, id):
        if self.get("artifact", id) is None:
            raise ValueError("This artifact is unavailable.")
        return {"kind": "artifact", "id": id}

    def source_links(self, artifact_id):
        artifact = self.get("artifact", artifact_id)
        notes = self.db.execute("""
            SELECT id, body FROM records
            WHERE kind='note' AND EXISTS (
                SELECT 1 FROM json_each(body, '$.related') ref
                WHERE ref.value ->> '$.kind' = 'artifact' AND ref.value ->> '$.id' = ?
            )
            ORDER BY rowid DESC
        """, (artifact_id,))
        annotations = self.db.execute("""
            SELECT body FROM records WHERE kind='annotation'
            AND body ->> '$.target.kind' = 'artifact' AND body ->> '$.target.id' = ?
            ORDER BY rowid DESC
        """, (artifact_id,))
        return {
            "artifact": artifact,
            "notes": [{"id": row["id"], "title": headline(json.loads(row["body"]))} for row in notes],
            "annotations": [json.loads(row["body"]) for row in annotations],
        }

    def check_source_keys(self, sources, existing=()):
        keys = {entry["citationKey"].casefold() for entry in existing}
        for source in sources:
            key = source["citationKey"]
            folded = key.casefold()
            if folded in keys:
                raise ValueError(f"The citation key {key} is already in use. Choose a different key or reconcile the entries.")
            keys.add(folded)

    def source_record(self, entry, previous=None):
        values = academic.validate_bib(entry)
        if previous and values["fields"].get("title") == previous["fields"].get("title"):
            ref = previous["artifact"]
        else:
            artifact = academic.entry_artifact(values)
            if self.get("artifact", artifact["id"]) is None:
                self.put(artifact)
            ref = {"kind": "artifact", "id": artifact["id"]}
        record = previous or {"kind": academic.SOURCE, "id": str(uuid4())}
        for field in ("aliases", "tags"):
            if field in entry:
                items = entry[field]
                if not isinstance(items, list) or any(not isinstance(item, str) or not item.strip() for item in items):
                    raise ValueError(f"Invalid {field}.")
                values[field] = list(dict.fromkeys(items))
        if "extra" in entry:
            if not isinstance(entry["extra"], str):
                raise ValueError("Invalid extra text.")
            values["extra"] = entry["extra"]
        return {**record, **values, "artifact": ref}

    def import_sources(self, entries):
        with self.transaction():
            sources = [self.source_record(entry) for entry in entries]
            self.check_source_keys(sources, self.list_sources())
            for source in sources:
                self.put(source)
        return sources

    def current_source(self, snapshot):
        current = self.get(academic.SOURCE, snapshot["id"])
        if current is None or current != snapshot:
            raise ValueError("This entry changed. Reopen it before saving.")
        return current

    def save_source(self, snapshot, entry):
        with self.transaction():
            current = self.get(academic.SOURCE, snapshot["id"])
            fields = ("citationKey", "bibtexType", "fields", "artifact", "aliases", "tags", "extra")
            if current is None or any(current.get(field) != snapshot.get(field) for field in fields):
                raise ValueError("This entry changed. Reopen it before saving.")
            source = self.source_record(entry, current)
            self.check_source_keys([source], (row for row in self.list_sources() if row["id"] != source["id"]))
            self.put(source)
        return source

    def source_details(self, id):
        source = self.get(academic.SOURCE, id)
        if source is None:
            return None
        return {
            "claims": [note for key in source.get("claims", []) if (note := self.note(key)) is not None],
            "topics": [
                {"id": key, "strength": strength, "name": (self.get("topic", key) or {}).get("name", key)}
                for key, strength in source.get("topics", {}).items()
            ],
        }

    def edit_source_links(self, id, action, target, value=None):
        with self.transaction():
            source = self.get(academic.SOURCE, id)
            if source is None:
                raise ValueError("This citation is unavailable.")
            if action in ("addClaim", "attachClaim", "detachClaim"):
                claims = source.setdefault("claims", [])
                if action == "addClaim":
                    if not isinstance(value, str) or not value.strip() or len(value) > 1_000_000:
                        raise ValueError("Write a claim before adding it.")
                    key = UUID(target)
                    if key.version != 4 or str(key) != target or self.get("note", target) is not None:
                        raise ValueError("Invalid or occupied claim note ID.")
                    self.put({"kind": "note", "id": target, "text": value})
                elif action == "attachClaim":
                    self.require_note(target)
                if action == "detachClaim":
                    source["claims"] = [key for key in claims if key != target]
                elif target not in claims:
                    claims.append(target)
            elif action in ("addTopic", "setStrength", "detachTopic"):
                topics = source.setdefault("topics", {})
                if action == "addTopic":
                    topic = {**academic.artifact_for(target), "kind": "topic"}
                    target = topic["id"]
                    if self.get("topic", target) is None:
                        self.put(topic)
                    topics.setdefault(target, 1)
                elif action == "detachTopic":
                    topics.pop(target, None)
                elif target in topics and type(value) in (int, float) and 0 <= value <= 1:
                    topics[target] = value
                else:
                    raise ValueError("Choose a linked topic and a strength between zero and one.")
            else:
                raise ValueError("Unknown citation action.")
            self.put(source)

    def delete_source(self, snapshot):
        with self.transaction():
            record = self.current_source(snapshot)
            self.delete(academic.SOURCE, record["id"])
        return record

    def reconcile_source(self, snapshot, incoming, take_fields, take_key=False, take_type=False, stored=False):
        with self.transaction():
            current = self.current_source(snapshot)
            other = self.current_source(incoming) if stored else academic.validate_bib(incoming)
            if stored and current["id"] == other["id"]:
                raise ValueError("Choose two different entries.")
            entry = academic.merged_bib(current, other, take_fields, take_key, take_type)
            source = self.source_record(entry, current)
            replaced_ids = {current["id"], other["id"]} if stored else {current["id"]}
            self.check_source_keys([source], (row for row in self.list_sources() if row["id"] not in replaced_ids))
            self.put(source)
            if stored:
                self.delete(academic.SOURCE, other["id"])
        return source

    def add_annotation(self, artifact_id, text, locator=""):
        if not isinstance(text, str) or not text.strip() or len(text) > 1_000_000:
            raise ValueError("Write some annotation text (up to one million characters).")
        if not isinstance(locator, str):
            raise ValueError("Enter a text locator.")
        with self.transaction():
            record = {"kind": "annotation", "id": str(uuid4()), "text": text,
                      "target": self.artifact_reference(artifact_id)}
            if locator.strip():
                record["locator"] = locator.strip()
            self.put(record)
        return record

    def attach_image(self, id, name, encoded):
        if len(encoded) > 4 * ((MAX_IMAGE_BYTES + 2) // 3):
            raise ValueError("Images must be no larger than 12 MiB.")
        data = base64.b64decode(encoded, validate=True)
        if len(data) > MAX_IMAGE_BYTES:
            raise ValueError("Images must be no larger than 12 MiB.")
        mime = media_type(data)
        digest = hashlib.sha256(data).hexdigest()
        with self.transaction():
            record = self.require_note(id)
            row = self.db.execute("SELECT id FROM images WHERE digest=?", (digest,)).fetchone()
            key = row["id"] if row else str(uuid4())
            if row is None:
                self.db.execute(
                    "INSERT INTO images VALUES (?, ?, ?, ?, ?)",
                    (key, Path(name).name[:240] or "Image", mime, digest, data),
                )
            refs = record.setdefault("attachments", [])
            if all(ref["id"] != key for ref in refs):
                refs.append({"id": key, "mediaType": mime})
                self.put(record)
        return self.note(id)

    def delete_unused_image(self, image_id):
        self.db.execute("""
            DELETE FROM images WHERE id=? AND NOT EXISTS (
                SELECT 1 FROM records, json_each(body, '$.attachments') ref
                WHERE kind='note' AND ref.value ->> '$.id' = images.id
            )
        """, (image_id,))

    def detach_image(self, id, image_id):
        with self.transaction():
            record = self.require_note(id)
            record["attachments"] = [
                ref for ref in record.get("attachments", []) if ref["id"] != image_id
            ]
            self.put(record)
            self.delete_unused_image(image_id)
        return self.note(id)

    def image(self, id):
        row = self.db.execute("SELECT media_type, data FROM images WHERE id=?", (id,)).fetchone()
        if row is None:
            raise ValueError("Image data is unavailable.")
        return f"data:{row['media_type']};base64,{base64.b64encode(row['data']).decode('ascii')}"

    def import_practice(self, text):
        if len(text.encode()) > MAX_IMPORT_BYTES:
            raise ValueError("The records file must be no larger than 16 MiB.")
        records = json.loads(text)
        if not isinstance(records, list):
            raise ValueError("Choose a JSON array of learner records.")
        count = 0
        with self.transaction():
            for record in records:
                kind, _ = identity(record)
                if kind == "learning-event":
                    timestamp = record.get("occurredAtMs")
                    targets = record.get("targets")
                    if (record.get("type") not in ("engagement", "attempt")
                            or type(timestamp) is not int or abs(timestamp) > 2**53 - 1
                            or not isinstance(targets, list) or not targets):
                        raise ValueError("A learning event has an invalid type, timestamp, or targets.")
                    for ref in targets:
                        identity(ref)
                elif kind in ("fact", "skill", "topic"):
                    label = record.get("statement" if kind == "fact" else "name")
                    if not isinstance(label, str) or not label.strip():
                        raise ValueError(f"A {kind} is missing its display label.")
                else:
                    continue
                self.put(record)
                count += 1
        return count

    def recent_practice(self):
        return [dict(row) for row in self.db.execute(PRACTICE)]


    def learning_history(self):
        rows = self.db.execute("""
            SELECT body FROM records WHERE kind='learning-event'
            ORDER BY body ->> '$.occurredAtMs' DESC, id DESC
        """)
        events = []
        for row in rows:
            event = json.loads(row["body"])
            event["targets"] = [
                {**ref, "label": self.label(ref) or ref["id"]} for ref in event["targets"]
            ]
            events.append(event)
        return events
