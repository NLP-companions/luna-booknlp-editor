"""Reading the extra files of a pre-cleaned BookNLP folder out of a project's `meta.passthrough`, and applying what they say.

A cleaning step run on a BookNLP output folder before you point the editor at it (not part of this repo) may rewrite it: better coreference clustering and speaker attribution, in the same `.entities`/`.quotes`/etc. formats,
so importing a cleaned folder needs no changes here. It may also write two files of its own that `create_project`
already keeps verbatim in `meta.passthrough` (anything not `.tokens`/`.entities`/`.supersense`/`.quotes`):

  <id>.groups.tsv       the plural entities it created for the narrator's "we/us/our" (group_id, name, member_ids)
  <id>.cleanup_log.tsv  every change it made; rows with file="review" are dialogue turns it could not settle

`apply_cleanup_metadata` uses these two, if present, to name those groups and to flag the unsettled turns, so a
cleaned import starts with that work already done. It changes nothing else about them (the analyser owns turning
`.groups.tsv` member ids into a plural-group declaration; that stays out of this editor). A project imported from
plain BookNLP output has neither file, and this does nothing.
"""
from __future__ import annotations

from luna.core.errors import EditError


def parse_groups_tsv(text):
    """(group_id, name, member_ids) for each row of a `<id>.groups.tsv` (its header row is skipped). A row that can't be
    read (too few cells, an id that isn't a number) is left out: the file is a head start, never a reason to refuse a book."""
    out = []
    for line in text.splitlines()[1:]:
        cells = line.rstrip("\r").split("\t")
        if len(cells) < 3:
            continue
        try:
            out.append((int(cells[0]), cells[1], [int(m) for m in cells[2].split(",") if m.strip()]))
        except ValueError:
            continue
    return out


def parse_review_rows(text):
    """(start_token, end_token, rule) for each `file="review"` row of a `<id>.cleanup_log.tsv`. Rows that can't be read are
    left out, and so is everything when the header lacks a column this needs."""
    lines = text.splitlines()
    if not lines:
        return []
    ci = {name: i for i, name in enumerate(lines[0].rstrip("\r").split("\t"))}
    if not {"file", "start_token", "end_token", "rule"} <= set(ci):
        return []
    out = []
    for line in lines[1:]:
        cells = line.rstrip("\r").split("\t")
        try:
            if cells[ci["file"]] == "review":
                out.append((int(cells[ci["start_token"]]), int(cells[ci["end_token"]]), cells[ci["rule"]]))
        except (IndexError, ValueError):
            continue
    return out


def apply_cleanup_metadata(store):
    """Name a cleaning step's plural groups and flag its unsettled dialogue turns, from what import kept in
    `meta.passthrough`. A group no longer holding any mentions, or a review row whose span no longer matches a
    quote, is skipped rather than raising: the corrected data is what matters, these files are just a head start.
    """
    passthrough = store.meta.get("passthrough") or {}
    groups_tsv = passthrough.get(".groups.tsv")
    if groups_tsv:
        for gid, name, _members in parse_groups_tsv(groups_tsv):
            try:
                store.edit_group(gid, {"name": name})
            except EditError:
                pass
    log_tsv = passthrough.get(".cleanup_log.tsv")
    if log_tsv:
        for start, end, rule in parse_review_rows(log_tsv):
            row = store.db.execute("SELECT uid FROM quotes WHERE tok_start=? AND tok_end=?", (start, end)).fetchone()
            if row:
                store.set_flag("quotes", row["uid"], note=rule, auto=True)
