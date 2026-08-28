#!/usr/bin/env python3
"""Structural guards on the QML sources.

These do not run QML; they read the file. The point is to catch, without needing
a compositor, a shell or a display, the class of mistake that loads fine in a
text editor and then fails silently in the bar.
"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PANEL = ROOT / "Panel.qml"
SERVICE = ROOT / "Service.qml"
MODEL = ROOT / "Model.js"
QML_FILES = sorted(ROOT.glob("*.qml"))

# Types that render `text` and therefore honour textFormat. Ui.PanelSectionHeader
# subclasses Text, so it inherits Text.AutoText and needs pinning just the same.
TEXT_TYPES = ("Text", "Ui.PanelSectionHeader")

OPEN = re.compile(r"^\s*(?:[A-Za-z_][\w.]*\s*:\s*)?([A-Za-z_][\w.]*)\s*\{\s*$")


def text_blocks(source: str):
    """Yield (type_name, line_number, body) for every text-rendering block."""
    lines = source.splitlines()
    for index, line in enumerate(lines):
        match = OPEN.match(line)
        if not match or match.group(1) not in TEXT_TYPES:
            continue
        depth = 0
        body = []
        for follow in lines[index:]:
            depth += follow.count("{") - follow.count("}")
            body.append(follow)
            if depth == 0:
                break
        yield match.group(1), index + 1, "\n".join(body)


class PanelTextSafetyTests(unittest.TestCase):
    """`releaseDate` is user input and reaches a label and a notification body.

    The panel pins its Text elements to plain and Model.safeText strips angle
    brackets, but a sink left on Text.AutoText would interpret a crafted value
    as markup, so the pinning is checked rather than trusted.
    """

    def setUp(self):
        self.source = PANEL.read_text(encoding="utf-8")
        self.blocks = list(text_blocks(self.source))

    def test_the_parser_actually_finds_the_blocks(self):
        # A guard that silently matches nothing would pass forever.
        self.assertGreaterEqual(len(self.blocks), 7, self.blocks)

    def test_every_text_sink_is_pinned_to_plain_text(self):
        unpinned = [
            "%s at %s:%d" % (kind, PANEL.name, line)
            for kind, line, body in self.blocks
            if "textFormat: Text.PlainText" not in body
        ]
        self.assertEqual(
            unpinned,
            [],
            "These render user-supplied text without Text.PlainText, so a "
            "crafted release date could be interpreted as markup: "
            + ", ".join(unpinned),
        )

    def test_no_sink_opts_into_rich_text(self):
        for bad in ("Text.RichText", "Text.StyledText", "Text.AutoText"):
            self.assertNotIn(bad, self.source)


class GlyphTests(unittest.TestCase):
    """Glyphs are written as escapes, never pasted.

    A nerd-font glyph is an unprintable private-use character. Pasted into
    source it is invisible in review, survives a copy-paste into the wrong
    string, and reads as a mystery byte in a diff. Model.js declares each one
    as a \\uXXXX escape and everything else refers to the constant.
    """

    PRIVATE_USE = re.compile(
        "[\\ue000-\\uf8ff\\U000f0000-\\U000ffffd]".encode()
        .decode("unicode_escape"))

    def test_no_literal_private_use_characters_in_sources(self):
        offenders = []
        for path in [MODEL] + QML_FILES:
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                for hit in self.PRIVATE_USE.finditer(line):
                    offenders.append(
                        "%s:%d U+%04X" % (path.name, number, ord(hit.group()))
                    )
        self.assertEqual(
            offenders,
            [],
            "Write glyphs as \\uXXXX escapes in Model.js and reference the "
            "constant, so an invisible character cannot ride along unnoticed: "
            + ", ".join(offenders),
        )

    def test_model_declares_the_glyphs(self):
        source = MODEL.read_text(encoding="utf-8")
        for name in ("GLYPH", "LINK_GLYPH", "DATE_GLYPH"):
            self.assertRegex(source, r"var %s = \"(\\u[0-9a-f]{4})+\"" % name)

    def test_no_control_characters_anywhere(self):
        for path in [MODEL] + QML_FILES:
            text = path.read_text(encoding="utf-8")
            bad = sorted({ord(c) for c in text
                          if ord(c) < 9 or 14 <= ord(c) < 32 or ord(c) == 127})
            self.assertEqual(bad, [], "%s holds control characters %s" % (path.name, bad))


class QmlDeclarationTests(unittest.TestCase):
    """Mistakes that load fine in a text editor and fail in the shell.

    Quickshell rejects the whole component when a declaration is malformed, and
    the only symptom the user sees is the widget missing from the bar with a
    "Target not found" line on the shell's console. qmlformat parses these
    happily and qmllint does not flag them, so they are checked here.
    """

    # QML property names must start lowercase; an uppercase one is read as a
    # type annotation and the component fails to register.
    DECLARATION = re.compile(
        r"^\s*(?:readonly\s+|required\s+|default\s+)*property\s+[\w.<>]+\s+([A-Za-z_]\w*)"
    )

    def test_property_names_start_lowercase(self):
        offenders = []
        for path in QML_FILES:
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                match = self.DECLARATION.match(line)
                if match and not match.group(1)[0].islower():
                    offenders.append("%s:%d %s" % (path.name, number, match.group(1)))
        self.assertEqual(
            offenders,
            [],
            "QML property names must start lowercase or the component will not "
            "register and the widget silently vanishes from the bar: "
            + ", ".join(offenders),
        )

    def test_it_inspects_every_qml_file(self):
        names = [p.name for p in QML_FILES]
        self.assertIn("Panel.qml", names)
        self.assertIn("Service.qml", names)


class ManifestAgreementTests(unittest.TestCase):
    """The manifest documents defaults that the QML implements separately.

    Nothing enforces the two agree, and a drift means the marketplace listing
    advertises behaviour the widget does not have.
    """

    def setUp(self):
        import json
        self.manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
        self.service = SERVICE.read_text(encoding="utf-8")

    def test_entry_point_exists(self):
        entry = self.manifest["entryPoints"]["barWidget"]
        self.assertTrue((ROOT / entry).is_file(), entry)

    def test_ipc_target_matches_the_plugin_id(self):
        panel = PANEL.read_text(encoding="utf-8")
        for field in ("moduleName", "ipcTarget"):
            self.assertIn('%s: "%s"' % (field, self.manifest["id"]), panel)

    def test_every_documented_default_is_read_by_the_service(self):
        for key in self.manifest["barWidget"]["defaults"]:
            self.assertIn('"%s"' % key, self.service,
                          "manifest documents %s but Service.qml never reads it" % key)

    def test_schema_and_defaults_agree(self):
        defaults = self.manifest["barWidget"]["defaults"]
        schema = {entry["key"]: entry for entry in self.manifest["barWidget"]["schema"]}
        self.assertEqual(sorted(defaults), sorted(schema))
        for key, entry in schema.items():
            self.assertEqual(entry["defaultValue"], defaults[key], key)

    def test_the_shipped_release_date_matches_the_model(self):
        model = MODEL.read_text(encoding="utf-8")
        shipped = self.manifest["barWidget"]["defaults"]["releaseDate"]
        self.assertIn('var RELEASE_DATE = "%s"' % shipped, model)


if __name__ == "__main__":
    unittest.main()
