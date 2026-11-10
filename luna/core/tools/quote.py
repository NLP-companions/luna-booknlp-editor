"""Speaker suggestions for quotes.

Mixed into Store. For each quote, candidate speakers are scored from:
  * an attribution tag next to the quote ("…," said Holmes / Holmes said, "…" / "…" he asked),
    read from the dependency parse (the speech verb's subject);
  * the quote before it in the same paragraph (a quote split by a tag, or a speech that goes on);
  * turn-taking in a conversation (A, B, A, B when paragraphs change and there is no tag);
  * a name just before the quote in the same paragraph (only for quotes without a speaker).
Evidence against a speaker: being addressed by name in the quote ("Watson, you had better stay"),
BookNLP's speaker mention lying inside the quote itself, or far away; the same candidate having spoken the untagged
turn right before, with nothing narrated in between (a real conversation rarely repeats a speaker like that).
"Sounds like": the quote's content words compared with each candidate's other quotes in this book, and with a linked
character's quotes in the collection's other books (tf-idf over the speakers, so rare words count more).
Every weight, the margin and the minimum come from the settings (core/suggest.py, type "speaker").
"""
from __future__ import annotations

import bisect
import math
from collections import Counter, defaultdict

from luna.core import profiles as P
from luna.core import suggest
from luna.core.errors import EditError
from luna.core.speakers import MentionFinder

SPEECH_VERBS = set("""say ask reply answer cry exclaim remark continue add whisper shout murmur mutter observe return
rejoin repeat call explain protest insist respond retort inquire enquire begin declare suggest tell interrupt laugh
sigh groan gasp stammer stutter scream roar growl snap demand urge plead beg venture agree admit confess announce
warn sob breathe hiss bellow yell drawl chuckle cry query object remonstrate expostulate interpose resume conclude
concede persist pursue whimper wail moan grumble complain shriek howl thunder bark squeak lisp babble chatter
murmur mumble""".split())
QUOTE_MARKS = {'"', "``", "''", "“", "”", "‘", "’", "'"}


def quote_words(T, quotes):
    """{quote uid: Counter of its content lemmas} (nouns, verbs, adjectives, adverbs; not function words), what "sounds like"
    compares."""
    last = len(T["word"]) - 1
    return {q["uid"]: Counter(T["lemma"][i] for i in range(q["s"], min(q["e"], last) + 1)
                              if T["pos"][i] in P.CONTENT_POS and T["lemma"][i].isalpha() and T["lemma"][i] not in P.FUNCTION_SET)
            for q in quotes}


