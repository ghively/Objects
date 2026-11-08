"""Synthetic 5,000-object space for the back-end performance audit (2026-11-01).

Only invented data. Usage: ``uv run python scripts/audit-2026-11-01/perf-backend/gen_space.py <dest>``

Layout: 10 types (page, person, task, tag, dailynote, whiteboard, project, meeting, book,
idea), ~5,000 objects: 300 daily notes, 200 tasks (recurrence + reminders), 100 tags,
20 whiteboards (with board sidecars holding entity blocks), the rest pages/people/projects/
meetings/books/ideas. Bodies 2–50 KB with headings, lists, tables, code, embeds. About
ten ``[[…]]`` links per object (plus relation properties), one hub object with 200
referrers (``Hub Object``), 25 collections, 25 queries, 50 PNG attachments all referenced
by ``Pages/Media heavy page.md``.
"""

from __future__ import annotations

import json
import random
import struct
import sys
import zlib
from pathlib import Path

SYSTEM_PROPS = [
    ("title", "Title", "entity_title", {}),
    ("collections", "Collections", "entity_collections", {}),
    ("description", "Description", "entity_description", {}),
    ("createdAt", "Created at", "entity_createdAt", {}),
    ("lastUpdated", "Last updated", "entity_lastUpdated", {}),
    ("tags", "Tags", "entity_tags", {"isArray": True, "allowedTypes": ["tag"]}),
    ("icon", "Icon", "entity_icon", {}),
    ("aliases", "Aliases", "entity_aliases", {"isArray": True}),
]

STATUS_SET = [
    {"id": "not-started", "text": "Not Started", "color": "red", "icon": None, "statusCategory": "not-started"},
    {"id": "next-up", "text": "Next Up", "color": "yellow", "icon": None, "statusCategory": "not-started"},
    {"id": "in-progress", "text": "In Progress", "color": "blue", "icon": None, "statusCategory": "in-progress"},
    {"id": "on-hold", "text": "On Hold", "color": "pink", "icon": None, "statusCategory": "blocked"},
    {"id": "done", "text": "Done", "color": "green", "icon": None, "statusCategory": "done"},
]
PRIORITY_SET = [
    {"id": "low", "text": "Low", "color": "amber", "icon": None},
    {"id": "medium", "text": "Medium", "color": "orange", "icon": None},
    {"id": "high", "text": "High", "color": "red", "icon": None},
]
STATUS_TEXTS = [s["text"] for s in STATUS_SET]

