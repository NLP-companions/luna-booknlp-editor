"""Flags: a "check this later" mark, with an optional note, on a mention, a quote, a group or a sentence.

Mixed into Store. A flag is purely a personal working aid, like a review or checked mark: set_flag/clear_flag are
undoable (`kind="review"`, so ⌘Z works but it never reaches the exported change log). The `flags` table (added by a
migration in Store.__init__, see core/schema.py's docstring) is keyed by (kind, target): the row's own uid for a
mention, a quote or a group, or a sentence's first token's uid for a sentence — the same stable anchor `reviewed`
marks use. A flag on something later deleted (a mention, a merged-away group) just drops out of `flags_list`; the
row itself is left behind rather than hunted down through every path that can remove its target.
"""
from __future__ import annotations

import time

from luna.core.errors import EditError

KINDS = ("entities", "quotes", "groups", "sentence")
# A short label for each kind, for the flags list and the flag button's title.
KIND_LABEL = {"entities": "Mention", "quotes": "Quote", "groups": "Group", "sentence": "Sentence"}


class FlagTools:
    """Setting, clearing and listing flags; mixed into Store."""

    def _flag_row(self, kind, target):
        """The flag on one target, if any."""
        r = self.db.execute("SELECT * FROM flags WHERE kind=? AND target=?", (kind, int(target))).fetchone()
        return dict(r) if r else None

    def _flag_target_exists(self, kind, target):
        """Is there something to flag: a mention or quote with that uid, a group with mentions, or a sentence's first token?"""
        if kind in ("entities", "quotes"):
            return self._row(kind, target) is not None
        if kind == "groups":
            return target in self.clusters()
        o = self.ord_of(target)
        return o is not None and self.sent_starts[self.sentence_of(o)] == o

    def flag_of(self, kind, target):
        """The flag on one target (note and when it was set), or None; for the flag button's state."""
        with self.lock:
            return self._flag_row(kind, target)

    def set_flag(self, kind, target, note="", auto=False):
        """Flag a mention, quote, group or sentence, with an optional note; updates the note if it's already flagged.
        `auto` marks a flag the program set (the cleanup import) rather than you; it is kept when the note is edited.
        One undoable step, kept out of the exported change log."""
        if kind not in KINDS:
            raise EditError("Unknown kind of flag")
        target = int(target)
        with self.lock:
            existing = self._flag_row(kind, target)
            if not existing and not self._flag_target_exists(kind, target):    # an existing flag's note can always change
                raise EditError(f"There is no such {KIND_LABEL[kind].lower()} to flag")
            label = f"{'Updated the note on' if existing and existing['note'] != note else 'Flagged'} {KIND_LABEL[kind].lower()}"
            with self.batch(label, kind="review"):
                if existing:
                    self.update("flags", existing["uid"], {"note": note}, manual=False)
                else:
                    self.insert("flags", {"kind": kind, "target": target, "note": note, "auto": int(auto), "created": time.time()}, manual=False)
            return self.history(1)

    def clear_flag(self, kind, target):
        """Remove a flag, if there is one. One undoable step, kept out of the exported change log."""
        with self.lock:
            existing = self._flag_row(kind, target)
            if not existing:
                raise EditError("That isn't flagged")
            with self.batch(f"Removed the flag on {KIND_LABEL.get(kind, kind).lower()}", kind="review"):
                self.delete("flags", existing["uid"])
            return self.history(1)

    def clear_flags(self, items):
        """Remove several flags, given as [{kind, target}], in one undoable step; those that aren't flagged are ignored.
        Raises if none of them was flagged."""
        with self.lock:
            rows = {r["uid"]: r for r in (self._flag_row(i["kind"], i["target"]) for i in items) if r}.values()
            if not rows:
                raise EditError("None of those are flagged")
            with self.batch(f"Removed {len(rows)} flag{'s' if len(rows) != 1 else ''}", kind="review"):
                for r in rows:
                    self.delete("flags", r["uid"])
            return self.history(1)

    def flags_list(self):
        """Every flag, oldest first (`auto`: set by the cleanup import), each with a short description (`label`, and `name`
        without the kind), the sentence it sits in (`sent`) and, where it has a place in the text, a position to jump to
        (`s`..`e`, with the `text` there). A flag whose target no longer exists (a deleted mention, a merged-away group)
        is left out."""
        with self.lock:
            out = []
            for r in self.db.execute("SELECT * FROM flags ORDER BY created"):
                r = dict(r)
                kind, target = r["kind"], r["target"]
                sent = None
                if kind in ("entities", "quotes"):
                    row = self._row(kind, target)
                    if not row:
                        continue
                    s, e = self.ord_of(row["tok_start"]), self.ord_of(row["tok_end"])
                    name = f"“{row['text']}”"
                    sent = self.sentence_of(s)
                elif kind == "groups":
                    c = self.clusters().get(target)
                    if not c:
                        continue
                    s = e = None
                    name = f"“{c['name']}”"
                elif kind == "sentence":
                    s = self.ord_of(target)
                    if s is None:
                        continue
                    sent = self.sentence_of(s)
                    s, e = self.sentence_bounds(sent)
                    name = f"Sentence {sent}"
                else:
                    continue
                out.append({**r, "label": f"{KIND_LABEL[kind]} {name}" if kind != "sentence" else name, "name": name,
                            "sent": sent, "s": s, "e": e, "text": self.text_between(s, e) if s is not None else None})
            return out