class SoundsLike:
    """How much a quote's content words sound like each candidate speaker: tf-idf cosine of the quote's content lemmas
    against the candidate's other quotes in this book, and against a linked character's quotes in the collection's other
    books; idf is taken over all those speakers, so rare words count more. A quote never counts for itself."""

    def __init__(self, qwords, quotes, weights, collection, name):
        """`qwords`: each quote's content words (`quote_words`); `weights`: (this book, collection); `collection`: {group:
        Counter of content words}; `name(group)` for reasons."""
        self.wb, self.wc = weights
        self.name = name
        self.qwords = qwords
        self.book = defaultdict(Counter)
        for q in quotes:
            if q["char_id"] is not None:
                self.book[q["char_id"]].update(self.qwords[q["uid"]])
        self.coll = collection
        self._norms = {}
        docs = [*self.book.values(), *collection.values()]
        df = Counter(w for d in docs for w in d)
        n = len(docs) or 1
        self.idf = {w: math.log((n + 1) / (k + 1)) + 1 for w, k in df.items()}
        self.max_idf = math.log(n + 1) + 1

    def _vec(self, counts):
        """Counts as a unit tf-idf vector."""
        v = {w: k * self.idf.get(w, self.max_idf) for w, k in counts.items() if k > 0}
        norm = math.sqrt(sum(x * x for x in v.values()))
        return {w: x / norm for w, x in v.items()} if norm else {}

    def _norm2(self, key, counts):
        """The squared length of a speaker's tf-idf vector, worked out once per speaker (`key` names the speaker's counts)."""
        if key not in self._norms:
            self._norms[key] = sum((k * self.idf.get(w, self.max_idf)) ** 2 for w, k in counts.items() if k > 0)
        return self._norms[key]

    def _compare(self, qv, counts, key, weight, where, g, minus=None):
        """One kind of "sounds like" as (weight × similarity, reason), or None when it is too slight to show.

        The similarity is the cosine of the quote's unit vector `qv` with the speaker's tf-idf vector (their `counts`, less
        the quote's own words `minus`). It is read off the quote's words alone, with the speaker's length kept from before,
        so scoring a quote costs the size of the quote, not of the speaker's vocabulary."""
        norm2 = self._norm2(key, counts)
        for w, m in (minus or {}).items():                   # the quote's own words leave the speaker's vector
            c = counts.get(w, 0)
            if c:
                idf = self.idf.get(w, self.max_idf)
                norm2 -= (c * idf) ** 2 - ((c - m) * idf) ** 2
        if norm2 <= 1e-12:
            return None
        norm = math.sqrt(norm2)
        parts = {}
        for w, x in qv.items():
            c = counts.get(w, 0) - (minus.get(w, 0) if minus else 0)
            if c > 0:
                parts[w] = x * c * self.idf.get(w, self.max_idf) / norm
        sim = sum(parts.values())
        if weight * sim < 0.05:
            return None
        shared = sorted(parts, key=lambda w: -parts[w])[:3]
        return weight * sim, f"Sounds like {self.name(g)}{where} ({round(100 * sim)}%: {', '.join(shared)})"

    def like(self, q, g):
        """[(weight × similarity, reason)] for quote `q` and candidate speaker `g`."""
        qwords = self.qwords.get(q["uid"])
        if not qwords or not (self.wb or self.wc):
            return []
        qv, out = self._vec(qwords), []
        mine = qwords if q["char_id"] == g else None          # the quote itself is no evidence for its current speaker
        for kind, counts, weight, where, minus in (("book", self.book.get(g), self.wb, "’s other quotes", mine),
                                                   ("collection", self.coll.get(g), self.wc, " in the other books", None)):
            if weight and counts:
                r = self._compare(qv, counts, (kind, g), weight, where, g, minus)
                if r:
                    out.append(r)
        return out


class SpeakerContext:
    """What scoring the speakers of any quote needs from the whole book, gathered once per edit (`QuoteTools._speaker_context`):
    the parse as lists, the groups, the settings, the mentions, the quotes with which of them covers each token, who spoke
    last in the same paragraph, the conversations and the "sounds like" statistics. Attribution tags are found per quote
    when first needed, and so are the scores (`scores`, filled by `QuoteTools._quote_score`; `complete` once all are)."""

    def __init__(self, store):
        """Gather it from `store` (a Store)."""
        self.T = T = store._tok_arrays()
        self.cl = cl = store.clusters()
        self.cfg = cfg = store.suggest_cfg("speaker")
        self.W = lambda k: suggest.weight(cfg, k)
        self.ents, self.starts, _ = store._ents()
        self.quotes = quotes = store._quote_rows()
        self.by_uid = {q["uid"]: q for q in quotes}
        self.name = lambda c: cl[c]["name"] if c in cl else f"#{c}"
        self.sounds = SoundsLike(store._quote_words(), quotes, (self.W("p_words_book"), self.W("p_words_collection")),
                                 store._collection_speech_words() if self.W("p_words_collection") else {}, self.name)
        n = len(T["word"])
        self.inq = bytearray(n)
        for q in quotes:
            self.inq[q["s"]:min(q["e"], n - 1) + 1] = b"\x01" * (min(q["e"], n - 1) + 1 - q["s"])
        self.conv_of = {q["uid"]: (conv, i) for conv in store._conversations(quotes) for i, q in enumerate(conv)}
        self.prev_in_para = {b["uid"]: a for a, b in zip(quotes, quotes[1:]) if T["para"][a["s"]] == T["para"][b["s"]]}
        self._find_tag = store._find_tag
        self._tags = {}
        self.scores = {}
        self.complete = False

    def ents_in(self, a, b):
        """Mentions lying completely inside token positions a..b."""
        ents, i, out = self.ents, bisect.bisect_left(self.starts, a), []
        while i < len(ents) and ents[i]["s"] <= b:
            if ents[i]["e"] <= b:
                out.append(ents[i])
            i += 1
        return out

    def tag(self, q):
        """The attribution tag next to quote row `q` (see `QuoteTools._find_tag`), found once."""
        if q["uid"] not in self._tags:
            self._tags[q["uid"]] = self._find_tag(self.T, q, self.inq, self.ents_in)
        return self._tags[q["uid"]]