# id, name, plural, folder, basic, custom props [(key, name, type, options)]
TYPES = [
    ("page", "Page", "Pages", "Pages", True, [
        ("related", "Related", "entity", {"isArray": True, "allowedTypes": [], "hasFixedSet": False, "fixedSet": []}),
        ("when", "When", "datetime", {"constraints": {"resolutionPreference": "time"}}),
    ]),
    ("person", "Person", "People", "People", False, [
        ("birthday", "Birthday", "datetimeSimple", {"constraints": {"resolutionPreference": "day"}}),
        ("manager", "Manager", "entity", {"isArray": False, "allowedTypes": ["person"], "hasFixedSet": False, "fixedSet": []}),
        ("email", "Email", "text", {}),
    ]),
    ("task", "Task", "Tasks", "Tasks", True, [
        ("status", "Status", "label", {"isArray": False, "isStatus": True, "set": STATUS_SET}),
        ("priority", "Priority", "label", {"isArray": False, "set": PRIORITY_SET}),
        ("date", "Date", "datetimeSimple", {"constraints": {"resolutionPreference": "day", "endTimeSettings": "notAllowed", "supportsReminders": True}}),
        ("deadline", "Deadline", "datetimeSimple", {"constraints": {"resolutionPreference": "day", "endTimeSettings": "notAllowed", "supportsReminders": True}}),
        ("completed", "Completed", "datetimeSimple", {"constraints": {"resolutionPreference": "time", "endTimeSettings": "notAllowed"}}),
        ("repeat", "Repeat", "text", {}),
        ("remind", "Remind", "text", {}),
    ]),
    ("tag", "Tag", "Tags", "Tags", True, []),
    ("dailynote", "DailyNote", "DailyNotes", "DailyNotes", True, [
        ("date", "Date", "datetime", {"isArray": False, "constraints": {"resolutionPreference": "day"}}),
        ("reviewed", "Reviewed", "boolean", {"isArray": False}),
    ]),
    ("whiteboard", "Whiteboard", "Whiteboards", "Whiteboards", True, []),
    ("project", "Project", "Projects", "Projects", False, [
        ("status", "Status", "label", {"isArray": False, "isStatus": True, "set": STATUS_SET}),
        ("members", "Members", "entity", {"isArray": True, "allowedTypes": ["person"], "hasFixedSet": False, "fixedSet": []}),
        ("summary", "Summary", "text", {}),
        ("due", "Due", "datetimeSimple", {"constraints": {"resolutionPreference": "day", "supportsReminders": True}}),
        ("budget", "Budget", "number", {}),
    ]),
    ("meeting", "Meeting", "Meetings", "Meetings", False, [
        ("when", "When", "datetime", {"constraints": {"resolutionPreference": "time"}}),
        ("attendees", "Attendees", "entity", {"isArray": True, "allowedTypes": ["person"], "hasFixedSet": False, "fixedSet": []}),
        ("project", "Project", "entity", {"isArray": False, "allowedTypes": ["project"], "hasFixedSet": False, "fixedSet": []}),
    ]),
    ("book", "Book", "Books", "Books", False, [
        ("author", "Author", "entity", {"isArray": True, "allowedTypes": ["person"], "hasFixedSet": False, "fixedSet": []}),
        ("rating", "Rating", "number", {}),
        ("finished", "Finished", "boolean", {"isArray": False}),
    ]),
    ("idea", "Idea", "Ideas", "Ideas", False, [
        ("related", "Related", "entity", {"isArray": True, "allowedTypes": [], "hasFixedSet": False, "fixedSet": []}),
        ("score", "Score", "number", {}),
    ]),
]
FOLDER = {t[0]: t[3] for t in TYPES}
NAME = {t[0]: t[1] for t in TYPES}

WORDS = (
    "aurora basalt cobalt dune ember fjord glacier harbor island juniper kestrel lagoon "
    "meadow nimbus orchard prairie quartz ridge summit tundra umber valley willow zenith "
    "the a of and to in with for on about from note idea plan draft review list item value "
    "result source detail meeting summary topic thread step point record anchor beacon canyon "
    "delta estuary fathom granite horizon inlet jetty keel lantern marsh"
).split()


def _type_json(tid: str, name: str, plural: str, folder: str, basic: bool, custom) -> dict:
    props = []
    for key, pname, kind, options in SYSTEM_PROPS + custom:
        props.append({
            "id": key, "key": key, "name": pname, "type": kind, "description": "",
            "icon": {"type": "iconify", "val": "ph-circle"}, "visibility": "alwaysShow",
            "options": options,
        })
    return {
        "schemaVersion": 2, "id": tid, "name": name, "pluralName": plural, "folder": folder,
        "formerNames": [], "icon": {"type": "iconify", "val": "ph-file-text"}, "color": "gray",
        "description": "", "basic": basic, "propertyDefinitions": props,
        "collectionsPropertyPosition": 0, "viewDesign": None, "font": "sans-serif",
        "wideLayoutMode": False, "wideCoverImage": False, "cropCoverImage": True,
        "templates": {"ids": [], "defaultTemplateId": None},
    }


def _png(rng: random.Random) -> bytes:
    """A tiny valid 4x4 RGB PNG with random pixels."""
    w = h = 4
    raw = b"".join(b"\x00" + bytes(rng.randrange(256) for _ in range(w * 3)) for _ in range(h))

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def _sentence(rng: random.Random, n: int) -> str:
    return " ".join(rng.choice(WORDS) for _ in range(n)).capitalize() + "."


