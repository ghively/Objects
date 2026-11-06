"""M16 contract: the one model list and the model-name rule (`aimodels`)."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from objectapp import settings as device_settings
from objectapp.aimodels import BAD_MODEL, MODEL_PATTERN, MODELS, clean_model, resolve_model

ROOT = Path(__file__).resolve().parents[2]
PINNED_IDS = ("claude-fable-5-1", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5")


def test_models_are_the_spec_list() -> None:
    assert [m.id for m in MODELS] == [
        "fable",
        "opus",
        "sonnet",
        "haiku",
        "claude-fable-5-1",
        "claude-opus-5-5",
        "claude-sonnet-5-5",
        "claude-haiku-5-5",
    ]
    labels = {m.id: m.label for m in MODELS}
    assert labels["claude-fable-5-1"] == "Fable 5.1"
    assert labels["claude-opus-5-5"] == "Opus 5.5"
    assert labels["claude-sonnet-5-5"] == "Sonnet 5.5"
    assert labels["claude-haiku-5-5"] == "Haiku 5.5"
    assert [m.kind for m in MODELS] == ["alias"] * 4 + ["id"] * 4
    for m in MODELS:
        assert re.fullmatch(MODEL_PATTERN, m.id)


def test_clean_model() -> None:
    assert clean_model(None) is None
    assert clean_model("") is None
    assert clean_model("  ") is None
    assert clean_model(" opus ") == "opus"
    assert clean_model("claude-opus-5-5[1m]") == "claude-opus-5-5[1m]"
    for bad in ("-p", "--dangerously-skip-permissions", "a b", "$(x)", "x" * 81, 5):
        with pytest.raises(ValueError) as caught:
            clean_model(bad)
        assert str(caught.value) == BAD_MODEL
    assert BAD_MODEL == "That isn't a model name."


def test_resolve_model() -> None:
    assert resolve_model("opus", "sonnet") == "opus"
    assert resolve_model(None, "sonnet") == "sonnet"
    assert resolve_model(None, None) is None


def test_settings_use_the_shared_rule() -> None:
    assert device_settings._valid("aiModel", "claude-opus-5-5[1m]") is True
    assert device_settings._valid("aiModel", "-x") is False
    source = (ROOT / "backend" / "objectapp" / "settings.py").read_text(encoding="utf-8")
    assert "_MODEL_NAME" not in source


def _is_test_file(path: Path) -> bool:
    return ".test." in path.name


def test_one_model_list() -> None:
    test_dir = ROOT / "frontend" / "src" / "test"
    offenders: list[str] = []
    for base in (ROOT / "backend" / "objectapp", ROOT / "frontend" / "src"):
        for path in base.rglob("*"):
            if not path.is_file() or "__pycache__" in path.parts:
                continue
            if path.is_relative_to(test_dir) or _is_test_file(path):
                continue
            if path.name == "aimodels.py":
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue
            for model_id in PINNED_IDS:
                if model_id in text:
                    offenders.append(f"{path.relative_to(ROOT)}: {model_id}")
    assert offenders == []
