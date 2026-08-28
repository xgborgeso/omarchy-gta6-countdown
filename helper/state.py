#!/usr/bin/env python3
"""Bounded, symlink-safe access to the reminder stamp.

Quickshell's FileView takes a path and nothing else: it cannot open with
O_NOFOLLOW, cannot fstat what it opened, and cannot stop reading at a byte
limit. That is fine for a file nobody else writes, but this one sits at a
predictable path under $XDG_STATE_HOME, so any same-UID process can replace it
with a symlink to /dev/zero or a gigabyte of text and feed that straight into
the long-lived shell process.

So the read happens here instead, where the real primitives exist:

  * the directory is opened O_NOFOLLOW|O_DIRECTORY, and the file is opened
    relative to that descriptor, so neither component can be swapped for a
    symlink between the check and the open
  * fstat on the opened descriptor confirms a regular file, owned by us, with a
    single link, before a byte is read
  * the read stops at MAX_BYTES, and a file larger than that is refused rather
    than truncated, because a truncated JSON document is not a document
  * the parsed shape is validated field by field; anything unexpected fails
    closed to an empty state rather than being handed onwards

Failing closed means "no stamp", which the widget reads as "nothing said yet
today". The worst case is therefore one extra notification, and the next write
replaces the offending file atomically. Refusing to speak at all would let
anyone who can touch the file silence the widget for good, which is a worse
outcome than one repeated toast.

Prints one line of JSON and exits 0 whatever happens; `ok` and `error` say which
state it is in. Reads and writes only its own file, and never follows a link.
"""
import json
import os
import re
import stat
import sys

SCHEMA_VERSION = 1
STATE_DIRNAME = "omarchy-gta6-countdown"
STATE_FILENAME = "last-notified"

# The real payload is about ninety bytes. This is generous enough to survive a
# grown phrase bag and small enough that a hostile file is refused instantly.
MAX_BYTES = 4096
# A tier holds five phrases; the bag can never legitimately hold more than a
# tier. The cap is well above that and bounds what a crafted file can carry.
MAX_USED = 64
MAX_PHRASE = 96
MAX_TIER = 16

DAY_KEY = re.compile(r"^\d{4}-\d{2}-\d{2}$")

O_CLOEXEC = getattr(os, "O_CLOEXEC", 0)


def state_dir():
    base = os.environ.get("GTA6_STATE_HOME") or os.environ.get("XDG_STATE_HOME") or ""
    base = base.strip()
    if not base:
        base = os.path.join(os.path.expanduser("~"), ".local", "state")
    return os.path.join(base, STATE_DIRNAME)


def envelope(ok, state=None, error=""):
    return {
        "ok": bool(ok),
        "schema_version": SCHEMA_VERSION,
        "error": str(error)[:200],
        "state": state if isinstance(state, dict) else {},
    }


def emit(payload):
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    return 0


def open_dir(path):
    """Open the state directory without following a link to it."""
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | O_CLOEXEC)
    try:
        st = os.fstat(fd)
        if not stat.S_ISDIR(st.st_mode):
            raise OSError("state path is not a directory")
        if st.st_uid != os.getuid():
            raise OSError("state directory is owned by another user")
        # A directory anyone else can write is a directory anyone else can
        # swap our file inside.
        if st.st_mode & (stat.S_IWGRP | stat.S_IWOTH):
            raise OSError("state directory is group or world writable")
    except Exception:
        os.close(fd)
        raise
    return fd


def sanitise(raw):
    """Keep only what we wrote, in the shape we wrote it."""
    if not isinstance(raw, dict):
        return {}

    out = {}
    key = raw.get("lastKey")
    if isinstance(key, str) and DAY_KEY.match(key):
        out["lastKey"] = key
    else:
        out["lastKey"] = ""

    phrases = raw.get("phrases")
    if isinstance(phrases, dict):
        tier = phrases.get("tier")
        used = phrases.get("used")
        if isinstance(tier, str) and len(tier) <= MAX_TIER and isinstance(used, list):
            clean = [u for u in used[:MAX_USED] if isinstance(u, str) and len(u) <= MAX_PHRASE]
            if len(clean) == len(used[:MAX_USED]):
                out["phrases"] = {"tier": tier, "used": clean}
    return out


