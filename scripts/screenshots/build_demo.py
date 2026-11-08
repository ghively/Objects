"""Build the synthetic demo space the README screenshots are taken from.

    OBJECT_STATE_DIR=<tmp>/state OBJECT_CACHE_DIR=<tmp>/cache \
        uv run python scripts/screenshots/build_demo.py <tmp>/demo

Writes ``<tmp>/demo/Studio Notebook``. Every person, project, book and note in it is
invented; nothing here comes from real data. The covers are generated gradients.
"""

from __future__ import annotations

import random
import sys
from datetime import date, timedelta
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

from objectapp.space import Space
from objectapp.spaces import create_space

TODAY = date(2026, 11, 8)


def cover(path: Path, size: tuple[int, int], c1: str, c2: str) -> None:
    """A soft diagonal gradient from `c1` to `c2` with a few translucent circles."""
    w, h = size
    img = Image.new("RGB", size, c1)
    mask = Image.linear_gradient("L").rotate(35, expand=True).resize(size)
    img = Image.composite(Image.new("RGB", size, c2), img, mask)
    d = ImageDraw.Draw(img, "RGBA")
    for _ in range(7):
        r = random.randint(min(w, h) // 6, min(w, h) // 2)
        x, y = random.randint(-r, w), random.randint(-r, h)
        d.ellipse([x, y, x + r * 2, y + r * 2], fill=(255, 255, 255, random.randint(14, 38)))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.filter(ImageFilter.GaussianBlur(2)).save(path, optimize=True)


def day(offset: int) -> str:
    return (TODAY + timedelta(days=offset)).isoformat()


def main(out: Path) -> Path:
    random.seed(7)
    root = create_space("Studio Notebook", out, setup="basic")
    att = root / "Attachments"

    # A Task type and a Tag type come from files of those types, as a user's first task or tag would.
    (root / "Tasks").mkdir()
    (root / "Tags").mkdir()
    for t, color in (("Design", "purple"), ("Research", "blue"), ("Garden", "green"), ("Reading", "orange")):
        (root / "Tags" / f"{t}.md").write_text(f"---\ntype: 'Tag'\ntitle: {t}\ncolor: {color}\n---\n", encoding="utf-8")
    seed = root / "Tasks" / "_seed.md"
    seed.write_text("---\ntype: 'Task'\ntitle: seed\n---\n", encoding="utf-8")
    sp = Space(root)

    def make(type_id: str, title: str, values: dict | None = None, body: str = "") -> str:
        path, _v = sp.create_object(type_id, title, template_id="none", values=values or {}, body=body)
        return path

    def ref(path: str) -> dict:
        return {"target": Path(path).stem, "path": path}

    people = {}
    for name, cat, c1, c2 in (
        ("Maya Chen", "Colleague", "#7c5cff", "#3fb6ff"),
        ("Theo Okafor", "Colleague", "#ff7a59", "#ffb347"),
        ("Lena Varga", "Artist", "#00b894", "#55efc4"),
        ("Sam Rivera", "Friends", "#e84393", "#fd79a8"),
        ("Priya Nair", "Academic", "#0984e3", "#74b9ff"),
        ("Jonas Berg", "Author", "#6c5ce7", "#a29bfe"),
    ):
        img = att / f"{name.split()[0].lower()}.png"
        cover(img, (800, 400), c1, c2)
        people[name] = make("person", name, {"category": [cat], "coverImage": f"Attachments/{img.name}"},
                            f"{name.split()[0]} works with us on the studio's projects.\n")

    projects = {}
    for title, status, ptype, c1, c2, collab, start, end in (
        ("Atlas design system", "In Progress", "Work", "#5f27cd", "#48dbfb", ["Maya Chen", "Theo Okafor"], "2026-09-01", "2026-12-15"),
        ("Field guide app", "Planned", "Work", "#10ac84", "#c8f7c5", ["Priya Nair", "Lena Varga"], "2026-12-01", "2027-03-31"),
        ("Kitchen garden", "In Progress", "Personal", "#2ecc71", "#f6e58d", ["Sam Rivera"], "2026-03-01", "2026-11-30"),
        ("Studio website", "On Hold", "Work", "#ee5253", "#feca57", ["Theo Okafor"], "2026-07-01", "2026-12-31"),
        ("Printmaking course", "Completed", "Personal", "#341f97", "#ff9ff3", ["Lena Varga"], "2026-02-01", "2026-06-30"),
    ):
        img = att / f"{title.split()[0].lower()}-cover.png"
        cover(img, (1400, 560), c1, c2)
        projects[title] = make(
            "project", title,
            {"status": [status], "projectType": [ptype],
             "timeframe": {"start": start, "end": end, "resolution": "day"},
             "collaborators": [ref(people[p]) for p in collab], "coverImage": f"Attachments/{img.name}"},
            f"Goals, notes and decisions for **{title}**.\n\n" + "".join(f"- Working with [[{p}]]\n" for p in collab),
        )

    for title, author, genre, btype, rating, c1, c2 in (
        ("The Quiet Grid", "Jonas Berg", ["Art", "Education"], "Non-fiction", 5, "#2d3436", "#636e72"),
        ("Salt and Cedar", "Lena Varga", ["Literary Fiction"], "Fiction", 4, "#b33939", "#ff793f"),
        ("Small Rooms", "Jonas Berg", ["Classic"], "Fiction", 4, "#218c74", "#33d9b2"),
        ("Patterns of Making", "Priya Nair", ["Crafts & Hobbies", "Art"], "Non-fiction", 5, "#40407a", "#706fd3"),
        ("The Long Season", "Sam Rivera", ["Home & Garden"], "Non-fiction", 3, "#cc8e35", "#ffda79"),
        ("Paper Tides", "Lena Varga", ["Adventure"], "Fiction", 4, "#227093", "#34ace0"),
    ):
        img = att / f"{title.lower().replace(' ', '-')}.png"
        cover(img, (600, 900), c1, c2)
        make("book", title,
             {"authors": [ref(people[author])], "genre": genre, "bookType": [btype], "rating": rating,
              "coverImage": f"Attachments/{img.name}"},
             f"Notes on *{title}* by [[{author}]].\n")

    for title, off, hhmm, mtype, who, proj in (
        ("Atlas weekly sync", 0, "10:00", "Team Meeting", ["Maya Chen", "Theo Okafor"], "Atlas design system"),
        ("Field guide kickoff", 1, "14:00", "Workshop", ["Priya Nair", "Lena Varga"], "Field guide app"),
        ("Check-in with Maya", 2, "09:30", "One-on-One", ["Maya Chen"], "Atlas design system"),
        ("Website review", -2, "15:00", "Presentation", ["Theo Okafor"], "Studio website"),
        ("Garden planning", 3, "11:00", "Brainstorming", ["Sam Rivera"], "Kitchen garden"),
        ("Type tokens workshop", -1, "13:00", "Workshop", ["Maya Chen", "Priya Nair"], "Atlas design system"),
    ):
        make("meeting", title,
             {"date": {"start": f"{day(off)}T{hhmm}:00.000Z", "resolution": "time"}, "meetingType": [mtype],
              "attendees": [ref(people[p]) for p in who], "project": [ref(projects[proj])], "reviewed": off < 0},
             "## Agenda\n\n- Where we are\n- What's blocked\n- Next steps\n\n## Notes\n\n")

    for title, status, prio, off, proj in (
        ("Draft colour tokens", "In Progress", "High", 1, "Atlas design system"),
        ("Audit button states", "Next Up", "Medium", 3, "Atlas design system"),
        ("Write field guide brief", "Not Started", "Medium", 6, "Field guide app"),
        ("Order seed potatoes", "Done", "Low", -3, "Kitchen garden"),
        ("Prune the tomatoes", "Not Started", "Low", 2, "Kitchen garden"),
        ("Pick a hosting plan", "On Hold", "Medium", 10, "Studio website"),
        ("Send course feedback", "Done", "Low", -10, "Printmaking course"),
        ("Review icon set", "Next Up", "High", 0, "Atlas design system"),
    ):
        make("task", title, {"status": [status], "priority": [prio], "date": {"start": day(off), "resolution": "day"}},
             f"Part of [[{proj}]].\n")

    make("page", "Welcome", {}, """Everything in this space is a plain Markdown file in a folder you own.

## This week

- [x] Kick off the [[Atlas design system]] colour work
- [ ] Prepare the [[Field guide kickoff]] workshop
- [ ] Finish *[[Salt and Cedar]]*

> **Objects link to objects.** Type `[[` to link a person, project or book. Backlinks and unlinked mentions show up on the other side.

## Reading pace

| Month | Books | Pages |
|---|---:|---:|
| September | 2 | 640 |
| October | 3 | 910 |
| November | 1 | 280 |

## A formula, a diagram and some code

The reading pace is $p = \\frac{pages}{days}$.

```mermaid
flowchart LR
  Idea --> Sketch --> Prototype --> Ship
```

```python
def pace(pages: int, days: int) -> float:
    return pages / days
```
""")
    make("page", "Design principles", {"tags": ["Design"]},
         "1. **Plain files first.** Every note stays readable without the app.\n"
         "2. **Small, honest UI.** One way to do each thing.\n"
         "3. **Link everything.** [[Maya Chen]] and [[Theo Okafor]] own the [[Atlas design system]].\n")
    make("page", "Garden log", {"tags": ["Garden"]},
         "Notes from the [[Kitchen garden]] with [[Sam Rivera]]. Planted beans, chard and two rows of potatoes.\n")
    make("page", "Reading notes", {"tags": ["Reading"]},
         "Favourites this year: *[[The Quiet Grid]]* and *[[Patterns of Making]]*. Next up: *[[Paper Tides]]*.\n")

    for off in (-2, -1, 0):
        sp.create_daily_note(day(off))
    seed.unlink()
    return root


if __name__ == "__main__":
    print(main(Path(sys.argv[1])))
