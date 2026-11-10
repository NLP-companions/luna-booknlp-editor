"""The Split tab: one group at a time, its mentions walked in reading order, to split up entities BookNLP ran together.

Mixed into Store (next to EntityAttrTools, whose reading regions it shares, and RuleTools, whose pronoun classes and nearby
candidates it uses).

* `split_groups`: the groups likely to be two entities, each with its reasons: referred to as both he and she (the "mixed"
  check), names with male and female titles (Mr. / Mrs.), two different first names, names that share no word. Groups marked
  as checked or hidden are left out. With a search text, every group whose name matches instead.
* `split_step` / `split_item`: a mention of one group as the view shows it (the Entity-Attribution view's item: the sentence,
  the text above and below with every mention marked), with entities to offer for it (nearby groups of its type, those whose
  pronouns fit first) and its `scopes`: the group's other mentions a move can take along (the same words, the same pronoun
  set, the same paragraph). Mentions kept earlier (confirmed in this group, the Pronoun pass's `confirmed` table) are left
  out of the walk when the settings say so, and always out of the scopes, so a batch move never undoes a decision.

Position: as in the Entity-Attribution view, a mention's place is its index in the book's list of mentions (`pos`).
"""
from __future__ import annotations

from luna.core.errors import EditError
from luna.core.names import name_tokens, name_words, title_gender
from luna.core.tools.rule import PASS_ADVANCE, PRON_CLASS

# the context window, in tokens before and after the mention's sentence, is kept within this
CONTEXT_MAX = 2000
# how many entities are suggested for a mention
SUGGESTIONS = 8
# how many groups the list of likely ones shows
GROUPS_MAX = 300
# the pronoun sets a "same pronouns" move takes along, by class (core/tools/rule.py PRON_CLASS)
PRON_SETS = {"m": "he/him/his", "f": "she/her", "n": "it/its", "p": "they/them", "1": "I/me/my", "1p": "we/us/our", "2": "you/your"}