def read_state():
    directory = state_dir()
    try:
        dfd = open_dir(directory)
    except FileNotFoundError:
        # Nothing written yet. The ordinary first run, not a fault.
        return envelope(True)
    except OSError as exc:
        return envelope(False, error="state directory refused: %s" % exc)

    try:
        try:
            fd = os.open(STATE_FILENAME, os.O_RDONLY | os.O_NOFOLLOW | O_CLOEXEC, dir_fd=dfd)
        except FileNotFoundError:
            return envelope(True)
        except OSError as exc:
            # ELOOP lands here when the path is a symlink, which is the case
            # this whole helper exists for.
            return envelope(False, error="stamp refused: %s" % exc)

        try:
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode):
                return envelope(False, error="stamp is not a regular file")
            if st.st_uid != os.getuid():
                return envelope(False, error="stamp is owned by another user")
            if st.st_nlink != 1:
                return envelope(False, error="stamp is hard linked")
            if st.st_size > MAX_BYTES:
                return envelope(False, error="stamp is %d bytes, over the limit" % st.st_size)

            # Size was checked, but read one byte past the cap anyway: a file
            # can grow between the fstat and the read.
            data = os.read(fd, MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                return envelope(False, error="stamp grew past the limit while reading")
        finally:
            os.close(fd)
    finally:
        os.close(dfd)

    try:
        parsed = json.loads(data.decode("utf-8", errors="strict"))
    except (UnicodeDecodeError, ValueError) as exc:
        return envelope(False, error="stamp is not valid JSON: %s" % exc)

    return envelope(True, state=sanitise(parsed))


def write_state(payload):
    if len(payload) > MAX_BYTES:
        return envelope(False, error="refusing to write %d bytes" % len(payload))
    try:
        parsed = json.loads(payload)
    except ValueError as exc:
        return envelope(False, error="refusing to write invalid JSON: %s" % exc)

    clean = sanitise(parsed)
    directory = state_dir()
    try:
        os.makedirs(directory, mode=0o700, exist_ok=True)
    except OSError as exc:
        return envelope(False, error="cannot create state directory: %s" % exc)

    try:
        dfd = open_dir(directory)
    except OSError as exc:
        return envelope(False, error="state directory refused: %s" % exc)

    tmp = STATE_FILENAME + ".tmp.%d" % os.getpid()
    try:
        # O_EXCL so we never write through a link someone left in place, and
        # 0600 so the replacement is not readable by anyone else.
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | O_CLOEXEC,
                     0o600, dir_fd=dfd)
        try:
            os.write(fd, (json.dumps(clean, separators=(",", ":")) + "\n").encode("utf-8"))
            os.fsync(fd)
        finally:
            os.close(fd)
        # rename replaces whatever sits at the target, a symlink included,
        # without ever following it.
        os.replace(tmp, STATE_FILENAME, src_dir_fd=dfd, dst_dir_fd=dfd)
    except OSError as exc:
        try:
            os.unlink(tmp, dir_fd=dfd)
        except OSError:
            pass
        return envelope(False, error="cannot write stamp: %s" % exc)
    finally:
        os.close(dfd)

    return envelope(True, state=clean)


def main(argv):
    action = argv[1] if len(argv) > 1 else "read"
    if action == "read":
        return emit(read_state())
    if action == "write":
        if len(argv) < 3:
            return emit(envelope(False, error="write needs one JSON argument"))
        return emit(write_state(argv[2]))
    return emit(envelope(False, error="unknown action"))


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except Exception as exc:  # never let the widget see a traceback on stdout
        sys.exit(emit(envelope(False, error="unexpected failure: %s" % exc)))
