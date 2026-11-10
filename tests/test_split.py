"""The Split tab: the groups likely to be more than one entity, walking one group's mentions, and what a move takes along."""
from __future__ import annotations

from luna.core.errors import EditError
from luna.core.tools.split import SplitTools
from tests.fixture import SECOND, BookCase


class SplitGroups(BookCase):
    def test_nothing_is_suspicious_in_the_clean_book(self):
        self.assertEqual(self.st.split_groups()["items"], [])

    def test_names_with_no_word_in_common(self):
        self.st.merge_groups(0, [1])                             # Holmes and Watson in one group
        item = self.st.split_groups()["items"][0]
        self.assertEqual(item["id"], 0)
        self.assertTrue(any(r.startswith("Names with no word in common") for r in item["reasons"]), item["reasons"])
        self.st.edit_group(0, {"checked": True})                 # checked groups are left out of the list…
        self.assertEqual(self.st.split_groups()["items"], [])
        self.assertEqual([c["id"] for c in self.st.split_groups(q="holmes")["items"]], [0])   # …but a search finds them

    def test_name_reasons(self):
        r = SplitTools._name_reasons(["Mr. Rucastle", "Mrs. Rucastle", "Jephro Rucastle", "Alice Rucastle"], {"Jephro", "Alice"})
        self.assertEqual(r, ["Male and female titles (Mr. Rucastle / Mrs. Rucastle)", "Different first names (Alice, Jephro)"])
        self.assertEqual(SplitTools._name_parts(["Holmes", "Sherlock Holmes", "Watson"]), [["Holmes", "Sherlock Holmes"], ["Watson"]])


class SplitMixed(BookCase):
    book = SECOND

    def test_he_and_she_in_one_group(self):
        self.st.merge_groups(1, [2])                             # Holmes's "He" ×2 and someone's "She" ×2
        item = next(c for c in self.st.split_groups()["items"] if c["id"] == 1)
        self.assertIn("Referred to as he 2× and as she 2×", item["reasons"])


class SplitWalk(BookCase):
    def walk(self, group):
        """The uids of the mentions walked in a group, in order."""
        out, r = [], self.st.split_step(group)
        while r["item"] and (not out or r["item"]["uid"] != out[-1]):
            out.append(r["item"]["uid"])
            r = self.st.split_step(group, r["item"]["pos"], "next")
        return out

    def test_walks_the_group_in_reading_order(self):
        self.assertEqual(self.walk(2), self.group_uids(2))       # Mrs. Hudson's five mentions
        r = self.st.split_step(2, nth=4)                         # "herself"
        self.assertEqual((r["item"]["index"], r["shown"], r["group"]["name"]), (4, 5, "Mrs. Hudson"))
        self.assertEqual(r["item"]["core"]["start"], r["item"]["s"] - 2)    # its sentence: "She helped herself to tea."
        self.assertNotIn(2, [c["id"] for c in r["item"]["candidates"]])
        with self.assertRaises(EditError):
            self.st.split_step("x")

    def test_kept_mentions_are_skipped_and_never_taken_along(self):
        she, her = self.uid_at(5, 0), self.uid_at(6, 2)
        self.st.confirm_mentions([her])                          # kept, as with Enter
        self.assertNotIn(her, self.walk(2))
        self.assertEqual(self.st.split_step(2)["kept"], 1)
        pron = self.st.split_item(2, she)["item"]["scopes"]["pron"]
        self.assertEqual((pron["label"], len(pron["uids"])), ("she/her", 3))   # she ×2, herself; not the kept "her"
        self.st.set_split_settings(skip_kept=False)
        self.assertIn(her, self.walk(2))
        self.assertEqual(self.st.split_settings(), {"skip_kept": False, "advance": "auto"})
        with self.assertRaises(EditError):
            self.st.set_split_settings(advance="sideways")

    def test_scopes(self):
        holmes = self.uid_at(4, 5)
        s = self.st.split_item(0, holmes)["item"]["scopes"]
        self.assertEqual(len(s["text"]["uids"]), 3)              # "Holmes" three times
        self.assertIsNone(s["pron"])                             # a name has no pronoun set
        self.assertEqual(sorted(s["para"]["uids"]), sorted([self.uid_at(4, 1), holmes, self.uid_at(6, 0)]))   # the third paragraph
