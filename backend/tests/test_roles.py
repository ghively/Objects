"""Structure roles and the M5 role lists (M5 Task 2)."""

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


def _type(name: str, basic: bool = True) -> TypeDefinition:
    return TypeDefinition.from_json({"id": name.lower(), "name": name, "basic": basic})


def test_role_lists():
    assert ROLES == {
        "RootPage", "RootTag", "RootTask", "RootDailyNote", "RootEntity",
        "MediaWebResource", "MediaFile", "MediaImage", "MediaPDF", "MediaAudio",
        "MediaVideo", "MediaTweet", "RootWhiteboard",
    }  # fmt: skip
    assert HAS_REFERENCES_SECTION == {
        "RootPage", "RootEntity", "MediaImage", "MediaPDF", "MediaAudio",
        "MediaWebResource", "MediaFile", "MediaTweet", "RootTask", "RootWhiteboard",
    }  # fmt: skip
    assert HAS_UNLINKED_MENTIONS == {
        "RootPage", "RootEntity", "MediaImage", "MediaPDF", "MediaAudio",
        "MediaWebResource", "MediaFile", "MediaTweet", "RootTag", "RootTask", "RootWhiteboard",
    }  # fmt: skip
    assert CAN_BE_UNLINKED_MENTION == {
        "RootPage", "RootEntity", "MediaImage", "MediaPDF", "MediaAudio",
        "MediaWebResource", "MediaFile", "MediaTweet", "RootDailyNote", "RootTask", "RootWhiteboard",
    }  # fmt: skip
    assert CAN_HAVE_BACKLINKS == {
        "RootPage", "RootEntity", "MediaImage", "MediaPDF", "MediaAudio",
        "MediaWebResource", "MediaFile", "MediaTweet", "RootTag", "RootTask", "RootWhiteboard",
    }  # fmt: skip
    assert NO_GRAPH_SUPPORT == set()


def test_role_of_basic_media_and_custom_types():
    assert role_of(_type("Page")) == "RootPage"
    assert role_of(_type("Tag")) == "RootTag"
    assert role_of(_type("Task")) == "RootTask"
    assert role_of(_type("DailyNote")) == "RootDailyNote"
    assert role_of(_type("Whiteboard")) == "RootWhiteboard"
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
