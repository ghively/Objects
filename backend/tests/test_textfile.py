from pathlib import Path

import pytest

from objectapp.textfile import TextFile, atomic_write, decode, encode, encode_like, read_text

read_text_bytes = decode


def _write(tmp_path: Path, data: bytes) -> Path:
    p = tmp_path / "obj.md"
    p.write_bytes(data)
    return p


def test_roundtrip_lf(tmp_path):
    p = _write(tmp_path, b"---\ntitle: A\n---\n\n# Hello\nworld\n")
    tf = read_text(p)
    assert tf.eol == "\n" and tf.bom is False
    assert encode(tf) == p.read_bytes()


def test_roundtrip_crlf(tmp_path):
    p = _write(tmp_path, b"---\r\ntitle: A\r\n---\r\n\r\n# Hello\r\nworld\r\n")
    tf = read_text(p)
    assert tf.eol == "\r\n"
    assert "\r" not in tf.text
    assert encode(tf) == p.read_bytes()


def test_roundtrip_bom(tmp_path):
    p = _write(tmp_path, b"\xef\xbb\xbf---\r\ntitle: Caf\xc3\xa9\r\n---\r\nbody\r\n")
    tf = read_text(p)
    assert tf.bom is True
    assert tf.text.startswith("---\n")
    assert encode(tf) == p.read_bytes()


def test_roundtrip_no_trailing_newline(tmp_path):
    for data in (b"line one\nline two", b"line one\r\nline two", b""):
        p = _write(tmp_path, data)
        assert encode(read_text(p)) == p.read_bytes()


def test_one_line_edit_keeps_crlf(tmp_path):
    p = _write(tmp_path, b"a\r\nb\r\nc\r\n")
    tf = read_text(p)
    edited = TextFile(text=tf.text.replace("b", "B"), eol=tf.eol, bom=tf.bom)
    assert encode(edited) == b"a\r\nB\r\nc\r\n"


def test_atomic_write_replaces(tmp_path):
    p = _write(tmp_path, b"old")
    atomic_write(p, b"new contents")
    assert p.read_bytes() == b"new contents"
    assert sorted(x.name for x in tmp_path.iterdir()) == ["obj.md"]


def test_atomic_write_creates_new_file(tmp_path):
    p = tmp_path / "fresh.md"
    atomic_write(p, b"x")
    assert p.read_bytes() == b"x"
    assert sorted(x.name for x in tmp_path.iterdir()) == ["fresh.md"]


def test_atomic_write_failure_leaves_original(tmp_path, monkeypatch):
    import os

    p = _write(tmp_path, b"original")

    def boom(src, dst):
        raise OSError("replace failed")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError):
        atomic_write(p, b"new")
    assert p.read_bytes() == b"original"
    assert sorted(x.name for x in tmp_path.iterdir()) == ["obj.md"]


def test_encode_like_keeps_untouched_line_endings():
    original = b"\xef\xbb\xbfa\r\nb\nc\r\nd"
    out = encode_like(original, "a\nb\nC\nd\ne")
    assert out == b"\xef\xbb\xbfa\r\nb\nC\r\nd\r\ne"


def test_encode_like_matches_encode_for_uniform_files():
    for data in (b"x\ny\n", b"x\r\ny\r\n", b"x\r\ny", b""):
        tf = read_text_bytes(data)
        new = tf.text + "added\n"
        assert encode_like(data, new) == encode(TextFile(new, tf.eol, tf.bom))


def test_atomic_write_check_failure_leaves_original(tmp_path):
    p = _write(tmp_path, b"original\n")

    def refuse() -> None:
        raise RuntimeError("changed")

    with pytest.raises(RuntimeError):
        atomic_write(p, b"new\n", check=refuse)
    assert p.read_bytes() == b"original\n"
    assert [x.name for x in tmp_path.iterdir()] == ["obj.md"]
