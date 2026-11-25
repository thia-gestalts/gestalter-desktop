"""Read direct files in a user-selected directory without changing the source."""
import hashlib
import os
from pathlib import Path
import stat
import unicodedata

INBOX = "gestalter-inbox-text"


def read_folder(path):
    files, skipped = [], []
    try:
        with os.scandir(path) as directory:
            entries = sorted(directory, key=lambda entry: entry.name)
    except OSError as error:
        raise ValueError("Could not open the selected folder.") from error

    for entry in entries:
        name = entry.name
        try:
            name.encode("utf-8")
            if entry.is_dir(follow_symlinks=False):
                continue
            if not entry.is_file(follow_symlinks=False):
                skipped.append({"name": name, "reason": "Not a regular file."})
                continue
            with open(Path(entry.path), "rb", opener=open_direct) as file:
                if not stat.S_ISREG(os.fstat(file.fileno()).st_mode):
                    raise OSError
                data = file.read()
            text = data.decode("utf-8-sig")
            if any(unicodedata.category(char) == "Cc" and char not in "\t\n\r\f" for char in text):
                skipped.append({"name": name, "reason": "Contains binary control characters."})
            elif not text.strip():
                skipped.append({"name": name, "reason": "Empty text."})
            else:
                files.append({"name": name, "text": text, "digest": hashlib.sha256(data).hexdigest()})
        except UnicodeEncodeError:
            skipped.append({"name": os.fsencode(name).decode("utf-8", "replace"), "reason": "Filename is not UTF-8."})
        except UnicodeDecodeError:
            skipped.append({"name": name, "reason": "Content is not UTF-8."})
        except OSError:
            skipped.append({"name": name, "reason": "Could not read the file."})
    return {"files": files, "skipped": skipped}


def open_direct(path, flags):
    return os.open(path, flags | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
