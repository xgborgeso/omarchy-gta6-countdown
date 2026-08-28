#!/usr/bin/env python3
"""Tests for the reminder stamp helper.

The helper exists because Quickshell's FileView cannot open a file without
following a symlink, cannot check what it opened, and cannot stop reading at a
byte limit. Each of those is exercised here against a real temporary directory,
including the exact substitution the marketplace security review described.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "helper" / "state.py"

GOOD = {"lastKey": "2026-08-28", "phrases": {"tier": "31", "used": ["Getting warm"]}}


def run(action, *args, home=None):
    env = dict(os.environ)
    if home is not None:
        env["GTA6_STATE_HOME"] = str(home)
    proc = subprocess.run([sys.executable, str(HELPER), action, *args],
                          capture_output=True, text=True, env=env)
    assert proc.returncode == 0, "helper exited %d: %s" % (proc.returncode, proc.stderr)
    assert proc.stdout.count("\n") == 1, "helper printed more than one line"
    return json.loads(proc.stdout)


class StampTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.home = Path(self.tmp.name)
        self.dir = self.home / "omarchy-gta6-countdown"
        self.path = self.dir / "last-notified"

    def tearDown(self):
        self.tmp.cleanup()

    def write_raw(self, data, mode="w"):
        self.dir.mkdir(parents=True, exist_ok=True)
        with open(self.path, mode) as handle:
            handle.write(data)

    # ---------------------------------------------------------- ordinary use

    def test_missing_state_is_not_an_error(self):
        # The first run on a new machine. Nothing is wrong; there is just
        # nothing to say yet.
        result = run("read", home=self.home)
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["state"], {})
        self.assertEqual(result["error"], "")

    def test_round_trip(self):
        written = run("write", json.dumps(GOOD), home=self.home)
        self.assertTrue(written["ok"], written)
        read = run("read", home=self.home)
        self.assertTrue(read["ok"], read)
        self.assertEqual(read["state"], GOOD)

    def test_write_creates_a_private_directory_and_file(self):
        run("write", json.dumps(GOOD), home=self.home)
        self.assertEqual(self.dir.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_write_replaces_rather_than_appends(self):
        run("write", json.dumps(GOOD), home=self.home)
        second = dict(GOOD, lastKey="2026-08-29")
        run("write", json.dumps(second), home=self.home)
        self.assertEqual(run("read", home=self.home)["state"]["lastKey"], "2026-08-29")
        self.assertEqual(len(self.path.read_text().splitlines()), 1)

    def test_no_temp_files_are_left_behind(self):
        run("write", json.dumps(GOOD), home=self.home)
        self.assertEqual(sorted(p.name for p in self.dir.iterdir()), ["last-notified"])

    # ------------------------------------------------- the reviewed weakness

    def test_a_symlink_at_the_stamp_path_is_refused(self):
        # The finding verbatim: another same-UID process swaps the predictable
        # path for a link. O_NOFOLLOW must refuse it rather than read through.
        secret = self.home / "elsewhere.txt"
        secret.write_text('{"lastKey":"2026-01-01"}')
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path.symlink_to(secret)

        result = run("read", home=self.home)
        self.assertFalse(result["ok"], result)
        self.assertEqual(result["state"], {}, "content behind the link must not leak through")
        self.assertIn("refused", result["error"])

    def test_writing_over_a_symlink_replaces_the_link_not_its_target(self):
        target = self.home / "victim.txt"
        target.write_text("do not touch")
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path.symlink_to(target)

        run("write", json.dumps(GOOD), home=self.home)
        self.assertEqual(target.read_text(), "do not touch", "wrote through the link")
        self.assertFalse(self.path.is_symlink(), "link should have been replaced")
        self.assertEqual(run("read", home=self.home)["state"], GOOD)

    def test_a_symlinked_state_directory_is_refused(self):
        # O_NOFOLLOW on the file alone would not catch this.
        elsewhere = self.home / "elsewhere"
        elsewhere.mkdir()
        (elsewhere / "last-notified").write_text(json.dumps(GOOD))
        self.dir.symlink_to(elsewhere, target_is_directory=True)

        result = run("read", home=self.home)
        self.assertFalse(result["ok"], result)
        self.assertEqual(result["state"], {})

    def test_an_oversized_stamp_is_refused_not_truncated(self):
        # A truncated JSON document is not a document, so this must fail rather
        # than parse the first four kilobytes.
        self.write_raw('{"lastKey":"2026-08-28","pad":"' + "A" * 8192 + '"}')
        result = run("read", home=self.home)
        self.assertFalse(result["ok"], result)
        self.assertIn("limit", result["error"])
        self.assertEqual(result["state"], {})

    def test_a_directory_at_the_stamp_path_is_refused(self):
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path.mkdir()
        result = run("read", home=self.home)
        self.assertFalse(result["ok"], result)
        self.assertEqual(result["state"], {})

    def test_a_world_writable_state_directory_is_refused(self):
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(GOOD))
        os.chmod(self.dir, 0o777)
        result = run("read", home=self.home)
        self.assertFalse(result["ok"], result)
        self.assertEqual(result["state"], {})

    # ------------------------------------------------------- hostile content

    def test_malformed_json_fails_closed(self):
        self.write_raw("{not json at all")
        result = run("read", home=self.home)
        self.assertFalse(result["ok"], result)
        self.assertEqual(result["state"], {})

    def test_invalid_utf8_fails_closed(self):
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path.write_bytes(b'{"lastKey":"\xff\xfe"}')
        result = run("read", home=self.home)
        self.assertFalse(result["ok"], result)
        self.assertEqual(result["state"], {})

    def test_a_crafted_day_key_never_reaches_the_widget(self):
        # lastKey is compared against today's date. Anything that is not a
        # plain date is dropped rather than passed through.
        for bad in ["<img src=x>", "2026-08-28; rm -rf /", "../../etc/passwd",
                    "2026-8-28", "A" * 200]:
            self.write_raw(json.dumps({"lastKey": bad}))
            result = run("read", home=self.home)
            self.assertEqual(result["state"].get("lastKey"), "",
                             "leaked a crafted lastKey: %r" % bad)

    def test_an_overlong_phrase_bag_is_dropped(self):
        self.write_raw(json.dumps({
            "lastKey": "2026-08-28",
            "phrases": {"tier": "31", "used": ["x" * 500]},
        }))
        result = run("read", home=self.home)
        self.assertNotIn("phrases", result["state"], "an oversized phrase survived")
        self.assertEqual(result["state"]["lastKey"], "2026-08-28")

    def test_unexpected_fields_are_stripped(self):
        self.write_raw(json.dumps(dict(GOOD, evil="payload", nested={"a": 1})))
        result = run("read", home=self.home)
        self.assertEqual(sorted(result["state"]), ["lastKey", "phrases"])

    def test_a_non_object_document_fails_closed(self):
        for bad in ["[1,2,3]", '"a string"', "12345", "null"]:
            self.write_raw(bad)
            self.assertEqual(run("read", home=self.home)["state"], {},
                             "accepted %s" % bad)

    # ------------------------------------------------------------- interface

    def test_it_never_writes_what_it_would_refuse_to_read(self):
        run("write", json.dumps({"lastKey": "<script>", "phrases": {"tier": "31", "used": []}}),
            home=self.home)
        self.assertEqual(run("read", home=self.home)["state"]["lastKey"], "")

    def test_write_refuses_an_oversized_payload(self):
        result = run("write", json.dumps({"lastKey": "2026-08-28", "pad": "A" * 9000}),
                     home=self.home)
        self.assertFalse(result["ok"], result)
        self.assertFalse(self.path.exists(), "wrote a file it had refused")

    def test_bad_usage_still_prints_one_json_line(self):
        for args in (["write"], ["nonsense"]):
            proc = subprocess.run([sys.executable, str(HELPER), *args],
                                  capture_output=True, text=True,
                                  env=dict(os.environ, GTA6_STATE_HOME=str(self.home)))
            self.assertEqual(proc.returncode, 0)
            payload = json.loads(proc.stdout)
            self.assertFalse(payload["ok"])

    def test_it_reports_its_schema(self):
        self.assertEqual(run("read", home=self.home)["schema_version"], 1)


if __name__ == "__main__":
    unittest.main()
