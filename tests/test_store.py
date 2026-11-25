import base64
import json
from pathlib import Path
import sys
import tempfile
import unittest
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from store import Store
from inbox import read_folder


FIXTURE = Path(__file__).with_name("fixtures") / "records.json"
IMAGE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII="


class StorageTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = Store(Path(self.directory.name))
        self.addCleanup(lambda: self.store.close())

    def reopen(self):
        self.store.close()
        self.store = Store(Path(self.directory.name))

    def test_pinned_practice_survives_restart(self):
        fixture_text = FIXTURE.read_text()
        records = json.loads(fixture_text)
        engagement = next(record for record in records if record.get("type") == "engagement")
        attempt = next(record for record in records if record.get("type") == "attempt")
        skill = next(record for record in records if record["kind"] == "skill")
        neutral = {**engagement, "targets": [*engagement["targets"], {"kind": "skill", "id": skill["id"]}]}
        self.store.import_practice(json.dumps([neutral, skill]))
        self.reopen()
        self.assertEqual(self.store.recent_practice(), [])

        self.store.import_practice(fixture_text)
        self.store.import_practice(fixture_text)
        self.reopen()
        rows = self.store.recent_practice()
        self.assertEqual({row["kind"] for row in rows}, {"fact", "skill"})
        self.assertEqual(len(rows), 2)
        row = next(row for row in rows if row["kind"] == "skill")
        self.assertEqual(row["label"], "Round to the nearest ten")
        self.assertEqual(row["occurredAtMs"], 1760000000000)
        self.assertEqual(self.store.get("learning-event", attempt["id"])["score"], 0)

        later = {**attempt, "id": str(uuid4()), "occurredAtMs": 1760000090000,
                 "targets": [{"kind": "skill", "id": skill["id"]}]}
        later.pop("score")
        self.store.import_practice(json.dumps([later]))
        self.reopen()
        self.assertEqual([row["occurredAtMs"] for row in self.store.recent_practice()],
                         [1760000090000, 1760000000000])

    def test_failed_import_rolls_back(self):
        rows = json.loads(FIXTURE.read_text())
        with self.assertRaises(ValueError):
            self.store.import_practice(json.dumps([*rows, {"kind": "skill", "id": "bad"}]))
        self.assertEqual(self.store.recent_practice(), [])

    def test_note_patch_search_attachment_and_delete(self):
        first, second = str(uuid4()), str(uuid4())
        self.store.edit_note(first, "# Rounding\n\n**Practice** example.", True)
        self.store.edit_note(second, "Another note", True)
        with self.store.transaction():
            prior = self.store.get("note", first)
            self.store.put({**prior, "futureField": {"keep": True}})
        linked = self.store.link(first, "note", second)
        self.assertEqual(linked["related"][0]["label"], "Another note")
        attached = self.store.attach_image(first, "pixel.png", IMAGE)["attachments"][0]
        same = self.store.attach_image(second, "again.png", IMAGE)["attachments"][0]
        self.assertEqual(same["id"], attached["id"])
        self.reopen()

        note = self.store.edit_note(first, "# Rounding\n\nUpdated.")
        self.assertEqual(note["futureField"], {"keep": True})
        self.assertEqual(note["attachments"], [attached])
        self.assertEqual(note["related"], linked["related"])
        self.assertEqual(self.store.list_notes("ROUNDING"), [{"id": first, "title": "Rounding"}])
        uri = self.store.image(attached["id"])
        self.assertEqual(base64.b64decode(uri.split(",")[1]), base64.b64decode(IMAGE))

        self.store.detach_image(first, attached["id"])
        self.assertEqual(self.store.image(attached["id"]), uri)
        self.store.delete_note(second)
        self.assertIsNone(self.store.note(first)["related"][0]["label"])
        with self.assertRaises(ValueError):
            self.store.image(attached["id"])
        self.store.delete_note(first)
        self.assertIsNone(self.store.note(first))

    def test_zettelkasten_reports_inconsistent_placements(self):
        def place(id, relation="follows"):
            return {"kind": "note", "id": id, "relation": relation}

        with self.store.transaction():
            for id, fields in {
                "root": {"tags": ["zettelkasten-root"], "related": [place("unplaced")]},
                "zroot": {"tags": ["zettelkasten-root"]},
                "first": {"related": [place("root"), place("unplaced")]},
                "second": {"tags": ["no-zettelkasten"], "related": [place("root")]},
                "branch": {"related": [place("root", "branches from")]},
                "cycle1": {"related": [place("cycle2")]},
                "cycle2": {"related": [place("cycle1", "branches from")]},
                "dangling": {"related": [place("missing")]},
                "downstream": {"related": [place("dangling")]},
                "excluded": {"tags": ["no-zettelkasten"]},
                "onExcluded": {"related": [place("excluded")]},
                "unplaced": {},
                "onUnplaced": {"related": [place("unplaced")]},
            }.items():
                self.store.put({"kind": "note", "id": id, "text": id, **fields})

        outline = self.store.zettelkasten()
        self.assertEqual(outline["rows"], ["root", "branch", "first", "second"])
        rows = {entry["id"]: entry for entry in outline["entries"]}
        self.assertEqual(rows["branch"]["depth"], 1)
        self.assertEqual(rows["second"]["depth"], 0)
        self.assertEqual(rows["downstream"]["status"], "floating")
        self.assertEqual(rows["cycle2"]["status"], "floating")
        self.assertEqual(
            {id: {mark["kind"] for mark in row["marks"]} for id, row in rows.items() if row["marks"]},
            {"root": {"rootPlaced"}, "zroot": {"extraRoot"}, "first": {"placedTwice"},
             "second": {"fork", "excludedPlaced"}, "cycle1": {"cycle"}, "dangling": {"parentMissing"},
             "onExcluded": {"parentExcluded"}, "onUnplaced": {"parentUnplaced"}},
        )

        with self.assertRaisesRegex(ValueError, "cycle"):
            self.store.place_note("first", "branches from", "first")
        with self.assertRaisesRegex(ValueError, "already follows"):
            self.store.place_note("unplaced", "follows", "root")
        self.store.link("branch", "note", "root")
        self.store.link("branch", "note", "root", True)
        self.assertEqual(self.store.get("note", "branch")["related"], [place("root", "branches from")])

    def test_inbox_keys_by_filename_and_bytes(self):
        source = Path(self.directory.name) / "source"
        source.mkdir()
        first = source / "first.txt"
        first.write_bytes(b"Same text")
        (source / "second.txt").write_bytes(b"Same text")
        self.assertEqual(self.store.import_inbox(read_folder(source)["files"]), {"added": 2, "duplicates": 0})
        first.write_bytes(b"\xef\xbb\xbfSame text")
        self.assertEqual(self.store.import_inbox(read_folder(source)["files"]), {"added": 1, "duplicates": 1})

        item = next(entry for entry in self.store.list_inbox() if entry["name"] == "second.txt")
        note_id = str(uuid4())
        self.store.edit_note(note_id, "A note from the inbox", True, item["id"])
        self.store.defer_inbox(item["id"])
        self.reopen()
        self.assertEqual(self.store.list_inbox()[-1]["id"], item["id"])
        self.assertEqual(self.store.inbox_item(item["id"])["notes"], [
            {"id": note_id, "title": "A note from the inbox"},
        ])
        self.store.remove_inbox(item["id"])
        self.assertEqual(self.store.note(note_id)["text"], "A note from the inbox")
        self.assertEqual(self.store.import_inbox(read_folder(source)["files"]), {"added": 1, "duplicates": 1})