class SplitTools:
    """The Split tab's data: the groups to look at, and one group's mentions with what a move can take along."""

    def split_settings(self):
        """The tab's settings, kept in the book: whether mentions kept earlier are skipped, and how to advance after a
        keep or a move ('auto' / 'manual')."""
        s = dict(self.meta.get("split") or {})
        s.setdefault("skip_kept", True)
        s.setdefault("advance", "auto")
        return s

    def set_split_settings(self, skip_kept=None, advance=None):
        """Save the tab's settings; what is not given stays as it is."""
        with self.lock:
            s = self.split_settings()
            if advance is not None:
                if advance not in PASS_ADVANCE:
                    raise EditError("Unknown way to advance")
                s["advance"] = advance
            if skip_kept is not None:
                s["skip_kept"] = bool(skip_kept)
            self._set_meta("split", s)
            return s

    # ------------------------------------------------------------ the list
    def split_groups(self, q="", limit=GROUPS_MAX):
        """The groups to offer: {items, total}. Without `q`, the likely ones (most reasons, then most mentions first); with it,
        every group (hidden ones too) whose names match it, most mentions first. Each item is a cluster with its `reasons`."""
        with self.lock:
            cl = self.clusters()
            if q:
                items = [{**c, "reasons": self._split_reasons(c["id"])} for c in self.groups_list(q=q, hidden=True)["items"]]
            else:
                items = [{**c, "reasons": r} for c in cl.values() if not c["hidden"] and not c["checked"]
                         for r in [self._split_reasons(c["id"])] if r]
                items.sort(key=lambda c: (-len(c["reasons"]), -c["count"], c["id"]))
            return {"items": items[:limit], "total": len(items)}

    def _split_reasons(self, cid):
        """Why group `cid` may be more than one entity: a list of short texts (empty when nothing points to it)."""
        out = []
        g = self._group_genders().get(cid) or {}
        if g.get("mixed"):
            n = g["counts"]
            out.append(f"Referred to as he {n.get('m', 0)}× and as she {n.get('f', 0)}×")
        p = self._group_profiles()[0].get(cid)
        return out + (self._name_reasons(list(p["props"]), p["first_names"]) if p else [])

    @classmethod
    def _name_reasons(cls, names, first_names):
        """Why one group's proper `names` (and the `first_names` among them) may belong to more than one entity."""
        out = []
        male = sorted({n for n in names if title_gender(name_tokens(n)[0]) == "m"})
        female = sorted({n for n in names if title_gender(name_tokens(n)[0]) == "f"})
        if male and female:
            out.append(f"Male and female titles ({male[0]} / {female[0]})")
        if len(first_names) >= 2:
            out.append("Different first names (" + ", ".join(sorted(first_names)[:3]) + ")")
        parts = cls._name_parts(names)
        if len(parts) >= 2:
            out.append("Names with no word in common (" + " / ".join(part[0] for part in parts[:3]) + ")")
        return out

    @staticmethod
    def _name_parts(names):
        """The names (proper names of one group) in sets that share a capitalised word, each set as its names, biggest
        first: two or more sets are names with no word in common ("Holmes" / "Watson")."""
        parts = []                                   # [(words, [names])]
        for n in names:
            w = name_words(name_tokens(n)[1])
            if not w:
                continue
            joined = [p for p in parts if p[0] & w]
            words, members = set(w), []
            for p in joined:
                words |= p[0]
                members += p[1]
                parts.remove(p)
            parts.append((words, members + [n]))       # the names in the order they came
        return sorted((p[1] for p in parts), key=len, reverse=True)

    # ------------------------------------------------------------ the walk
    def split_step(self, group, ord_=-1, direction="next", tokens=120, nth=None):
        """The next, previous or current (`direction` 'here': the first at or after `ord_` + 1) mention of `group` from a
        position (see the module note), or the one with number `nth` (from 1) of those walked; it stops at the first and last."""
        with self.lock:
            rows, starts, shown = self._split_walk(group)
            if nth is not None:
                i = int(nth) - 1
            else:
                i = self._pass_index(shown, int(ord_) + (direction == "here"), direction)
            pick = shown[min(max(i, 0), len(shown) - 1)] if shown else None
            return self._split_reply(rows, starts, group, pick, tokens, shown)

    def split_item(self, group, uid, tokens=120):
        """One given mention (to refresh the one shown: it is shown even when it has just left the group or been kept)."""
        with self.lock:
            rows, starts, shown = self._split_walk(group)
            i = next((n for n, r in enumerate(rows) if r["uid"] == int(uid)), None)
            if i is None:
                raise EditError("That mention no longer exists")
            return self._split_reply(rows, starts, group, i, tokens, shown)

    def _split_walk(self, group):
        """(the book's mentions, their starts, the positions of the ones walked): `group`'s mentions, without those kept
        earlier when the settings say so."""
        rows, starts, _ = self._ents()
        try:
            gid = int(group)
        except (TypeError, ValueError):
            raise EditError("Choose a group to split")
        kept = self._kept(gid) if self.split_settings()["skip_kept"] else set()
        return rows, starts, [k for k, r in enumerate(rows) if r["coref"] == gid and r["uid"] not in kept]

    def _kept(self, gid):
        """The uids of mentions kept earlier in group `gid` (confirmed in it, and still in it)."""
        return {r[0] for r in self.db.execute("SELECT uid FROM confirmed WHERE coref=?", (gid,))}

    def _split_reply(self, rows, starts, group, i, tokens, shown):
        """The reply for mention number `i` of the book's mentions (None: nothing to show): the group, its counts and settings,
        and the item (`_eattr_mark` + place + reading regions + candidates + scopes)."""
        gid = int(group)
        c = self.clusters().get(gid)
        kept = self._kept(gid)
        r = {"group": {"id": gid, "name": c["name"], "cat": c["cat"], "count": c["count"], "checked": c["checked"],
                       "reasons": self._split_reasons(gid)} if c else None,
             "shown": len(shown), "kept": len(kept), "settings": self.split_settings(), "item": None}
        if i is None:
            return r
        m = rows[i]
        r["item"] = {**self._eattr_mark(m), "pos": i, "index": shown.index(i) + 1 if i in shown else None,
                     "kept": m["uid"] in kept, **self._eattr_reading(rows, starts, m, tokens, CONTEXT_MAX),
                     "candidates": self._split_candidates(m), "scopes": self._split_scopes(m, gid, kept)}
        return r

    def _split_candidates(self, m):
        """Entities to offer for mention `m`: nearby groups of its own type, those whose pronouns fit first for a pronoun;
        never its own group. Each is {id, name, cat, count, distance, side, fits, reason}."""
        cls = PRON_CLASS.get(m["text"].lower()) if m["prop"] == "PRON" else None
        near = self._gender_candidates(m["s"], m["e"], cls, exclude={m["coref"]}, limit=2 * SUGGESTIONS)
        return [n for n in near if n["cat"] == m["cat"]][:SUGGESTIONS]

    def _split_scopes(self, m, gid, kept):
        """What a move of mention `m` can take along of group `gid` (always with `m` itself, never a mention kept earlier):
        `text` the mentions with the same words (ignoring case), `pron` those of the same pronoun set (a pronoun only; None
        otherwise), `para` those in the same paragraph. Each is {label, uids}."""
        ms = [x for x in self._ents()[2].get(gid, []) if x["uid"] == m["uid"] or x["uid"] not in kept]
        text = m["text"].lower()
        cls = PRON_CLASS.get(text) if m["prop"] == "PRON" else None
        a, b = self._para_bounds(m["s"])
        return {"text": {"label": m["text"], "uids": [x["uid"] for x in ms if x["text"].lower() == text]},
                "pron": {"label": PRON_SETS[cls], "uids": [x["uid"] for x in ms if x["prop"] == "PRON"
                                                           and PRON_CLASS.get(x["text"].lower()) == cls]} if cls else None,
                "para": {"label": "this paragraph", "uids": [x["uid"] for x in ms if a <= x["s"] and x["e"] <= b]}}
