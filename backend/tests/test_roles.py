"""Capacities structure roles and the M5 role lists (M5 Task 2)."""

import re
from pathlib import Path

from objectapp.roles import (
    CAN_BE_UNLINKED_MENTION,
    CAN_HAVE_BACKLINKS,
    HAS_REFERENCES_SECTION,
    HAS_UNLINKED_MENTIONS,
    NO_GRAPH_SUPPORT,
    ROLES,
    role_of,
)
from objectapp.typemodel import TypeDefinition

REPO = Path(__file__).resolve().parents[2]
BACKBONE = (
    REPO / "reference/recovered-ts/src/shared-logic/util/structureHeuristicsBackbone.ts"
)


def _reference_list(name: str) -> set[str]:
    src = BACKBONE.read_text("utf-8")
    m = re.search(rf"\n  {name}: \([^)]*\) => \{{(.*?)\n  \}},", src, re.DOTALL)
    assert m, name
    return set(re.findall(r"'([A-Za-z]+)'", m.group(1)))


def _type(name: str, basic: bool = True) -> TypeDefinition:
    return TypeDefinition.from_json({"id": name.lower(), "name": name, "basic": basic})


def test_role_lists_match_reference():
    assert ROLES == {
        "RootPage", "RootTag", "RootTask", "RootDailyNote", "RootEntity",
        "MediaWebResource", "MediaFile", "MediaImage", "MediaPDF", "MediaAudio",
        "MediaVideo", "MediaTweet",
    }  # fmt: skip
    assert HAS_REFERENCES_SECTION == {
        "RootPage", "RootEntity", "MediaImage", "MediaPDF", "MediaAudio",
        "MediaWebResource", "MediaFile", "MediaTweet", "RootTask",
    }  # fmt: skip
    assert HAS_UNLINKED_MENTIONS == {
        "RootPage", "RootEntity", "MediaImage", "MediaPDF", "MediaAudio",
        "MediaWebResource", "MediaFile", "MediaTweet", "RootTag", "RootTask",
    }  # fmt: skip
    assert CAN_BE_UNLINKED_MENTION == {
        "RootPage", "RootEntity", "MediaImage", "MediaPDF", "MediaAudio",
        "MediaWebResource", "MediaFile", "MediaTweet", "RootDailyNote", "RootTask",
    }  # fmt: skip
    assert CAN_HAVE_BACKLINKS == {
        "RootPage", "RootEntity", "MediaImage", "MediaPDF", "MediaAudio",
        "MediaWebResource", "MediaFile", "MediaTweet", "RootTag", "RootTask",
    }  # fmt: skip
    assert NO_GRAPH_SUPPORT == set()
    # The same lists, read from the reference and restricted to our roles.
    if BACKBONE.is_file():
        assert (
            _reference_list("canHaveBacklinksSection") & ROLES == HAS_REFERENCES_SECTION
        )
        assert _reference_list("hasUnlinkedMentions") & ROLES == HAS_UNLINKED_MENTIONS
        assert (
            _reference_list("canBeUnlinkedMention") & ROLES == CAN_BE_UNLINKED_MENTION
        )
        assert _reference_list("canHaveBacklinks") & ROLES == CAN_HAVE_BACKLINKS
        assert _reference_list("hasNoGraphViewSupport") & ROLES == NO_GRAPH_SUPPORT


def test_role_of_basic_media_and_custom_types():
    assert role_of(_type("Page")) == "RootPage"
    assert role_of(_type("Tag")) == "RootTag"
    assert role_of(_type("Task")) == "RootTask"
    assert role_of(_type("DailyNote")) == "RootDailyNote"
    assert role_of(_type("Weblink")) == "MediaWebResource"
    assert role_of(_type("File")) == "MediaFile"
    assert role_of(_type("Image")) == "MediaImage"
    assert role_of(_type("PDF")) == "MediaPDF"
    assert role_of(_type("Audio")) == "MediaAudio"
    assert role_of(_type("Video")) == "MediaVideo"
    assert role_of(_type("Tweet")) == "MediaTweet"
    assert role_of(_type("Person", basic=False)) == "RootEntity"
    assert role_of(_type("Image", basic=False)) == "RootEntity"
    assert role_of(None) == "RootEntity"
