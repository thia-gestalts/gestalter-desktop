"""Desktop citation data and the shared artifact identity it points to."""
import re
import unicodedata

import bibtex

SOURCE = "gestalter-academic-source"
MAX_BIB_BYTES = 16 * 1024 * 1024
WHITE_SPACE = re.compile(r"[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+")


def artifact_for(name):
    if unicodedata.unidata_version != "16.0.0":
        raise ValueError("Academic Sources requires Python with Unicode 16.0.0 data (CPython 3.14).")
    name.encode("utf-8")  # Reject unpaired surrogates.
    folded = WHITE_SPACE.sub(" ", unicodedata.normalize("NFC", name)).strip(" ").casefold()
    if not folded:
        raise ValueError("Give the artifact a name.")
    return {
        "kind": "artifact",
        "id": "name:" + unicodedata.normalize("NFC", folded).encode("utf-8").hex(),
        "name": name,
    }


def validate_bib(entry):
    key, entry_type, fields = (entry.get(name) for name in ("citationKey", "bibtexType", "fields"))
    if not isinstance(key, str) or not bibtex.TOKEN.fullmatch(key):
        raise ValueError("Enter a valid BibTeX citation key with no spaces or delimiters.")
    if (not isinstance(entry_type, str) or not bibtex.TYPE.fullmatch(entry_type)
            or entry_type.lower() in bibtex.DIRECTIVES):
        raise ValueError("Enter a valid BibTeX entry type.")
    if not isinstance(fields, dict):
        raise ValueError("Expected BibTeX fields.")
    if any(not bibtex.FIELD.fullmatch(name) or name != name.lower() for name in fields):
        raise ValueError("Use lowercase BibTeX field names.")
    for name, value in fields.items():
        if not bibtex.valid_value(value):
            raise ValueError(f"Check the brace grouping in the {name} field.")
    if sum(len(value.encode()) for value in fields.values()) > MAX_BIB_BYTES:
        raise ValueError("A BibTeX entry must be no larger than 16 MiB.")
    return {"citationKey": key, "bibtexType": entry_type.lower(), "fields": fields}


def entry_artifact(entry):
    title = bibtex.display_title(entry["fields"].get("title", ""))
    return artifact_for(title if WHITE_SPACE.sub(" ", title).strip(" ") else entry["citationKey"])


def preview(text):
    if not isinstance(text, str) or len(text.encode()) > MAX_BIB_BYTES:
        raise ValueError("The BibTeX input must be no larger than 16 MiB.")
    return [{**entry, "work": entry_artifact(entry)} for entry in bibtex.Reader(text).entries()]


def merged_bib(current, incoming, take_fields, take_key, take_type):
    fields = dict(current["fields"])
    for name, value in incoming["fields"].items():
        if name not in fields or name in take_fields:
            fields[name] = value
    return {
        "citationKey": (incoming if take_key else current)["citationKey"],
        "bibtexType": (incoming if take_type else current)["bibtexType"],
        "fields": fields,
    }
