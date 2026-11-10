"""The Entity-Attribution view: one entity mention at a time, with the text around it.

Mixed into Store (next to FocusTools, whose word fetching it shares, and RuleTools, whose nearby-group candidates it uses).

For a mention it works out what the view shows, in reading order over all mentions (or those of one entity, one mention
type, one entity type; it ignores the pronoun pass's skip rules):

* the mention and its entity, and the entities to offer instead (nearby groups of the mention's own type, those whose
  pronouns fit first for a pronoun; never the current or a pinned one);
* the sentence it sits in (the "core") and a context above and below, a number of tokens each, as running text in
  paragraphs, every entity mention in them marked (its entity, type and mention type) so the view can draw them as the
  annotation view does.

Position: a mention's place in the walk is its index in the whole list of mentions in reading order (`pos`), not its
start token, since nested mentions ("the king", "the king's sister") start at the same token. A query's `ord` is such a place.
"""
from __future__ import annotations

import bisect
from collections import Counter

from luna.core.errors import EditError
from luna.core.tools.rule import PASS_ADVANCE, PRON_CLASS

# the context window, in tokens each side, is kept within these bounds
CONTEXT_MAX = 2000
# how many entities are suggested for a mention
SUGGESTIONS = 5


class EntityAttrTools:
    """The Entity-Attribution view's data: a mention with its sentence, its context and its suggested entities."""

    def eattr_settings(self):
        """The view's settings, kept in the book: how to advance after Keep or a move ('auto'/'manual') and whether
        entities are suggested."""
        s = dict(self.meta.get("eattr") or {})
        s.setdefault("advance", "auto")
        s.setdefault("suggest", True)
        return s

    def set_eattr_settings(self, advance=None, suggest=None):
        """Save the view's settings; what is not given stays as it is."""
        with self.lock:
            s = self.eattr_settings()
            if advance is not None:
                if advance not in PASS_ADVANCE:
                    raise EditError("Unknown way to advance")
                s["advance"] = advance
            if suggest is not None:
                s["suggest"] = bool(suggest)
            self._set_meta("eattr", s)
            return s

    def eattr_step(self, ord_, direction="next", tokens=120, group="all", prop="all", cat="all", tok=None, nth=None):
        """The next, previous or current mention from a position (see the module note; for 'here' the position is the one
        before the wanted mention, as the pass engine asks for it), over every mention, or those of one entity (`group`:
        an id), one mention type (`prop`: PROP, NOM, PRON) and one entity type (`cat`); it stops at the first and last.
        With `tok`, the first mention starting after that token instead (to begin at a place in the text); with `nth`, the
        one with that number (from 1) among those shown."""
        with self.lock:
            rows, starts, _ = self._ents()
            shown = self._eattr_shown(rows, group, prop, cat)
            if tok is not None:
                ord_, direction = bisect.bisect_right(starts, int(tok)) - 1, "next"
            if nth is not None:
                i = int(nth) - 1
            else:
                i = self._pass_index(shown, int(ord_) + (direction == "here"), direction)
            return self._eattr(rows, starts, shown[min(max(i, 0), len(shown) - 1)] if shown else None, tokens, shown)

    def eattr_item(self, uid, tokens=120, group="all", prop="all", cat="all"):
        """One given mention, as the view shows it (for refreshing the current one; it is shown even when it no longer
        matches the filters, e.g. just after you moved it to another entity)."""
        with self.lock:
            rows, starts, _ = self._ents()
            i = next((n for n, r in enumerate(rows) if r["uid"] == int(uid)), None)
            if i is None:
                raise EditError("That mention no longer exists")
            return self._eattr(rows, starts, i, tokens, self._eattr_shown(rows, group, prop, cat))

    @staticmethod
    def _eattr_shown(rows, group, prop, cat):
        """The positions in `rows` of the mentions the view walks through (those passing the filters), in order."""
        try:
            want = None if group in ("all", "", None) else int(group)
        except ValueError:
            raise EditError("Unknown entity")
        return [k for k, r in enumerate(rows) if (want is None or r["coref"] == want)
                and prop in ("all", "", None, r["prop"]) and cat in ("all", "", None, r["cat"])]

    def _eattr(self, rows, starts, i, tokens, shown):
        """The reply for mention number `i` (None: nothing to show), of the `shown` ones: the item plus the counts that fill the filters.
        `starts` are the mentions' start positions (from `_ents`, for bisect)."""
        r = {"item": None, "shown": len(shown), "total": len(rows), "skipped": {}, "settings": self.eattr_settings(),
             "props": dict(Counter(x["prop"] for x in rows)), "cats": dict(Counter(x["cat"] for x in rows))}
        if i is None:
            return r
        m = rows[i]
        r["item"] = {**self._eattr_mark(m), "pos": i, "index": shown.index(i) + 1 if i in shown else None,
                     "candidates": self._eattr_candidates(m), **self._eattr_reading(rows, starts, m, tokens)}
        return r

    def _eattr_reading(self, rows, starts, m, tokens, most=CONTEXT_MAX):
        """The text around mention `m` as the attribution views draw it: the sentence (or sentences) it sits in (`core`) and
        `tokens` tokens before and after it (`above`, `below`; at most `most`), each an `_eattr_region`. Also used by the
        Fragments pane (core/tools/coref.py `fragment_detail`)."""
        n = max(0, min(int(tokens), most))
        a = self.sentence_bounds(self.sentence_of(m["s"]))[0]
        b = self.sentence_bounds(self.sentence_of(m["e"]))[1]
        return {"core": self._eattr_region(rows, starts, a, b),
                "above": self._eattr_region(rows, starts, max(0, a - n), a - 1),
                "below": self._eattr_region(rows, starts, b + 1, min(self.n_tokens - 1, b + n))}

    def _eattr_mark(self, m):
        """A mention as the view draws it: {uid, s, e, text, group, group_name, cat, prop}."""
        c = self.clusters().get(m["coref"])
        return {"uid": m["uid"], "s": m["s"], "e": m["e"], "text": m["text"], "group": m["coref"],
                "group_name": c["name"] if c else f"#{m['coref']}", "cat": m["cat"], "prop": m["prop"]}

    def _eattr_region(self, rows, starts, a, b):
        """Tokens a..b as running text: {start, words, space, brk, marks}; `brk` lists the word indexes that open a new
        paragraph (other than the first), `marks` every mention overlapping the range (the view clips it)."""
        if a > b:
            return {"start": a, "words": [], "space": [], "brk": [], "marks": []}
        words, space = self._words_space(a, b)
        para = [self.sent_para[self.sentence_of(o)] for o in range(a, b + 1)]
        marks = []
        longest = self._memo("longest_mention", None, lambda: max((r["e"] - r["s"] for r in rows), default=0))
        for m in rows[bisect.bisect_left(starts, a - longest):]:     # a mention starting before a may reach into it
            if m["s"] > b:
                break
            if m["e"] >= a:
                marks.append(self._eattr_mark(m))
        return {"start": a, "words": words, "space": space, "marks": marks,
                "brk": [k for k in range(1, len(para)) if para[k] != para[k - 1]]}

    def _eattr_candidates(self, m):
        """Up to SUGGESTIONS entities to offer for mention `m`: groups mentioned nearby that are of the mention's own
        type, those whose pronouns fit first when it is a he/she/it/they pronoun; never its own group or a pinned one
        (the pinned ones already have keys). Each is {id, name, cat, count, hidden, distance, side, fits, reason}."""
        if not self.eattr_settings()["suggest"]:
            return []
        pinned = {v["id"] for v in self.hotkeys().values()}
        cls = PRON_CLASS.get(m["text"].lower()) if m["prop"] == "PRON" else None
        near = self._gender_candidates(m["s"], m["e"], cls, exclude=pinned | {m["coref"]}, limit=16)
        return [c for c in near if c["cat"] == m["cat"]][:SUGGESTIONS]
