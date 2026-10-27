"""A deterministic, generated large space for the M5 performance tests (M5 Task 1).

`make_big_space(root)` writes 5,000 synthetic objects with 50,000 links: titles
``Object 00001`` … across Page, Person, Project, Task and Tag; about ten links
per object, mostly ``[[…]]`` in the body, some in relation properties
(``manager``, ``members``) and some in a frontmatter text value (``summary``);
tags on a third of the objects; a few shared words for search. Every title is
unique, so each link resolves to exactly one object. All content is invented.
"""

from __future__ import annotations

import random
import shutil
from dataclasses import dataclass
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"
# The type definitions are the `space-links` ones (Person has `manager`, Project
# has `members` and `summary`).
_TYPE_FILES = ("page", "tag", "task", "person", "project", "dailynote")

_TAG_COUNT = 100
_FOLDERS = {"Page": "Pages", "Person": "People", "Project": "Projects", "Task": "Tasks", "Tag": "Tags"}
_ROTATION = ("Page", "Person", "Project", "Task")
_STATUSES = ("Not Started", "Next Up", "In Progress", "Done")

# Plain filler words, plus a sprinkling of rarer shared words for search.
_FILLER = (
    "the a of and to in with for on about from note idea plan draft review list item "
    "value result source detail meeting summary topic thread step point record"
).split()
SHARED_WORDS = ("aurora", "basalt", "cobalt", "dune", "ember", "fjord", "glacier", "harbor")


@dataclass(frozen=True)
class BigStats:
    objects: int
    links: int
    """Every ``[[…]]`` link written: body, relation and frontmatter text links."""
    distinct_pairs: int
    """Distinct unordered pairs of linked objects (no self links are written)."""
    sample_titles: tuple[str, ...]


def title_of(i: int) -> str:
    return f"Object {i:05d}"


def _type_of(i: int, objects: int) -> str:
    if i > objects - min(_TAG_COUNT, objects // 10):
        return "Tag"
    return _ROTATION[(i - 1) % len(_ROTATION)]


def _counts(rng: random.Random, objects: int, links: int) -> list[int]:
    """Links per object (about links/objects each), summing to exactly `links`."""
    base, extra = divmod(links, objects)
    counts = [base + (1 if j < extra else 0) for j in range(objects)]
    for j in range(objects):
        k = rng.randrange(objects)
        delta = rng.randint(-3, 3)
        if counts[j] + delta >= 1 and counts[k] - delta >= 1:
            counts[j] += delta
            counts[k] -= delta
    return counts


def _words(rng: random.Random, n: int) -> str:
    out = [rng.choice(_FILLER) for _ in range(n)]
    if rng.random() < 0.2:
        out[rng.randrange(n)] = rng.choice(SHARED_WORDS)
    return " ".join(out)


def make_big_space(root: Path, objects: int = 5000, links: int = 50000, seed: int = 1) -> BigStats:
    """Write the space into `root` (created if missing) and return what was written."""
    root = Path(root)
    rng = random.Random(seed)
    types_dir = root / ".capacities" / "types"
    types_dir.mkdir(parents=True, exist_ok=True)
    for name in _TYPE_FILES:
        shutil.copyfile(FIXTURES / "space-links" / ".capacities" / "types" / f"{name}.json",
                        types_dir / f"{name}.json")
    for folder in _FOLDERS.values():
        (root / folder).mkdir(parents=True, exist_ok=True)

    kinds = {i: _type_of(i, objects) for i in range(1, objects + 1)}
    people = [i for i, k in kinds.items() if k == "Person"]
    tags = [i for i, k in kinds.items() if k == "Tag"]
    counts = _counts(rng, objects, links)

    def other(i: int, pool: list[int] | None = None) -> int:
        while True:
            j = rng.choice(pool) if pool else rng.randint(1, objects)
            if j != i:
                return j

    written = 0
    pairs: set[tuple[int, int]] = set()
    for i in range(1, objects + 1):
        kind = kinds[i]
        budget = counts[i - 1]
        targets: list[int] = []

        fm = [
            "---",
            f"id: 01JC5B16{i:018d}",
            f"type: '{kind}'",
            f"title: {title_of(i)}",
            f"createdAt: 2026-01-01T{(i // 60) % 24:02d}:{i % 60:02d}:00.000Z",
            "lastUpdated: 2026-02-01T00:00:00.000Z",
        ]
        if kind == "Person" and budget > 1 and len(people) > 1:
            j = other(i, people)
            targets.append(j)
            fm.append(f'manager: "[[{title_of(j)}]]"')
        if kind == "Project" and budget > 3 and len(people) > 2:
            fm.append("members:")
            for _ in range(2):
                j = other(i, people)
                targets.append(j)
                fm.append(f'  - "[[{title_of(j)}]]"')
            if i % 5 == 0:
                j = other(i)
                targets.append(j)
                fm.append(f'summary: "Follows on from [[{title_of(j)}]]"')
        if kind == "Task":
            fm.append(f"status: {_STATUSES[i % len(_STATUSES)]}")
        if kind != "Tag" and i % 3 == 0 and tags:
            fm.append("tags:")
            for t in sorted({rng.choice(tags) for _ in range(rng.randint(1, 2))}):
                fm.append(f"  - {title_of(t)}")
        fm.append("---")

        body: list[str] = [_words(rng, 8).capitalize() + "."]
        while len(targets) < budget:
            j = other(i)
            targets.append(j)
            if rng.random() < 0.3:
                body.append(f"- {_words(rng, 3)} [[{title_of(j)}]]")
            else:
                body.append(f"{_words(rng, 5).capitalize()} [[{title_of(j)}]] {_words(rng, 4)}.")
        written += len(targets)
        pairs.update((min(i, j), max(i, j)) for j in targets)

        text = "\n".join(fm) + "\n\n" + "\n".join(body) + "\n"
        rel = f"{_FOLDERS[kind]}/{title_of(i)}.md"
        (root / rel).write_bytes(text.encode("utf-8"))

    sample = tuple(title_of(i) for i in sorted(random.Random(seed + 1).sample(range(1, objects + 1), 20)))
    return BigStats(objects=objects, links=written, distinct_pairs=len(pairs), sample_titles=sample)