def _body(rng: random.Random, size: int, link_titles: list[str], attachments: list[str]) -> str:
    """Markdown of about ``size`` bytes with headings, lists, a table, code, embeds and links."""
    out: list[str] = []
    links = list(link_titles)
    rng.shuffle(links)
    total = 0
    section = 0
    while total < size:
        section += 1
        out.append(f"\n## Section {section} {rng.choice(WORDS)}\n")
        for _ in range(rng.randint(1, 3)):
            s = _sentence(rng, rng.randint(12, 40))
            if links and rng.random() < 0.5:
                s += f" See [[{links.pop()}]]."
            out.append(s + "\n")
        if rng.random() < 0.6:
            for _ in range(rng.randint(2, 6)):
                line = f"- {_sentence(rng, rng.randint(3, 9))}"
                if links and rng.random() < 0.3:
                    line += f" [[{links.pop()}]]"
                out.append(line)
            out.append("")
        if rng.random() < 0.3:
            out.append("| Item | Count | Note |\n| --- | --- | --- |")
            for _ in range(rng.randint(2, 6)):
                out.append(f"| {rng.choice(WORDS)} | {rng.randint(1, 99)} | {_sentence(rng, 3)} |")
            out.append("")
        if rng.random() < 0.2:
            out.append("```python\n" + "\n".join(f"x{i} = {rng.randint(1, 999)}" for i in range(rng.randint(2, 8))) + "\n```\n")
        if rng.random() < 0.15:
            out.append("> " + _sentence(rng, rng.randint(8, 20)) + "\n")
        if rng.random() < 0.15 and attachments:
            out.append(f"![figure]({rng.choice(attachments)})\n")
        if rng.random() < 0.1:
            out.append("<!-- indent -->\nParent paragraph.\n\nIndented child paragraph.\n<!-- /indent -->\n")
        if rng.random() < 0.08:
            out.append('Due <time datetime="2026-10-27">2026-10-27</time>.\n')
        total = sum(len(x) + 1 for x in out)
    while links:  # every planned link lands in the body
        out.append(f"Also [[{links.pop()}]].")
    return "\n".join(out) + "\n"


def _size(rng: random.Random) -> int:
    r = rng.random()
    if r < 0.6:
        return rng.randint(2_000, 5_000)
    if r < 0.9:
        return rng.randint(5_000, 15_000)
    return rng.randint(15_000, 50_000)


