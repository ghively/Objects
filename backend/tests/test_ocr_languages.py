"""OCR languages (known limit "OCR is English only", fixed 2026-11-09): the PDF reader asks
``tesseract`` once which languages it has and passes them all as ``-l``; the ``ocrLanguages``
device setting names them instead; no ``-l`` when neither is known (the engine's default)."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
from objectapp import settings
from objectapp.readers import pdf

LIST_LANGS = "List of available languages (4):\nosd\neng\ndeu\nchi_sim\n"


@pytest.fixture
def state(tmp_path: Path, monkeypatch) -> Path:
    path = tmp_path / "state"
    monkeypatch.setenv("OBJECT_STATE_DIR", str(path))
    return path


@pytest.fixture(autouse=True)
def _fresh_cache():
    pdf.clear_ocr_cache()
    yield
    pdf.clear_ocr_cache()


def test_list_langs_output_is_parsed_without_the_header_or_osd() -> None:
    assert pdf.parse_list_langs(LIST_LANGS) == ["eng", "deu", "chi_sim"]
    # Windows line ends, blank lines and the header alone.
    assert pdf.parse_list_langs("List of available languages (1):\r\n\r\neng\r\n") == ["eng"]
    assert pdf.parse_list_langs("List of available languages (0):\n") == []
    assert pdf.parse_list_langs("") == []
    # A line that is no language code (an error line, a script name) is left out.
    assert pdf.parse_list_langs("Error opening data file\neng\nscript/Latin\n") == ["eng", "script/Latin"]


def test_language_argument_from_installed_from_setting_and_absent() -> None:
    assert pdf.language_arg(["eng", "deu"], "") == ["-l", "eng+deu"]
    assert pdf.language_arg(["eng"], "") == ["-l", "eng"]
    # The setting wins over the installed list, as given.
    assert pdf.language_arg(["eng", "deu", "fra"], "deu+fra") == ["-l", "deu+fra"]
    assert pdf.language_arg(None, "eng") == ["-l", "eng"]
    # Neither known: today's call, without ``-l``.
    assert pdf.language_arg(None, "") == []
    assert pdf.language_arg([], "") == []
    assert pdf.language_arg(None, None) == []


def test_installed_languages_are_asked_once_per_process(monkeypatch) -> None:
    calls: list[list[str]] = []

    def run(args, **_kw):
        calls.append(list(args))
        return subprocess.CompletedProcess(args, 0, stdout=LIST_LANGS, stderr="")

    monkeypatch.setattr(pdf.subprocess, "run", run)
    assert pdf.installed_languages("/usr/bin/tesseract") == ["eng", "deu", "chi_sim"]
    assert pdf.installed_languages("/usr/bin/tesseract") == ["eng", "deu", "chi_sim"]
    assert calls == [["/usr/bin/tesseract", "--list-langs"]]


def test_installed_languages_unknown_when_the_list_cant_be_read(monkeypatch) -> None:
    monkeypatch.setattr(pdf.subprocess, "run", lambda args, **_kw: subprocess.CompletedProcess(args, 1, "", "boom"))
    assert pdf.installed_languages("/x/tesseract") is None
    pdf.clear_ocr_cache()

    def raise_oserror(args, **_kw):
        raise OSError("gone")

    monkeypatch.setattr(pdf.subprocess, "run", raise_oserror)
    assert pdf.installed_languages("/x/tesseract") is None
    pdf.clear_ocr_cache()
    # Older engines print the list to stderr.
    monkeypatch.setattr(pdf.subprocess, "run", lambda args, **_kw: subprocess.CompletedProcess(args, 0, "", LIST_LANGS))
    assert pdf.installed_languages("/x/tesseract") == ["eng", "deu", "chi_sim"]


def test_ocr_call_carries_the_languages(tmp_path: Path, monkeypatch) -> None:
    calls: list[list[str]] = []

    def run(args, **_kw):
        calls.append(list(args))
        return subprocess.CompletedProcess(args, 0, stdout="Text\n", stderr="")

    monkeypatch.setattr(pdf.subprocess, "run", run)
    assert pdf._ocr_image("/t", "a.png", b"img", tmp_path, 1, ["-l", "eng+deu"]) == "Text"
    assert calls[0][0] == "/t" and calls[0][-3:] == ["stdout", "-l", "eng+deu"]
    # Without languages the call is as before.
    assert pdf._ocr_image("/t", "b.png", b"img2", tmp_path, 2, []) == "Text"
    assert calls[1][-1] == "stdout"
    # The cache is per language set: the same image in other languages is read again.
    pdf._ocr_image("/t", "a.png", b"img", tmp_path, 3, ["-l", "eng+deu"])
    assert len(calls) == 2
    pdf._ocr_image("/t", "a.png", b"img", tmp_path, 4, ["-l", "fra"])
    assert len(calls) == 3


def test_ocr_languages_read_the_setting_and_the_engine(monkeypatch) -> None:
    monkeypatch.setattr(pdf, "installed_languages", lambda engine: ["eng", "deu"])
    monkeypatch.setattr(pdf, "configured_languages", lambda: "")
    assert pdf.ocr_languages("/t") == ["-l", "eng+deu"]
    monkeypatch.setattr(pdf, "configured_languages", lambda: "fra")
    assert pdf.ocr_languages("/t") == ["-l", "fra"]
    monkeypatch.setattr(pdf, "installed_languages", lambda engine: None)
    monkeypatch.setattr(pdf, "configured_languages", lambda: "")
    assert pdf.ocr_languages("/t") == []


def test_configured_languages_is_the_device_setting(state: Path) -> None:
    assert pdf.configured_languages() == ""
    settings.patch({"ocrLanguages": "eng+deu"}, "")
    assert pdf.configured_languages() == "eng+deu"
    # A settings file that can't be read never stops a reader.
    (state / "settings.json").write_text("not json", encoding="utf-8")
    assert pdf.configured_languages() == ""


@pytest.mark.parametrize(
    ("good", "bad"),
    [
        ("", None),
        ("eng", "en"),
        ("eng+deu", "eng+"),
        ("chi_sim+eng", "+eng"),
        ("eng", "eng deu"),
        ("script/Latin", "eng/deu"),
        ("eng", "eng,deu"),
        ("eng", "e" * 201),
    ],
)
def test_ocr_languages_setting_validates(good, bad) -> None:
    assert settings._valid("ocrLanguages", good)
    assert not settings._valid("ocrLanguages", bad)
    assert settings.DEFAULTS["ocrLanguages"] == ""
