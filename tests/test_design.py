"""The design tokens in docs/DESIGN.md match the stylesheet, and the document's rule IDs are unique.

docs/DESIGN.md §3.1 holds the colour tokens as JSON so that tools and companion projects can read them;
this keeps that block from drifting away from luna/static/css/app.css.
"""
from __future__ import annotations

import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOC = (ROOT / "docs" / "DESIGN.md").read_text()
CSS = (ROOT / "luna" / "static" / "css" / "app.css").read_text()


def tokens() -> dict:
    """The JSON token block of DESIGN.md (the first fenced json block)."""
    return json.loads(re.search(r"```json\n(.*?)\n```", DOC, re.S).group(1))


def declarations(block: str) -> dict:
    """The `--name:value` declarations of a CSS block as a dict (names without the dashes)."""
    return {k: v.strip() for k, v in re.findall(r"--([\w-]+):([^;}]+)", block)}


class Tokens(unittest.TestCase):
    def blocks(self) -> tuple[dict, dict, dict]:
        """The light :root declarations and the two copies of the dark ones, from app.css."""
        light = re.search(r"^:root\{(.*?)\}", CSS, re.S | re.M).group(1)
        media = re.search(r"@media \(prefers-color-scheme:dark\)\{\s*:root:not\(\[data-theme=\"light\"\]\)\{(.*?)\}\s*\}", CSS, re.S).group(1)
        attr = re.search(r":root\[data-theme=\"dark\"\]\{(.*?)\}", CSS, re.S).group(1)
        return declarations(light), declarations(media), declarations(attr)

    def test_colours_match_the_stylesheet(self):
        light, media, attr = self.blocks()
        t = tokens()
        for theme, css in (("light", light), ("dark", media), ("dark", attr)):
            for name, value in t["color"][theme].items():
                self.assertEqual(css[name].lower(), value.lower(), f"{theme} --{name}")

    def test_group_hue_numbers_match_the_stylesheet(self):
        light, media, attr = self.blocks()
        g = tokens()["group-hue"]
        for theme, css in (("light", light), ("dark", media), ("dark", attr)):
            for name, value in g[theme].items():
                self.assertEqual(float(css[name].rstrip("%")) / (100 if value.endswith("%") else 1), float(value.rstrip("%")) / (100 if value.endswith("%") else 1), f"{theme} --{name}")

    def test_fonts_match_the_stylesheet(self):
        light, _, _ = self.blocks()
        f = tokens()["font"]
        for name in ("ui", "mono", "read"):
            self.assertEqual(light[name], f[name], name)

    def test_hue_formula_matches_the_script(self):
        js = (ROOT / "luna" / "static" / "js" / "app.js").read_text()
        self.assertIn("(((id * 137.508) % 360) + 360) % 360", js)


class Rules(unittest.TestCase):
    def test_rule_ids_are_defined_once(self):
        defined = re.findall(r"\*\*(DL-[A-Z]+-\d\d)\b", DOC)
        self.assertEqual(len(defined), len(set(defined)), sorted({d for d in defined if defined.count(d) > 1}))


if __name__ == "__main__":
    unittest.main()
