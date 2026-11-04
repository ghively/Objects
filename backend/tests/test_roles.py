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
        "page", "tag", "task", "dailyNote", "entity",
        "weblink", "file", "image", "pdf", "audio",
        "video", "tweet", "whiteboard",
    }  # fmt: skip
    assert HAS_REFERENCES_SECTION == {
        "page", "entity", "image", "pdf", "audio",
        "weblink", "file", "tweet", "task", "whiteboard",
    }  # fmt: skip
    assert HAS_UNLINKED_MENTIONS == {
        "page", "entity", "image", "pdf", "audio",
        "weblink", "file", "tweet", "tag", "task", "whiteboard",
    }  # fmt: skip
    assert CAN_BE_UNLINKED_MENTION == {
        "page", "entity", "image", "pdf", "audio",
        "weblink", "file", "tweet", "dailyNote", "task", "whiteboard",
    }  # fmt: skip
    assert CAN_HAVE_BACKLINKS == {
        "page", "entity", "image", "pdf", "audio",
        "weblink", "file", "tweet", "tag", "task", "whiteboard",
    }  # fmt: skip
    assert NO_GRAPH_SUPPORT == set()


def test_role_of_basic_media_and_custom_types():
    assert role_of(_type("Page")) == "page"
    assert role_of(_type("Tag")) == "tag"
    assert role_of(_type("Task")) == "task"
    assert role_of(_type("DailyNote")) == "dailyNote"
    assert role_of(_type("Whiteboard")) == "whiteboard"
    assert role_of(_type("Weblink")) == "weblink"
    assert role_of(_type("File")) == "file"
    assert role_of(_type("Image")) == "image"
    assert role_of(_type("PDF")) == "pdf"
    assert role_of(_type("Audio")) == "audio"
    assert role_of(_type("Video")) == "video"
    assert role_of(_type("Tweet")) == "tweet"
    assert role_of(_type("Person", basic=False)) == "entity"
    assert role_of(_type("Image", basic=False)) == "entity"
    assert role_of(None) == "entity"
