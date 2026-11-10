"""The Speaker-Attribution view: one quote at a time, with the text around it.

Mixed into Store (next to RuleTools, whose Quote tool settings and candidate speakers it shares).

For a quote it works out what the view shows, in reading order over all quotes, or those of one speaker (it ignores the quote
pass's skip rules):

* the quote and its speaker (and the suggested speakers, as in the quote pass) and BookNLP's speaker mention (its entity,
  if it has one: the view can move it to a new group);
* the words just before and after it, "the attribution": the rest of the sentence it sits in ("Mary said," / ", said
  Mary."), never running into a neighbouring quote;
* a context above and below, a number of tokens each, split into passages: every quote in it with its speaker, and the
  stretches of narration between them. Reading each passage's speaker back from the quotes table is what makes the view
  refresh after every attribution.
"""
from __future__ import annotations

import bisect
from collections import Counter

from luna.core.errors import EditError

# the attribution (words just before/after the quote) is at most this many tokens each side
ATTRIBUTION_MAX = 40
# the context window, in tokens each side, is kept within these bounds
CONTEXT_MAX = 2000


class FocusTools:
    """The Speaker-Attribution view's data: a quote with its attribution and its context passages."""

    def qfocus_step(self, ord_, direction="next", tokens=120, speaker="all", nth=None):
        """The next, previous or current quote from a position, over every quote (or only those of one `speaker`: a group
        id, 'none' for no speaker, 'all'); it stops at the first and last. With `nth`, the quote with that number (from 1) among those shown."""
        with self.lock:
            quotes = self._quote_rows()
            shown = self._focus_shown(quotes, speaker)
            i = int(nth) - 1 if nth is not None else self._pass_index([quotes[k]["s"] for k in shown], int(ord_), direction)
            return self._qfocus(quotes, shown[min(max(i, 0), len(shown) - 1)] if shown else None, tokens, shown)

    def qfocus_item(self, uid, tokens=120, speaker="all"):
        """One given quote, as the view shows it (for going back to one already seen, or refreshing the current one; it is
        shown even when it no longer matches the speaker filter, e.g. just after you gave it to someone else)."""
        with self.lock:
            quotes = self._quote_rows()
            i = next((n for n, q in enumerate(quotes) if q["uid"] == int(uid)), None)
            if i is None:
                raise EditError("That quote no longer exists")
            return self._qfocus(quotes, i, tokens, self._focus_shown(quotes, speaker))

    @staticmethod
    def _focus_shown(quotes, speaker):
        """The positions in `quotes` of those the view walks through: all, or one speaker's."""
        if speaker in ("all", "", None):
            return list(range(len(quotes)))
        try:
            want = None if speaker == "none" else int(speaker)
        except ValueError:
            raise EditError("Unknown speaker")
        return [k for k, q in enumerate(quotes) if q["char_id"] == want]

    def _qfocus(self, quotes, i, tokens, shown):
        """The reply for quote number `i` (None: nothing to show), of the `shown` ones: the quote pass's item plus
        attribution, context and the speaker mention, and the speakers for the filter."""
        counts = Counter(q["char_id"] for q in quotes)
        r = {"item": None, "shown": len(shown), "total": len(quotes), "skipped": {}, "settings": self.qpass_settings(),
             "speakers": [{"id": k, "name": self.cluster_name(k), "n": v} for k, v in counts.most_common() if k is not None],
             "no_speaker": counts.get(None, 0)}
        if i is None:
            return r
        n = max(0, min(int(tokens), CONTEXT_MAX))
        q = quotes[i]
        (ba, bb), (aa, ab) = self._attribution(quotes, i)
        starts = [x["s"] for x in quotes]
        cl = self.clusters()
        m = [q["ms"], q["me"]]
        ent = self.db.execute("SELECT uid, text FROM entities WHERE tok_start=? AND tok_end=?", (q["m_start"], q["m_end"])).fetchone()
        r["item"] = {**self._qpass_item(q, shown.index(i) + 1 if i in shown else None),
                     "mention": {"s": m[0], "e": m[1], "uid": ent["uid"] if ent else None, "text": ent["text"] if ent else None}
                     if None not in m else None,
                     "quote": self._passages(quotes, starts, cl, q["s"], q["e"])[0],
                     "before": self._passages(quotes, starts, cl, ba, bb),
                     "after": self._passages(quotes, starts, cl, aa, ab),
                     "above": self._passages(quotes, starts, cl, max(0, ba - n), ba - 1),
                     "below": self._passages(quotes, starts, cl, ab + 1, min(self.n_tokens - 1, ab + n))}
        return r

    def _attribution(self, quotes, i):
        """((a, b), (a, b)): the token ranges just before and just after quote `i` in the sentences it starts and ends in
        ("Mary said," / ", said Mary."), cut at the neighbouring quote and at ATTRIBUTION_MAX tokens. Either may be empty
        (a > b): the text of the neighbouring sentences is in the context."""
        q = quotes[i]
        prev_end = quotes[i - 1]["e"] if i else -1
        next_start = quotes[i + 1]["s"] if i + 1 < len(quotes) else self.n_tokens
        first = self.sentence_bounds(self.sentence_of(q["s"]))[0]
        last = self.sentence_bounds(self.sentence_of(q["e"]))[1]
        a = min(q["s"], max(first, prev_end + 1, q["s"] - ATTRIBUTION_MAX))
        b = max(q["e"], min(last, next_start - 1, q["e"] + ATTRIBUTION_MAX))
        return (a, q["s"] - 1), (q["e"] + 1, b)

    def _words_space(self, a, b):
        """(words, space) of tokens a..b: `space[i]` is 1 when word i has a space before it in the book (from the token offsets)."""
        rows = self.db.execute("SELECT word, char_start, char_end FROM tokens WHERE ord BETWEEN ? AND ? ORDER BY ord", (a, b)).fetchall()
        return [r[0] for r in rows], [int(i > 0 and rows[i][1] > rows[i - 1][2]) for i in range(len(rows))]

    def _passages(self, quotes, starts, cl, a, b):
        """Tokens a..b as passages in reading order: {kind: 'quote'|'narration', start, words, space, uid, speaker, name}
        (`space[i]` is 1 when word i has a space before it in the book; the speaker of a quote is its group, or None;
        narration has no speaker, the view calls it the Narrator). A quote only partly inside the range contributes the
        part that is."""
        if a > b:
            return []
        words, space = self._words_space(a, b)
        part = lambda lo, hi: {"start": lo, "words": words[lo - a:hi - a + 1], "space": space[lo - a:hi - a + 1]}
        out, pos = [], a
        for k in range(max(0, bisect.bisect_right(starts, a) - 1), len(quotes)):
            q = quotes[k]
            if q["s"] > b:
                break
            if q["e"] < a:
                continue
            lo, hi = max(q["s"], a), min(q["e"], b)
            if lo > pos:
                out.append({"kind": "narration", **part(pos, lo - 1)})
            sp = q["char_id"]
            out.append({"kind": "quote", **part(lo, hi), "uid": q["uid"], "speaker": sp,
                        "name": cl[sp]["name"] if sp in cl else None})
            pos = hi + 1
        if pos <= b:
            out.append({"kind": "narration", **part(pos, b)})
        return out
