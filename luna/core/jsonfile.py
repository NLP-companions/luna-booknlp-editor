"""The two JSON files in the data folder that every book shares, library.json and collections.json: reading them safely and
writing them atomically.

They hold work you'd hate to lose (your folders and book details; your collections' characters), so a file that can't be
read is never silently replaced by an empty one: it is renamed aside (`library.unreadable-<time>.json`) and the editor
starts afresh, and every save writes a temporary file first and then replaces the old one in one step, so a crash
never leaves half a file.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path


def read(path: Path, readable=lambda data: isinstance(data, dict)):
    """The parsed contents of `path`, or None when there is no such file. A file that isn't JSON, or whose contents
    `readable` refuses (the wrong shape for this version), is renamed aside (`set_aside`) and None is returned."""
    path = Path(path)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if readable(data):
            return data
    except (ValueError, UnicodeDecodeError):
        pass
    set_aside(path)
    return None


def set_aside(path: Path) -> Path:
    """Rename an unreadable file to `<name>.unreadable-<time>.json` next to it (a number added if that exists) and return
    the new path."""
    stamp = int(time.time())
    dest, n = path.with_suffix(f".unreadable-{stamp}.json"), 2
    while dest.exists():
        dest, n = path.with_suffix(f".unreadable-{stamp}-{n}.json"), n + 1
    path.rename(dest)
    return dest


def write(path: Path, text: str):
    """Write `text` to `path` atomically: a temporary file next to it, then replaced in one step."""
    path = Path(path)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)
