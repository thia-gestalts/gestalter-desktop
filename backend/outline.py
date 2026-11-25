"""Derive the Zettelkasten from the current note records."""

ROOT = "zettelkasten-root"
EXCLUDE = "no-zettelkasten"
FOLLOWS = "follows"
BRANCHES = "branches from"


def is_place(ref):
    return ref.get("kind") == "note" and ref.get("relation") in (FOLLOWS, BRANCHES)


def outline(notes):
    entries = {note["id"]: {**note, "marks": [], "depth": 0} for note in notes}
    root = next((id for id, note in entries.items() if ROOT in note["tags"]), None)
    after, under = {}, {}

    def mark(note, kind, target=None):
        note["marks"].append({"kind": kind, "target": target})

    for id, note in entries.items():
        places = note.pop("places")
        tags = note.pop("tags")
        extra = ROOT in tags and id != root
        excluded = EXCLUDE in tags
        note["place"] = places[0] if places else None
        if extra:
            mark(note, "extraRoot")
        if id == root:
            note["status"] = "root"
            if places:
                mark(note, "rootPlaced")
        elif places:
            place = places[0]
            siblings = (after if place["relation"] == FOLLOWS else under).setdefault(place["id"], [])
            if len(places) > 1:
                mark(note, "placedTwice")
            if excluded:
                mark(note, "excludedPlaced")
            if siblings and place["relation"] == FOLLOWS:
                mark(note, "fork", place["id"])
            siblings.append(id)
        else:
            note["status"] = "floating" if extra else "excluded" if excluded else "unplaced"

    for id in entries:
        path = {}
        cursor = id
        while cursor in entries and "status" not in entries[cursor] and cursor not in path:
            path[cursor] = len(path)
            cursor = entries[cursor]["place"]["id"]
        if cursor in path:
            lowest = min(list(path)[path[cursor]:])
            mark(entries[lowest], "cycle", entries[lowest]["place"]["id"])
        parent_status = entries.get(cursor, {}).get("status")
        status = "attached" if parent_status in ("root", "attached") else "floating"
        if path:
            reason = {
                "unplaced": "parentUnplaced",
                "excluded": "parentExcluded",
            }.get(parent_status)
            if cursor not in entries:
                reason = "parentMissing"
            if reason:
                mark(entries[next(reversed(path))], reason, cursor)
        for child in path:
            entries[child]["status"] = status

    # Followers share a depth. Branches render below their parent, before its next follower.
    rows = []
    stack = [(root, 0)] if root else []
    while stack:
        id, depth = stack.pop()
        rows.append(id)
        entries[id]["depth"] = depth
        stack.extend((child, depth) for child in reversed(after.get(id, [])))
        stack.extend((child, depth + 1) for child in reversed(under.get(id, [])))

    for id, note in entries.items():
        note["hasFollower"] = bool(after.get(id))
    return {"rows": rows, "entries": list(entries.values())}