class QuoteTools:
    """Speaker suggestions for quotes, mixed into Store. Everything is derived from the parse and the entities and cached until an edit; only dismissals are stored (meta)."""
    # ------------------------------------------------------------ token arrays (cached until the next edit)
    def _tok_arrays(self):
        """Token columns as plain lists (word, lemma, pos, dep, head position, paragraph), cached."""
        return self._memo("tokens", None, self._build_tok_arrays)

    def _build_tok_arrays(self):
        """Read the tokens table once into per-column lists, with each token's head as a position and its paragraph number."""
        rows = self.db.execute("SELECT uid, ord, word, lemma, pos, dep, head, para_start FROM tokens ORDER BY ord").fetchall()
        ord_of = {r["uid"]: r["ord"] for r in rows}
        T = {"word": [], "lemma": [], "pos": [], "dep": [], "head": [], "para": []}
        para = -1
        for i, r in enumerate(rows):
            if i == 0 or r["para_start"]:
                para += 1
            T["word"].append(r["word"])
            T["lemma"].append((r["lemma"] or "").lower())
            T["pos"].append(r["pos"] or "")
            T["dep"].append(r["dep"] or "")
            T["head"].append(ord_of.get(r["head"], i))
            T["para"].append(para)
        return T

    @staticmethod
    def _head_in_range(T, s, e):
        """The token of a span whose head lies outside the span (the span's syntactic head)."""
        for i in range(s, e + 1):
            if T["head"][i] < s or T["head"][i] > e:
                return i
        return e

    # ------------------------------------------------------------ attribution tags
    def _find_tag(self, T, q, inq, ents_in):
        """The speech verb and its subject mention right after or right before a quote."""
        n = len(T["word"])
        para = T["para"][q["s"]]
        # after: "…," said Holmes   /   "…," Holmes said   /   "…" he asked
        hi = q["e"]
        while hi + 1 < n and hi - q["e"] < 10 and T["para"][hi + 1] == para and not inq[hi + 1]:
            hi += 1
        cands = []
        verbs = [i for i in range(q["e"] + 1, hi + 1) if T["lemma"][i] in SPEECH_VERBS and T["pos"][i] in ("VERB", "AUX")]
        if verbs:
            cands.append((verbs[0], "after", q["e"] + 1, min(hi, verbs[0] + 6)))
        # before: Holmes said, "…"   /   she said, "and …"
        lo = q["s"]
        while lo - 1 >= 0 and q["s"] - lo < 12 and T["para"][lo - 1] == para and not inq[lo - 1]:
            lo -= 1
        verbs = [i for i in range(lo, q["s"]) if T["lemma"][i] in SPEECH_VERBS and T["pos"][i] in ("VERB", "AUX")]
        if verbs:
            v = verbs[-1]
            between = range(v + 1, q["s"])
            if all(T["pos"][i] == "PUNCT" or T["word"][i] in QUOTE_MARKS for i in between) or len(between) <= 2:
                cands.append((v, "before", lo, q["s"] - 1))
        for v, side, a, b in cands:
            ms = ents_in(a, b)
            for m in ms:  # the verb's subject, from the parse
                h = self._head_in_range(T, m["s"], m["e"])
                if T["head"][h] == v and T["dep"][h] in ("nsubj", "nsubjpass"):
                    return {"m": m, "v": v, "side": side, "parse": True}
            for m in ms:  # right next to the verb ("said Holmes", "Holmes said")
                if m["s"] == v + 1 or m["e"] == v - 1:
                    return {"m": m, "v": v, "side": side, "parse": False}
        return None

    def _addressed(self, T, q, ents_in, cl):
        """Groups addressed by name in the quote: "Watson, …" or "…, Mrs. Hudson." """
        out = {}
        for m in ents_in(q["s"] + 1, q["e"] - 1):
            if m["prop"] == "PRON" or cl.get(m["coref"], {}).get("cat") != "PER":
                continue
            first = q["s"] + 1
            while first < q["e"] and T["word"][first] in QUOTE_MARKS:
                first += 1
            after = T["word"][m["e"] + 1] if m["e"] + 1 <= q["e"] else ""
            before = T["word"][m["s"] - 1] if m["s"] - 1 >= q["s"] else ""
            if after in {",", "!", "?", ".", ";", "—", "--"} and (m["s"] == first or before in {",", "!", "?", ".", ";", ":", "—", "--", "O", "oh", "Oh"} or before in QUOTE_MARKS):
                out[m["coref"]] = m
        return out

    def _collection_speech_words(self):
        """For each group linked to a collection character: the content words of that character's quotes in the
        collection's other books (from their profiles). Empty for a book not opened from the library."""
        if not self.carry_colls or not self.carry_key:
            return {}
        entries = self.carry_colls.entries(self.carry_key)
        me, out = self.meta.get("book_id"), {}
        for cid, c in self.clusters().items():
            e = entries.get(c.get("carry"))
            if e:
                words = P.combine(p for b, p in (e[2].get("profiles") or {}).items() if b != me)["speech"]["content"]
                if words:
                    out[cid] = Counter(words)
        return out

    # ------------------------------------------------------------ scoring
    def _score_quotes(self):
        """The quotes whose best-scored speaker is worth suggesting: where it differs from BookNLP's (kind 'other'), where
        BookNLP has none ('none') or where its own choice scores below zero ('doubt'), in reading order."""
        return [s for s in self._scored().values() if s["kind"]]

    def _scored(self):
        """The scores of every quote with any evidence (see `_score_quote`), by quote uid, in reading order. Each quote is
        scored once per edit; the Quotes tab asks for all of them, the Quote tool only for the one it shows."""
        ctx = self._speaker_context()
        if not ctx.complete:
            for q in ctx.quotes:
                self._quote_score(ctx, q)
            ctx.complete = True
        return {q["uid"]: ctx.scores[q["uid"]] for q in ctx.quotes if ctx.scores[q["uid"]]}

    def _quote_score(self, ctx, q):
        """The score of quote row `q` (from `ctx.quotes`), worked out the first time it's asked for after an edit."""
        if q["uid"] not in ctx.scores:
            ctx.scores[q["uid"]] = self._score_quote(ctx, q)
        return ctx.scores[q["uid"]]

    def _quote_words(self):
        """Each quote's content words (`quote_words`). They depend on the parse and the quotes' bounds only, so they are
        kept across edits that change neither (a new speaker, a regrouped mention): the cache is one of TOKEN_MEMOS, and its
        key is every quote's bounds."""
        quotes = self._quote_rows()
        return self._memo("quote_words", tuple((q["uid"], q["s"], q["e"]) for q in quotes),
                          lambda: quote_words(self._tok_arrays(), quotes))

    def _speaker_context(self):
        """What scoring a quote's speakers needs from the whole book (`SpeakerContext`), worked out once per edit."""
        return self._memo("speaker_ctx", self.settings_version(), lambda: SpeakerContext(self))

    def _score_quote(self, ctx, q):
        """Score the candidate speakers of one quote from the evidence listed in the module header, or None when there is
        no evidence at all. A result has the scores and the reasons for and against each candidate, the mention to link
        for each, and a `kind`: 'other' (the best candidate differs from BookNLP's), 'none' (BookNLP has none) or 'doubt'
        (its own choice scores below zero), else None: the quote is fine as it is, but its scores can still rank
        suggestions (`quote_candidates`)."""
        T, W, name = ctx.T, ctx.W, ctx.name
        cands = defaultdict(list)   # group -> [(weight, reason)]
        mention_for = {}            # group -> entity uid to link as the speaker mention
        repeat_candidate = None     # group that spoke the untagged turn right before, no narration between
        cur = q["char_id"]
        tag = ctx.tag(q)
        if tag:
            m = tag["m"]
            w = W("tag_name") if m["prop"] == "PROP" else W("tag_noun") if m["prop"] == "NOM" else W("tag_pronoun")
            if not tag["parse"]:
                w -= W("tag_unparsed")
            verb = T["word"][tag["v"]]
            phrase = f"{verb} {m['text']}" if tag["side"] == "after" and m["s"] > tag["v"] else f"{m['text']} {verb}"
            where = "right after the quote" if tag["side"] == "after" else "just before the quote"
            cands[m["coref"]].append((w, f"“{phrase}” {where}"))
            mention_for[m["coref"]] = m["uid"]
        else:
            pq = ctx.prev_in_para.get(q["uid"])
            if pq and pq["char_id"] is not None:
                cands[pq["char_id"]].append((W("continues"), f"Goes on from the quote before it in the same paragraph ({name(pq['char_id'])})"))
            elif q["uid"] in ctx.conv_of:
                conv, i = ctx.conv_of[q["uid"]]
                if i >= 2:
                    q1, q2 = conv[i - 1], conv[i - 2]
                    # a genuine alternation: two different, untagged speakers on the table, not one speaker's
                    # monologue running on across a paragraph break (which has no rival candidate to weigh against)
                    if (T["para"][q1["s"]] != T["para"][q["s"]] and T["para"][q2["s"]] != T["para"][q1["s"]]
                            and q1["char_id"] is not None and q2["char_id"] is not None and q1["char_id"] != q2["char_id"]
                            and ctx.tag(q1) is None):
                        cands[q2["char_id"]].append((W("turns"), f"Turns alternate: {name(q1['char_id'])} spoke just before, {name(q2['char_id'])} before that"))
                        if T["para"][q["s"]] - T["para"][q1["e"]] == 1:
                            repeat_candidate = q1["char_id"]
            if cur is None and not cands:
                before = [e for e in ctx.ents_in(max(0, q["s"] - 40), q["s"] - 1)
                          if e["prop"] == "PROP" and T["para"][e["s"]] == T["para"][q["s"]] and not ctx.inq[e["s"]]
                          and ctx.cl.get(e["coref"], {}).get("cat") == "PER"]
                if before:
                    e = before[-1]
                    cands[e["coref"]].append((W("named_before"), f"“{e['text']}” is named just before the quote"))
                    mention_for.setdefault(e["coref"], e["uid"])
        if cur is not None:
            cands[cur].append((W("booknlp"), "BookNLP’s choice"))
            ms, me = q["ms"], q["me"]
            if ms is not None and me is not None:       # BookNLP's speaker mention (None when there is none)
                if q["s"] <= ms and me <= q["e"]:
                    cands[cur].append((-W("booknlp_inside"), "BookNLP’s speaker mention is inside the quote itself"))
                else:
                    d = q["s"] - me if me < q["s"] else ms - q["e"]
                    if T["para"][ms] != T["para"][q["s"]]:
                        cands[cur].append((-W("booknlp_far"), f"BookNLP linked it through a mention in another paragraph ({d} words away)"))
                    elif d > 50:
                        cands[cur].append((-W("booknlp_far"), f"BookNLP linked it through a mention {d} words away"))
        if repeat_candidate is not None and repeat_candidate in cands:
            cands[repeat_candidate].append((-W("repeats"),
                f"{name(repeat_candidate)} spoke the turn just before, with nothing narrated in between"))
        for g, m in self._addressed(T, q, ctx.ents_in, ctx.cl).items():
            if g in cands:
                cands[g].append((-W("addressed"), f"Is addressed by name in the quote (“{m['text']}”)"))
        for g in list(cands):
            for w, why in ctx.sounds.like(q, g):
                cands[g].append((w, why))
        cands = {g: [(round(w, 2), why) for w, why in rs if w] for g, rs in cands.items()}
        cands = {g: rs for g, rs in cands.items() if rs}
        scores = {g: round(sum(w for w, _ in rs), 2) for g, rs in cands.items()}
        if not scores:
            return None
        best = max(scores, key=lambda g: (scores[g], g == cur))
        cur_score = scores.get(cur, 0.0) if cur is not None else 0.0
        kind = None
        if best != cur:
            if cur is None and scores[best] >= ctx.cfg["thresholds"]["min_none"]:
                kind = "none"
            elif cur is not None and scores[best] - cur_score >= ctx.cfg["thresholds"]["margin"]:
                kind = "other"
        elif cur is not None and cur_score < 0:
            kind = "doubt"
        strong_tag = bool(tag and best == tag["m"]["coref"] and tag["m"]["prop"] in ("PROP", "NOM") and tag["parse"])
        return {"quote": q, "cur": cur, "cur_score": cur_score, "best": None if kind == "doubt" else best,
                "scores": scores, "reasons": {g: sorted(rs, key=lambda r: -r[0]) for g, rs in cands.items()},
                "mention_for": mention_for, "kind": kind, "strong_tag": strong_tag and kind != "doubt"}

    # ------------------------------------------------------------ speakers offered by the Quote tool
    CONVERSATION_MAX = 3        # at most this many of the offered speakers come from the conversation

    def quote_candidates(self, q, exclude, sources, limit):
        """Up to `limit` speakers to offer for quote row `q` (never those in `exclude`), from the chosen `sources`, each
        giving what it finds before the next one fills what is left:
          evidence      the speakers with positive evidence, best score first (the Speaker suggestions' scoring);
          conversation  the other speakers of the quote's conversation, nearest quote first (at most CONVERSATION_MAX);
          nearby        groups mentioned near the quote, nearest first.
        Each is {id, name, cat, count, hidden, source, reason}; evidence and conversation leave out groups marked as not a
        character."""
        cl = self.clusters()
        out, seen = [], set(exclude)

        def add(g, source, reason):
            """Offer group `g` unless it is taken, gone, hidden or there is no room."""
            if g in seen or g not in cl or cl[g]["hidden"] or len(out) >= limit:
                return
            seen.add(g)
            c = cl[g]
            out.append({"id": g, "name": c["name"], "cat": c["cat"], "count": c["count"], "hidden": c["hidden"],
                        "source": source, "reason": reason})
        if "evidence" in sources:
            ctx = self._speaker_context()
            s = self._quote_score(ctx, ctx.by_uid[q["uid"]]) if q["uid"] in ctx.by_uid else None
            for g, sc in sorted(((g, sc) for g, sc in (s["scores"].items() if s else ()) if sc > 0), key=lambda x: -x[1]):
                add(g, "evidence", f"Score {sc:g} · {max(s['reasons'][g], key=lambda r: r[0])[1]}")
        if "conversation" in sources:
            conv, i = self._conversation_of(q["uid"])
            near = sorted((j for j in range(len(conv)) if j != i), key=lambda j: (abs(j - i), j > i))
            for j in near:
                d = abs(j - i)
                when = ("the quote just before" if d == 1 else f"{d} quotes before") if j < i else ("the next quote" if d == 1 else f"{d} quotes after")
                if conv[j]["char_id"] is not None and len(out) < limit and sum(x["source"] == "conversation" for x in out) < self.CONVERSATION_MAX:
                    add(conv[j]["char_id"], "conversation", f"Speaks {when} in this conversation")
        if "nearby" in sources and len(out) < limit:
            for g in self.nearby_groups(q["s"], q["e"], limit=limit - len(out), exclude=seen):
                out.append({**{k: g[k] for k in ("id", "name", "cat", "count", "hidden")}, "source": "nearby",
                            "reason": f"{g['distance']} words {g['side']}"})
        return out

    def _conversation_of(self, uid):
        """(the run of quotes (see `_conversations`) that holds quote `uid`, its position in it)."""
        for conv in self._conversations():
            for i, x in enumerate(conv):
                if x["uid"] == uid:
                    return conv, i
        return [], 0

    def _ctx_q(self, q, pad=30):
        """The words around a quote (30 either side) for the suggestion card."""
        ca, cb = max(0, q["s"] - pad), min(self.n_tokens - 1, q["e"] + pad)
        return {"words": self.words_between(ca, cb), "start": ca, "s": q["s"], "e": q["e"]}

    BUNDLE_KINDS = (("none", "No speaker yet, and an attribution tag names one"),
                    ("other", "The attribution tag names someone other than BookNLP’s speaker"))

    def quote_suggestions(self, limit=300, offset=0, bundles=True):
        """A page of the suggestion list for the Quotes view (`offset`, `limit`), the counts, and the 'bundles': quotes whose
        attribution tag names someone clearly, to apply together. `bundles=False` leaves out the bundles' quotes (each with
        its context: most of the reply on a long book) and gives only their number, `n_bundles`."""
        with self.lock:
            items = self._memo("quote_sugs", (len(self.meta.get("dismissed_quote_sugs", [])), self.settings_version()), self._quote_suggestions_all)
            out = []
            for kind, title in self.BUNDLE_KINDS:
                its = [i for i in items if i["strong_tag"] and i["kind"] == kind]
                if its:
                    out.append({"kind": kind, "title": title, "n": len(its),
                                "items": [{"uid": i["uid"], "s": i["s"], "text": i["text"], "cur": i["cur"], "best": i["best"],
                                           "mention": (i["best_mention"] or {}).get("uid"), "ctx": i["ctx"]} for i in its]})
            offset = max(0, int(offset))
            return {"total": len(items), "offset": offset, "items": items[offset:offset + limit], "bundles": out if bundles else [],
                    "n_bundles": len(out), "by_kind": dict(Counter(i["kind"] for i in items))}

    def _quote_suggestions_all(self):
        """Turn the scores into cards: current and suggested speaker with reasons, alternatives, mention to link. Dismissed ones are left out."""
        cl = self.clusters()
        dismissed = set(self.meta.get("dismissed_quote_sugs", []))
        g = lambda c: None if c is None else {"id": c, "name": cl[c]["name"] if c in cl else f"#{c}",
                                              "cat": cl[c]["cat"] if c in cl else "", "count": cl[c]["count"] if c in cl else 0}
        out = []
        by_uid = {e["uid"]: e for e in self._ents()[0]}
        for s in self._score_quotes():
            q = s["quote"]
            if f"{q['uid']}:{s['best']}" in dismissed:
                continue
            alts = [c for c in sorted(s["scores"], key=lambda c: -s["scores"][c]) if c not in (s["best"], s["cur"])]
            near = [x["id"] for x in self.nearby_groups(q["s"], q["e"], window=200, limit=10)
                    if x["cat"] == "PER" and not x["hidden"] and x["id"] not in (s["best"], s["cur"]) and x["id"] not in alts]
            ms, me = q["ms"], q["me"]
            sug_m = s["mention_for"].get(s["best"])
            sug_ms = by_uid.get(sug_m) if sug_m else None
            out.append({
                "key": f"{q['uid']}:{s['best']}", "uid": q["uid"], "s": q["s"], "e": q["e"], "kind": s["kind"],
                "text": q["text"], "sent": self.sentence_of(q["s"]), "ctx": self._ctx_q(q),
                "cur": g(s["cur"]), "cur_score": s["cur_score"],
                "cur_reasons": [{"w": w, "text": t} for w, t in s["reasons"].get(s["cur"], [])] if s["cur"] is not None else [],
                "cur_mention": {"s": ms, "e": me} if ms is not None else None,
                "best": g(s["best"]), "best_score": s["scores"].get(s["best"]) if s["best"] is not None else None,
                "best_reasons": [{"w": w, "text": t} for w, t in s["reasons"].get(s["best"], [])] if s["best"] is not None else [],
                "best_mention": {"uid": sug_m, "s": sug_ms["s"], "e": sug_ms["e"]} if sug_ms else None,
                "alternatives": [dict(g(c), score=s["scores"][c], reason=s["reasons"][c][0][1], mention=s["mention_for"].get(c))
                                 for c in alts][:4] + [dict(g(c), score=None, reason="Mentioned nearby", mention=None) for c in near][:max(0, 5 - len(alts))],
                "strong_tag": s["strong_tag"],
            })
        order = {"other": 0, "none": 1, "doubt": 2}
        out.sort(key=lambda i: (order[i["kind"]] if not i["strong_tag"] else -1, i["s"]))
        return out

    # ------------------------------------------------------------ actions
    def apply_quote_suggestions(self, items):
        """items: [{quote, speaker (group id or None), mention (entity uid, optional)}] in one undoable step."""
        with self.lock:
            items = [i for i in items if i.get("quote") is not None]
            if not items:
                raise EditError("Nothing to change")
            if len(items) == 1:
                q = self._row("quotes", int(items[0]["quote"]))
                sp = items[0].get("speaker")
                label = f"Quote “{(q or {}).get('text', '')[:40]}” now spoken by {self.cluster_name(sp) if sp is not None else 'no one'}"
            else:
                label = f"Speaker suggestions: set the speaker of {len(items)} quotes"
            changed = 0
            with self.batch(label):
                finder = MentionFinder(self.db)
                for it in items:
                    quid = int(it["quote"])
                    if not self._row("quotes", quid):
                        continue
                    sp = it.get("speaker")
                    ment = it.get("mention")
                    ent = self._row("entities", int(ment)) if ment is not None else None
                    if ent is not None and (sp is None or ent["coref"] == int(sp)):
                        self.update("quotes", quid, {"m_start": ent["tok_start"], "m_end": ent["tok_end"],
                                                     "m_phrase": ent["text"], "char_id": ent["coref"]})
                    else:
                        self._set_speaker(quid, None if sp is None else int(sp), finder)
                    changed += 1
            return {"history": self.history(1), "changed": changed}

    def dismiss_quote_suggestion(self, key):
        """Keep BookNLP's speaker for this quote; the same suggestion won't come back."""
        with self.lock:
            key, d = str(key), list(self.meta.get("dismissed_quote_sugs", []))
            if key not in d:
                d.append(key)
            self._set_meta("dismissed_quote_sugs", d)
            return {"ok": True}