def make_space(root: Path, objects: int = 5000, seed: int = 7) -> dict:
    root = Path(root)
    rng = random.Random(seed)
    cap = root / ".object"
    for sub in ("types", "collections", "queries"):
        (cap / sub).mkdir(parents=True, exist_ok=True)
    for t in TYPES:
        (cap / "types" / f"{t[0]}.json").write_text(json.dumps(_type_json(*t), indent=2) + "\n", "utf-8")
    (cap / "space.json").write_text(json.dumps({"name": "Perf audit space"}) + "\n", "utf-8")
    (cap / "ui.json").write_text(json.dumps({"pinned": [], "calendar": {"weekStart": "monday"}}) + "\n", "utf-8")
    for folder in FOLDER.values():
        (root / folder).mkdir(parents=True, exist_ok=True)
    (root / "Attachments").mkdir(exist_ok=True)
    attachments = []
    for i in range(50):
        rel = f"Attachments/figure-{i:02d}.png"
        (root / rel).write_bytes(_png(rng))
        attachments.append(rel)

    # -- plan the population ------------------------------------------------------
    n_daily, n_task, n_tag, n_board = 300, 200, 100, 20
    rest = objects - n_daily - n_task - n_tag - n_board
    kinds: list[str] = (["dailynote"] * n_daily + ["task"] * n_task + ["tag"] * n_tag + ["whiteboard"] * n_board)
    rotation = ["page", "page", "page", "person", "project", "meeting", "book", "idea", "page", "person"]
    kinds += [rotation[i % len(rotation)] for i in range(rest)]
    titles: dict[str, list[str]] = {t[0]: [] for t in TYPES}
    plan: list[tuple[str, str]] = []  # (kind, title)
    counters: dict[str, int] = {}
    for kind in kinds:
        counters[kind] = counters.get(kind, 0) + 1
        n = counters[kind]
        if kind == "dailynote":
            # 300 days back from 2026-11-01
            from datetime import date, timedelta
            day = date(2026, 11, 1) - timedelta(days=n - 1)
            title = day.isoformat()
        else:
            title = f"{NAME[kind]} {n:04d} {rng.choice(WORDS).capitalize()}"
        titles[kind].append(title)
        plan.append((kind, title))
    hub_title = "Hub Object"
    plan[n_daily + n_task + n_tag + n_board] = ("page", hub_title)
    titles["page"][0] = hub_title
    all_titles = [t for k, t in plan if k not in ("dailynote", "whiteboard")]
    people = titles["person"]
    projects = titles["project"]
    tags = titles["tag"]

    collections = []
    for i in range(25):
        cid = f"collection-{i:02d}"
        type_ids = rng.sample(["page", "person", "project", "book", "idea", "meeting"], 2)
        collections.append((cid, f"Collection {i:02d}", type_ids))
        (cap / "collections" / f"{cid}.json").write_text(json.dumps({
            "schemaVersion": 1, "id": cid, "name": f"Collection {i:02d}", "formerNames": [],
            "icon": None, "color": None, "description": "Synthetic.", "typeIds": type_ids,
        }, indent=2) + "\n", "utf-8")
    for i in range(25):
        qid = f"query-{i:02d}"
        (cap / "queries" / f"{qid}.json").write_text(json.dumps({
            "schemaVersion": 1, "id": qid, "name": f"Query {i:02d}", "titleIsCustom": True,
            "icon": None, "description": "",
            "definition": {"types": [{"id": rng.choice(["task", "page", "project"])}],
                           "filterGroup": {"type": "filterGroup", "operator": "and", "elements": []},
                           "sorts": [], "groupBy": None},
            "view": {"viewDefinition": {"dataViewLayout": "list"}},
        }, indent=2) + "\n", "utf-8")

    # -- write objects -----------------------------------------------------------------
    hub_referrers = 0
    link_count = 0
    bytes_total = 0
    stamp_base = "2026-%02d-%02dT%02d:%02d:00.000Z"
    for i, (kind, title) in enumerate(plan, start=1):
        oid = f"01JD{i:022d}"
        created = stamp_base % (1 + (i % 10), 1 + (i % 28), (i // 60) % 24, i % 60)
        fm = ["---", f"id: {oid}", f"type: '{NAME[kind]}'", f"title: {title}",
              f"createdAt: {created}", "lastUpdated: 2026-10-31T12:00:00.000Z"]
        if rng.random() < 0.3:
            fm.append(f"description: {_sentence(rng, 8)}")
        if rng.random() < 0.1:
            fm.append(f"aliases: [{title.split()[0]} alias {i}]")
        body_links: list[str] = []
        if kind == "tag":
            body = f"Tag page for {title}.\n"
        elif kind == "dailynote":
            fm.append(f"date: {title}")
            if rng.random() < 0.5:
                fm.append("reviewed: true")
            body_links = rng.sample(all_titles, 4)
            body = _body(rng, 2000, body_links, attachments)
        elif kind == "whiteboard":
            body = f"Notes for {title}.\n"
        else:
            if kind != "whiteboard" and rng.random() < 0.34:
                fm.append("tags:")
                for t in rng.sample(tags, rng.randint(1, 3)):
                    fm.append(f"  - {t}")
            for cid, cname, type_ids in collections:
                if kind in type_ids and rng.random() < 0.08:
                    fm.append(f"collections: [{cname}]")
                    break
            if kind == "person":
                fm.append(f"birthday: 19{rng.randint(50, 99)}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}")
                fm.append(f'manager: "[[{rng.choice(people)}]]"')
                fm.append(f"email: person{i}@example.invalid")
            elif kind == "project":
                fm.append(f"status: {rng.choice(STATUS_TEXTS)}")
                fm.append("members:")
                for p in rng.sample(people, 3):
                    fm.append(f'  - "[[{p}]]"')
                fm.append(f'summary: "Follows on from [[{rng.choice(all_titles)}]]"')
                fm.append(f"due: 2026-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}")
                fm.append(f"budget: {rng.randint(100, 99999)}")
                if rng.random() < 0.3:
                    fm.append(f"reminders: {{due: '1 day before at 09:00'}}")
            elif kind == "meeting":
                fm.append(f"when: 2026-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}T{rng.randint(8, 17):02d}:00:00.000Z")
                fm.append("attendees:")
                for p in rng.sample(people, 2):
                    fm.append(f'  - "[[{p}]]"')
                fm.append(f'project: "[[{rng.choice(projects)}]]"')
            elif kind == "book":
                fm.append(f'author: ["[[{rng.choice(people)}]]"]')
                fm.append(f"rating: {rng.randint(1, 5)}")
                fm.append(f"finished: {'true' if rng.random() < 0.5 else 'false'}")
            elif kind == "idea":
                fm.append(f'related: ["[[{rng.choice(all_titles)}]]"]')
                fm.append(f"score: {rng.randint(1, 100)}")
            elif kind == "page":
                if rng.random() < 0.5:
                    fm.append(f'related: ["[[{rng.choice(all_titles)}]]", "[[{rng.choice(all_titles)}]]"]')
                if rng.random() < 0.2:
                    fm.append(f"when: 2026-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}T10:00:00.000Z")
            elif kind == "task":
                n = counters_task = int(title.split()[1])
                fm.append(f"status: {STATUS_TEXTS[n % len(STATUS_TEXTS)]}")
                fm.append(f"priority: {PRIORITY_SET[n % 3]['text']}")
                fm.append(f"date: 2026-{1 + n % 12:02d}-{1 + n % 28:02d}")
                if n % 3 == 0:
                    fm.append(f"deadline: 2026-{1 + (n + 1) % 12:02d}-{1 + (n + 3) % 28:02d}")
                if n % 2 == 0:
                    fm.append(rng.choice([
                        "repeat: every week on mon, fri", "repeat: every month on the last day",
                        "repeat: every day", "repeat: every month on the 2nd tuesday", "repeat: every 2 weeks",
                    ]))
                if n % 4 == 0:
                    fm.append(rng.choice(["remind: 15 minutes before", "remind: 1 day before at 09:00", "remind: at 08:00"]))
            body_links = rng.sample(all_titles, rng.randint(6, 12))
            if title != hub_title and hub_referrers < 200 and kind == "page":
                body_links.append(hub_title)
                hub_referrers += 1
            size = _size(rng) if kind != "task" else rng.randint(500, 3000)
            body = _body(rng, size, body_links, attachments)
        fm.append("---")
        link_count += len(body_links)
        text = "\n".join(fm) + "\n\n" + body
        if title == hub_title:
            text = "\n".join(fm) + "\n\n" + _body(rng, 50_000, rng.sample(all_titles, 10), attachments)
        rel = f"{FOLDER[kind]}/{title}.md"
        data = text.encode("utf-8")
        (root / rel).write_bytes(data)
        bytes_total += len(data)
        if kind == "whiteboard":
            nodes, blocks, order = {}, {}, []
            for j in range(12):
                nid, bid = f"n-{j}", f"b-{j}"
                if j % 3 == 0:
                    blocks[bid] = {"type": "entity", "link": f"[[{rng.choice(all_titles)}]]"}
                elif j % 3 == 1:
                    blocks[bid] = {"type": "text", "markdown": _sentence(rng, 10) + f" [[{rng.choice(all_titles)}]]"}
                else:
                    blocks[bid] = {"type": "weblink", "url": "https://example.invalid/x", "title": "x"}
                nodes[nid] = {"id": nid, "kind": "block", "position": {"x": j * 50, "y": 40}, "width": 200, "height": 100, "z": j + 1, "blockId": bid}
                order.append(nid)
            board = {"version": 1, "nodes": nodes, "edges": {}, "blocks": blocks, "readingOrder": order}
            (root / f"{FOLDER[kind]}/{title}.whiteboard.json").write_text(json.dumps(board, indent=2) + "\n", "utf-8")

    # A page referencing every attachment (for the export benchmark).
    media = ["---", "id: 01JDMEDIA0000000000000001", "type: 'Page'", "title: Media heavy page",
             "createdAt: 2026-10-01T00:00:00.000Z", "lastUpdated: 2026-10-31T12:00:00.000Z", "---", ""]
    media += [f"![fig {i}]({a})" for i, a in enumerate(attachments)]
    (root / "Pages" / "Media heavy page.md").write_text("\n".join(media) + "\n", "utf-8")

    stats = {"objects": len(plan) + 1, "body_links": link_count, "hub_referrers": hub_referrers,
             "bytes": bytes_total, "hub": f"Pages/{hub_title}.md"}
    (root / ".object" / "perf-stats.json").write_text(json.dumps(stats), "utf-8")
    return stats


if __name__ == "__main__":
    dest = Path(sys.argv[1])
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 5000
    print(json.dumps(make_space(dest, n)))
