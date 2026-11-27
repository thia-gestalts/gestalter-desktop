import base64
import json
from pathlib import Path
import sys
import tempfile
import unittest
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from academic import artifact_for
from bibtex import render
from inbox import read_folder
from store import Store


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
        occurrences = {event["id"]: event for event in self.store.learning_history()}
        self.assertEqual(len(occurrences), 2)
        self.assertEqual(occurrences[attempt["id"]]["score"], 0)
        self.assertTrue(any(ref["label"] == "Round to the nearest ten"
                            for ref in occurrences[attempt["id"]]["targets"]))
        self.assertNotIn("score", occurrences[engagement["id"]])

        later = {**attempt, "id": str(uuid4()), "occurredAtMs": 1760000090000,
                 "targets": [{"kind": "skill", "id": skill["id"]}, *engagement["targets"]]}
        later.pop("score")
        self.store.import_practice(json.dumps([later]))
        self.reopen()
        self.assertEqual([row["occurredAtMs"] for row in self.store.recent_practice()],
                         [1760000090000, 1760000000000])
        history = self.store.learning_history()
        self.assertEqual(sum(event["type"] == "attempt" for event in history), 2)
        self.assertTrue(any(
            target["kind"] == "topic" and target["label"] == "Bézier Curves"
            for event in history if event["id"] == later["id"] for target in event["targets"]
        ))

    def test_note_headline_uses_explicit_title_or_main_without_rewriting_main(self):
        key = str(uuid4())
        original = "\n> First observation\n\nBody"
        self.store.edit_note(key, original, True)
        self.assertEqual(self.store.list_notes()[0]["title"], "First observation")
        updated = self.store.edit_note(key, {"title": "Explicit title", "aliases": ["nick"]})
        self.assertEqual(updated["text"], original)
        self.assertEqual(self.store.list_notes("nick")[0]["title"], "Explicit title")
        self.store.edit_note(key, {"title": ""})
        self.assertEqual(self.store.list_notes()[0]["title"], "First observation")

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
        removed = self.store.delete_note(first)
        self.assertIsNone(self.store.note(first))
        self.store.restore_record(removed["record"], removed["images"])
        self.assertEqual(self.store.note(first)["text"], "# Rounding\n\nUpdated.")
        with self.assertRaises(ValueError):
            self.store.restore_record(removed["record"], removed["images"])
        self.store.edit_note(first, {"text": "With image"})
        pictured = self.store.attach_image(first, "pixel.png", IMAGE)["attachments"][0]
        removed = self.store.delete_note(first)
        with self.assertRaises(ValueError):
            self.store.image(pictured["id"])
        self.store.restore_record(removed["record"], removed["images"])
        self.assertEqual(self.store.image(pictured["id"]), uri)
        self.store.delete_note(first)
        self.assertIsNone(self.store.note(first))
        with self.assertRaises(ValueError):
            self.store.restore_record({"kind": "learning-event", "id": "x"})

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
        removed = self.store.remove_inbox(item["id"])
        self.store.restore_record(removed)
        self.assertEqual(self.store.inbox_item(item["id"])["notes"], [{"id": note_id, "title": "A note from the inbox"}])
        self.store.remove_inbox(item["id"])
        self.assertIsNone(self.store.inbox_item(item["id"]))
        self.assertEqual(self.store.note(note_id)["text"], "A note from the inbox")
        self.assertEqual(self.store.import_inbox(read_folder(source)["files"]), {"added": 1, "duplicates": 1})

    def test_academic_sources_identity_and_bibtex_round_trip(self):
        fixture = Path(__file__).resolve().parents[1] / "vendor" / "thia-gestalts" / "examples"
        for vectors in json.loads((fixture / "v1" / "identity.json").read_text()).values():
            for pair in vectors:
                for record in pair:
                    if record["kind"] in {"topic", "artifact"}:
                        self.assertEqual(artifact_for(record["name"])["id"], record["id"])
        # The Cyrillic Tje case pair was added in Unicode 16.0.
        self.assertEqual(artifact_for("\u1c89")["id"], artifact_for("\u1c8a")["id"])
        with self.assertRaises(ValueError):
            artifact_for("\ud800")

        citations = json.loads((fixture / "v2" / "desktop.json").read_text())["citations"]
        raw = render(citations).replace("  year = {2024},", r"  year = 2024, support = {\textsc{EU} # literal},")
        first, second = self.store.import_sources(self.store.preview_bibtex(raw))
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(first["artifact"], citations[0]["artifact"])
        self.assertEqual(second["artifact"], first["artifact"])
        self.assertEqual(len(self.store.source_library()["artifacts"]), 1)
        self.assertEqual(second["fields"]["support"], r"\textsc{EU} # literal")

        changed = {**second, "fields": {**second["fields"], "edition": "3"}}
        updated = self.store.save_source(second, changed)
        with self.assertRaisesRegex(ValueError, "changed"):
            self.store.save_source(second, changed)
        self.assertEqual(self.store.get(first["kind"], first["id"]), first)
        self.assertEqual(updated["id"], second["id"])
        note_id = str(uuid4())
        artifact_id = first["artifact"]["id"]
        self.store.edit_note(note_id, "A related note", True, artifact_id=artifact_id)
        annotation = self.store.add_annotation(artifact_id, "A second reading", "p. 42")
        self.reopen()
        links = self.store.source_links(artifact_id)
        self.assertEqual(links["notes"], [{"id": note_id, "title": "A related note"}])
        self.assertEqual(links["annotations"], [annotation])
        exported = self.store.preview_bibtex(self.store.export_bibtex())
        self.assertEqual(exported[0]["fields"], first["fields"])
        self.assertEqual(exported[1]["fields"], changed["fields"])

        merged = self.store.reconcile_source(first, updated, ["year"], stored=True)
        self.assertEqual(merged["citationKey"], first["citationKey"])
        self.assertEqual(merged["fields"]["year"], "2024")
        self.assertEqual(merged["fields"]["support"], updated["fields"]["support"])
        self.assertIsNone(self.store.get(second["kind"], second["id"]))
        self.assertEqual(self.store.source_links(artifact_id), links)

    def test_bibtex_macros_types_and_invalid_batch(self):
        text = r"""
          % @ignore{comment}
          @string{cup = "Cambridge"}
          @custom_edition(publisher2024,
            title = "B{\'e}zier " # {Curves},
            publisher = cup # " University Press",
            file = {:/tmp/a.pdf:PDF}, month = feb, options = {})
          @misc{withoutFields}
        """
        custom, empty = self.store.preview_bibtex(text)
        self.assertEqual(custom["work"]["name"], "Bézier Curves")
        self.assertEqual(custom["bibtexType"], "custom_edition")
        self.assertEqual(custom["fields"], {
            "title": r"B{\'e}zier Curves", "publisher": "Cambridge University Press",
            "file": ":/tmp/a.pdf:PDF", "month": "February", "options": "",
        })
        self.assertEqual(empty["work"]["name"], "withoutFields")
        with self.assertRaisesRegex(ValueError, "already in use"):
            self.store.import_sources([custom, {**empty, "citationKey": custom["citationKey"]}])
        self.assertEqual(self.store.source_library(), {"entries": [], "artifacts": []})
        with self.assertRaisesRegex(ValueError, "BibTeX line"):
            self.store.preview_bibtex(text + "@book{broken, title = {Unclosed}")
        with self.assertRaisesRegex(ValueError, "brace grouping"):
            self.store.import_sources([custom, {**empty, "fields": {"title": "Unclosed {"}}])
        self.assertEqual(self.store.source_library(), {"entries": [], "artifacts": []})
