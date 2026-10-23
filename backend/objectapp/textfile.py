"""Read and write text files without disturbing their bytes.

`read_text` normalises line endings to ``\n`` and strips a UTF-8 BOM, recording
both so that `encode` can reproduce the original bytes exactly. Whether the file
ends with a newline is carried by the text itself.
"""

from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

BOM = b"\xef\xbb\xbf"
# surrogateescape lets undecodable bytes survive a read/encode round trip.
_ERRORS = "surrogateescape"

Eol = Literal["\n", "\r\n"]


@dataclass(frozen=True)
class TextFile:
    text: str
    eol: Eol
    bom: bool


def decode(data: bytes) -> TextFile:
    bom = data.startswith(BOM)
    if bom:
        data = data[len(BOM) :]
    text = data.decode("utf-8", errors=_ERRORS)
    eol: Eol = "\r\n" if "\r\n" in text else "\n"
    if eol == "\r\n":
        text = text.replace("\r\n", "\n")
    return TextFile(text=text, eol=eol, bom=bom)


def read_text(path: Path) -> TextFile:
    return decode(Path(path).read_bytes())


def encode(tf: TextFile) -> bytes:
    text = tf.text.replace("\n", "\r\n") if tf.eol == "\r\n" else tf.text
    data = text.encode("utf-8", errors=_ERRORS)
    return BOM + data if tf.bom else data


def atomic_write(path: Path, data: bytes) -> None:
    """Write `data` to `path` via a temp file in the same folder and `os.replace`."""
    path = Path(path)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise
