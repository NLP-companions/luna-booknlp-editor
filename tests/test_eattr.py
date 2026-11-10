"""The Entity-Attribution view: walking over the mentions, the filters, the sentence and context with their marks,
and the suggested entities."""
from __future__ import annotations

from luna.core.errors import EditError
from tests.fixture import MAIN, Book, BookCase

# MAIN with a mention nested at the start of "The violin" (a second one starting on the same token)
NESTED = Book(MAIN.text, MAIN.sentences, MAIN.para_starts, MAIN.entities + [(7, 0, 0, "NOM", "FAC", 5)],
              MAIN.supersenses, MAIN.quotes, MAIN.genders)


class EntityAttribution(BookCase):
    def walk(self, **kw):
        """The uids of every mention the view walks through, in order."""
        out, r = [], self.st.eattr_step(-1, "next", **kw)
        while r["item"] and (not out or r["item"]["uid"] != out[-1]):
            out.append(r["item"]["uid"])
            r = self.st.eattr_step(r["item"]["pos"], "next", **kw)
        return out

    def test_walks_over_every_mention_and_stops_at_the_ends(self):
        r = self.st.eattr_step(-1, "next")
        self.assertEqual((r["item"]["index"], r["shown"], r["total"]), (1, 15, 15))
        self.assertEqual(len(self.walk()), 15)
        self.assertEqual(self.st.eattr_step(-1, "prev")["item"]["index"], 1)
        last = self.st.eattr_step(999, "prev")["item"]
        self.assertEqual(last["index"], 15)
        self.assertEqual(self.st.eattr_item(last["uid"])["item"]["pos"], last["pos"])
        with self.assertRaises(EditError):
            self.st.eattr_item(99999)

    def test_here_and_starting_after_a_token(self):
        third = self.st.eattr_step(1, "next")["item"]
        self.assertEqual(self.st.eattr_step(third["pos"] - 1, "here")["item"]["uid"], third["uid"])   # as the engine asks for it
        self.assertEqual(self.st.eattr_step(-1, "next", tok=third["s"] - 1)["item"]["uid"], third["uid"])   # first starting after the token
        self.assertEqual(self.st.eattr_step(-1, "next", tok=10_000)["item"]["pos"], 14)   # past the end: the last one

    def test_jump_to_the_nth_mention_shown(self):
        self.assertEqual(self.st.eattr_step(-1, "next", nth=5)["item"]["index"], 5)
        self.assertEqual(self.st.eattr_step(-1, "next", nth=999)["item"]["index"], 15)   # past the end: the last one
        self.assertEqual(self.st.eattr_step(-1, "next", nth=0)["item"]["index"], 1)
        self.assertEqual(self.st.eattr_step(-1, "next", nth=2, group="0")["item"]["group"], 0)   # counted among those shown

    def test_filters_by_entity_mention_type_and_entity_type(self):
        self.assertEqual(len(self.walk(group="0")), 4)
        self.assertEqual(len(self.walk(prop="PRON")), 7)
        self.assertEqual(len(self.walk(cat="FAC")), 2)
        self.assertEqual(len(self.walk(group="2", prop="PRON")), 4)
        self.assertEqual(self.st.eattr_step(-1, "next", group="9")["item"], None)
        r = self.st.eattr_step(-1, "next")
        self.assertEqual((r["props"], r["cats"]), ({"PROP": 6, "PRON": 7, "NOM": 2}, {"PER": 13, "FAC": 2}))

    def test_a_mention_outside_the_filter_can_still_be_shown_without_a_number(self):
        first = self.st.eattr_step(-1, "next", group="1")["item"]
        self.assertEqual(self.st.eattr_item(first["uid"], group="0")["item"]["index"], None)

    def mention(self, text, **kw):
        """The first mention with this text, as the view shows it (with 120 tokens of context unless `tokens` is given)."""
        r = self.st.eattr_step(-1, "next", **kw)
        while r["item"]["text"] != text:
            r = self.st.eattr_step(r["item"]["pos"], "next", **kw)
        return r["item"]

    def test_core_is_the_sentence_and_context_is_the_tokens_around_it(self):
        words = lambda reg: " ".join(reg["words"])
        it = self.mention("He", tokens=3)   # sentence 2: "He sat down."
        self.assertEqual(words(it["core"]), "He sat down .")
        self.assertEqual(words(it["above"]), "said Watson .")
        self.assertEqual(words(it["below"]), "Mrs. Hudson smiled")
        self.assertEqual([m["text"] for m in it["core"]["marks"]], ["He"])
        self.assertEqual([m["text"] for m in it["above"]["marks"]], ["Watson"])
        self.assertEqual(self.mention("He", tokens=0)["above"]["words"], [])

    def test_context_keeps_paragraph_breaks_and_spacing(self):
        below = self.mention("Holmes", tokens=2000)["below"]   # the sentences after sentence 0
        self.assertEqual(len(below["brk"]), 1)   # paragraph 1 holds sentences 1-2, so only sentence 3 opens a new one
        self.assertEqual(below["words"][below["brk"][0]], "Mrs.")
        self.assertEqual(below["space"][:3], [0, 0, 1])   # the quote mark and "I" touch, "am" has a space before

    def test_marks_include_mentions_reaching_into_the_passage(self):
        m = self.st.eattr_step(-1, "next", tokens=0)["item"]["core"]["marks"][0]
        self.assertEqual((m["text"], m["cat"], m["prop"], m["group_name"]), ("Holmes", "PER", "PROP", self.st.cluster_name(0)))
        two = self.mention("The violin", prop="NOM")   # its sentence's marks include both nominal mentions
        self.assertEqual(two["core"]["marks"][0]["uid"], two["uid"])

    def test_suggestions_are_nearby_groups_of_the_same_type_and_never_own_or_pinned(self):
        pron = self.st.eattr_step(-1, "next", prop="PRON", group="1")["item"]   # "I" in the first quote, group 1
        ids = [c["id"] for c in pron["candidates"]]
        self.assertNotIn(1, ids)
        self.assertTrue(set(ids) <= {0, 2})
        self.assertTrue(all(c["cat"] == "PER" for c in pron["candidates"]))
        self.st.set_hotkey("1", 0)
        again = self.st.eattr_step(pron["pos"] - 1, "next", prop="PRON", group="1")["item"]
        self.assertNotIn(0, [c["id"] for c in again["candidates"]])
        fac = self.st.eattr_step(-1, "next", cat="FAC")["item"]
        self.assertEqual([c["id"] for c in fac["candidates"]], [4])

    def test_he_is_offered_the_group_whose_pronouns_fit_first(self):
        she = self.mention("she")   # group 2 is "she/her": the he-groups nearby don't fit
        self.assertTrue(all(not c["fits"] for c in she["candidates"]))
        he = self.mention("He")   # group 1 is "he/him"; Holmes (0) is also he: it fits and comes first
        self.assertTrue(he["candidates"][0]["fits"])

    def test_suggestions_can_be_switched_off_and_settings_are_validated(self):
        self.assertEqual(self.st.eattr_settings(), {"advance": "auto", "suggest": True})
        self.st.set_eattr_settings(suggest=False)
        self.assertEqual(self.st.eattr_step(-1, "next")["item"]["candidates"], [])
        self.assertEqual(self.st.set_eattr_settings(advance="manual"), {"advance": "manual", "suggest": False})
        with self.assertRaises(EditError):
            self.st.set_eattr_settings(advance="sideways")
        self.assertEqual(self.st.eattr_step(-1, "next")["settings"]["advance"], "manual")

    def test_regrouping_a_mention_updates_the_view_without_changing_the_walk(self):
        first = self.st.eattr_step(-1, "next")["item"]
        self.st.regroup([first["uid"]], 1)
        again = self.st.eattr_item(first["uid"])["item"]
        self.assertEqual((again["group"], again["pos"]), (1, first["pos"]))
        self.assertEqual(self.st.eattr_step(first["pos"], "next")["item"]["pos"], first["pos"] + 1)


class NestedMentions(BookCase):
    book = NESTED

    def test_mentions_starting_on_the_same_token_are_all_reachable(self):
        r, seen = self.st.eattr_step(-1, "next"), []
        while r["item"] and r["item"]["pos"] not in seen:
            seen.append(r["item"]["pos"])
            r = self.st.eattr_step(r["item"]["pos"], "next")
        self.assertEqual(len(seen), 16)
        self.assertEqual(self.st.eattr_step(seen[-1], "prev")["item"]["pos"], seen[-2])
