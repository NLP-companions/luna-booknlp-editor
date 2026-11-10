"""Flags: a "check this later" mark, with an optional note, on a mention, a quote, a group or a sentence."""
from __future__ import annotations

import unittest

from luna.core.errors import EditError
from tests.fixture import BookCase


class Flags(BookCase):
    def test_set_update_and_clear(self):
        i = self.uid_at(0, 0)  # "Holmes"
        self.assertIsNone(self.st.flag_of("entities", i))
        self.st.set_flag("entities", i, "check this name")
        f = self.st.flag_of("entities", i)
        self.assertEqual(f["note"], "check this name")
        self.st.set_flag("entities", i, "changed my mind")  # updates the same flag, doesn't duplicate it
        f2 = self.st.flag_of("entities", i)
        self.assertEqual((f2["uid"], f2["note"]), (f["uid"], "changed my mind"))
        self.assertEqual(len(self.st.flags_list()), 1)
        self.st.clear_flag("entities", i)
        self.assertIsNone(self.st.flag_of("entities", i))
        with self.assertRaises(EditError):
            self.st.clear_flag("entities", i)

    def test_every_kind(self):
        e = self.uid_at(0, 0)
        q = self.uid_at(1, 0, 5, table="quotes")
        self.st.set_flag("entities", e)
        self.st.set_flag("quotes", q)
        self.st.set_flag("groups", 1)  # Watson
        self.st.set_flag("sentence", self.st.uid_of_ord(0))  # sentence 0's first token
        items = self.st.flags_list()
        self.assertEqual({it["kind"] for it in items}, {"entities", "quotes", "groups", "sentence"})
        by_kind = {it["kind"]: it for it in items}
        self.assertEqual(by_kind["entities"]["label"], "Mention “Holmes”")
        self.assertEqual((by_kind["entities"]["s"], by_kind["entities"]["e"]), (0, 0))
        self.assertEqual(by_kind["groups"]["label"], "Group “Watson”")
        self.assertIsNone(by_kind["groups"]["s"])
        self.assertEqual(by_kind["sentence"]["label"], "Sentence 0")
        self.assertIn("Holmes", by_kind["sentence"]["text"])

        with self.assertRaises(EditError):
            self.st.set_flag("nonsense", 0)

    def test_clear_several_in_one_undoable_step(self):
        e, q = self.uid_at(0, 0), self.uid_at(1, 0, 5, table="quotes")
        self.st.set_flag("entities", e)
        self.st.set_flag("quotes", q)
        self.st.set_flag("groups", 1)
        r = self.st.clear_flags([{"kind": "entities", "target": e}, {"kind": "quotes", "target": q},
                                 {"kind": "sentence", "target": 999999}])  # a target that isn't flagged is ignored
        self.assertEqual(r["undo"], "Removed 2 flags")
        self.assertEqual([f["kind"] for f in self.st.flags_list()], ["groups"])
        self.st.undo()  # both come back at once
        self.assertEqual(len(self.st.flags_list()), 3)
        with self.assertRaises(EditError):
            self.st.clear_flags([{"kind": "sentence", "target": 999999}])

    def test_list_fields_for_the_view(self):
        q = self.uid_at(1, 0, 5, table="quotes")
        self.st.set_flag("quotes", q, "why", auto=True)
        self.st.set_flag("groups", 1)
        by_kind = {f["kind"]: f for f in self.st.flags_list()}
        self.assertEqual((by_kind["quotes"]["auto"], by_kind["groups"]["auto"]), (1, 0))
        self.assertEqual(by_kind["groups"]["name"], "“Watson”")
        self.assertIsNone(by_kind["groups"]["sent"])
        self.assertEqual(by_kind["quotes"]["sent"], 1)
        self.st.set_flag("quotes", q, "edited")  # editing the note keeps the mark
        self.assertEqual(self.st.flag_of("quotes", q)["auto"], 1)

    def test_undoable_but_not_in_the_change_log(self):
        i = self.uid_at(0, 0)
        r = self.st.set_flag("entities", i, "later")
        self.assertIn("Flagged", r["undo"])
        kind = self.st.db.execute("SELECT kind FROM batches ORDER BY id DESC LIMIT 1").fetchone()[0]
        self.assertEqual(kind, "review")
        self.st.undo()
        self.assertIsNone(self.st.flag_of("entities", i))

    def test_only_something_that_exists_can_be_flagged(self):
        """A flag needs a target: an existing mention, quote or group, or a token that starts a sentence."""
        for kind, target in (("entities", 99999), ("quotes", 99999), ("groups", 99999), ("sentence", 99999),
                             ("sentence", self.st.uid_of_ord(1))):      # token 1 is inside sentence 0
            with self.assertRaises(EditError, msg=(kind, target)):
                self.st.set_flag(kind, target)
        self.assertEqual(self.st.flags_list(), [])

    def test_the_note_of_a_flag_on_a_merged_sentence_can_still_change(self):
        first = self.st.uid_of_ord(self.st.sent_starts[1])
        self.st.set_flag("sentence", first, "a")
        self.st.merge_sentence(0)                         # its sentence now starts earlier: the flag stays, listed under it
        self.st.set_flag("sentence", first, "b")
        self.assertEqual(self.st.flag_of("sentence", first)["note"], "b")

    def test_a_flag_on_something_deleted_drops_out_of_the_list_not_the_table(self):
        i = self.uid_at(7, 0, 1)  # "The violin" (a FAC entity, safe to delete without side effects)
        self.st.set_flag("entities", i, "check this")
        self.st.delete_span("entities", i)
        self.assertEqual(self.st.flags_list(), [])
        self.assertIsNotNone(self.st._flag_row("entities", i))  # the row itself is left behind


if __name__ == "__main__":
    unittest.main()
