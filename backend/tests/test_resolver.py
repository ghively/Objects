"""The fast resolver equals M1/M2's linear `Space.resolve` (M5 Task 2)."""

import os
import random
import shutil
import time
from pathlib import Path, PurePosixPath

import pytest
from objectapp.space import Space, _str_list

FIXTURES = Path(__file__).parent / "fixtures"
SLACK = float(os.environ.get("OBJECT_PERF_SLACK", "1"))


def _candidates(link: str) -> list[str]:
    text = link.strip()
    if text.startswith("[[") and text.endswith("]]"):
        text = text[2:-2].strip()
    out = [text]
    for sep in ("|", "#"):
        for c in list(out):
            if sep in c:
                head = c.split(sep, 1)[0].strip()
                if head not in out:
                    out.append(head)
    return [c for c in out if c]


def reference_resolve(space: Space, link: str, from_path: str | None) -> str | None:
    """A copy of `Space.resolve` as it stood before M5 (M1/M2's linear algorithm)."""
    candidates = _candidates(link)
    for text in candidates:
        found = space._summaries.get(f"{text}.md") if "/" in text else None
        if found is not None and found.template is None:
            return found.path
    from_folder = None
    if from_path:
        from_folder = PurePosixPath(str(from_path).replace("\\", "/")).parent.as_posix()
    summaries = [s for s in space._summaries.values() if s.template is None]
    aliases = {
        rel: [a.lower() for a in _str_list(raw.fm.get("aliases"))]
        for rel, raw in space._raw.items()
    }

    def folder(s) -> str:
        return PurePosixPath(s.path).parent.as_posix()

    def best(matches):
        if not matches:
            return None
        matches.sort(
            key=lambda s: (
                folder(s) != from_folder,
                s.createdAt is None,
                s.createdAt or "",
                s.path,
            )
        )
        return matches[0].path

    for text in candidates:
        low = text.lower()
        steps = (
            lambda s: s.title == text,  # noqa: B023 - used before the loop moves on
            lambda s: low in aliases.get(s.path, ()),  # noqa: B023
            lambda s: (
                s.title.lower() == low or PurePosixPath(s.path).stem.lower() == low
            ),  # noqa: B023
        )
        for match in steps:
            found = best([s for s in summaries if match(s)])
            if found:
                return found
    return None


def _link_texts(space: Space) -> list[str]:
    texts: set[str] = {"Nobody Here", "", "   ", "[[]]", "a/b", "Pages/Nope"}
    for s in space._summaries.values():
        stem = PurePosixPath(s.path).stem
        names = [s.title, stem, s.path[:-3], *s.aliases]
        for n in names:
            texts |= {n, n.lower(), n.upper(), f"[[{n}]]", f"{n}|label", f"{n}#Heading",
                      f"{n}#Heading|label", f" {n} "}  # fmt: skip
    return sorted(texts)


def _from_paths(space: Space) -> list[str | None]:
    return [None, "", "Elsewhere/new.md", "root.md", *sorted(space._summaries)]


def _assert_same(space: Space) -> int:
    n = 0
    froms = _from_paths(space)
    for text in _link_texts(space):
        for fp in froms:
            assert space.resolve(text, fp) == reference_resolve(space, text, fp), (
                text,
                fp,
            )
            n += 1
    return n


def _write(root: Path, rel: str, fm: dict, body: str = "") -> None:
    lines = ["---"]
    for k, v in fm.items():
        if isinstance(v, list):
            lines.append(f"{k}:")
            lines += [f"  - '{x}'" for x in v]
        else:
            lines.append(f"{k}: '{v}'")
    lines.append("---")
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text("\n".join(lines) + "\n\n" + body, encoding="utf-8")


def _random_space(root: Path, seed: int = 7) -> None:
    rng = random.Random(seed)
    folders = ["", "A", "B", "A/Deep", "Pages", "Templates/Pages"]
    titles = ["Alpha", "alpha", "Beta", "Gamma", "ALPHA", "Delta Ray", "Echo"]
    for i in range(60):
        folder = rng.choice(folders)
        title = rng.choice(titles)
        fm: dict = {"type": rng.choice(["Page", "Person"]), "title": title}
        if rng.random() < 0.7:
            fm["createdAt"] = (
                f"2026-0{rng.randint(1, 9)}-0{rng.randint(1, 9)}T00:00:00.000Z"
            )
        if rng.random() < 0.3:
            fm["aliases"] = [rng.choice(titles + ["Zed", "zed", "Omega"])]
        if folder.startswith("Templates") or rng.random() < 0.05:
            fm["template"] = title
        stem = rng.choice([title, f"{title} {i}", f"file{i}", "Alpha"])
        rel = f"{folder}/{stem}.md" if folder else f"{stem}.md"
        if (root / rel).exists() or any(
            p.as_posix().lower() == (root / rel).as_posix().lower()
            for p in root.rglob("*.md")
        ):
            rel = rel[:-3] + f" ({i}).md"
        _write(root, rel, fm, f"Body {i}")


def test_fast_resolver_matches_reference_resolver(
    links_space_dir: Path,
    full_space_dir: Path,
    calendar_space_dir: Path,
    tmp_path: Path,
):
    v1 = tmp_path / "space-v1"
    shutil.copytree(FIXTURES / "space-v1", v1)
    rnd = tmp_path / "random"
    rnd.mkdir()
    _random_space(rnd)
    total = 0
    for root in (links_space_dir, full_space_dir, v1, calendar_space_dir, rnd):
        total += _assert_same(Space(root))
    assert total > 10_000
    # The resolution order the fixture was built for.
    space = Space(links_space_dir)
    assert (
        space.resolve("Ada Lovelace", "Pages/Analytical Engine.md")
        == "People/Ada Lovelace.md"
    )
    assert (
        space.resolve("Ada Lovelace", "Archive/Mention from archive.md")
        == "Archive/Ada Lovelace.md"
    )
    assert space.resolve("Ada", None) == "People/Ada Lovelace.md"
    assert space.resolve("Linking template", None) is None


def test_resolver_invalidated_on_names_change(links_space_dir: Path):
    space = Space(links_space_dir)
    src = "Pages/Analytical Engine.md"
    assert space.resolve("Babbage", src) is None
    # Adding an alias.
    rel = "People/Charles Babbage.md"
    space.update_properties(rel, {"aliases": ["Babbage"]}, space.cached_version(rel))
    assert space.resolve("Babbage", src) == rel
    assert space.resolve("Babbage", src) == reference_resolve(space, "Babbage", src)
    # Renaming.
    renamed = space.rename_object(rel, "Charles B", space.cached_version(rel)).path
    assert renamed == "People/Charles B.md"
    assert space.resolve("Charles B", src) == renamed
    assert space.resolve("Charles Babbage", src) is None
    # A same-title object in the linking folder wins.
    path, _version = space.create_object("page", "Charles B")
    assert space.resolve("Charles B", src) == path
    assert space.resolve("Charles B", "People/Ada Lovelace.md") == renamed
    # Deleting.
    space.delete_object(path, space.cached_version(path))
    assert space.resolve("Charles B", src) == renamed
    _assert_same(space)


def test_resolve_50000_links_under_1s(big_space_dir: Path, big_space_stats):
    space = Space(big_space_dir)
    titles = list(big_space_stats.sample_titles) or ["Object 00001"]
    froms = sorted(space._summaries)
    rng = random.Random(3)
    pairs = [
        (f"Object {rng.randint(1, big_space_stats.objects):05d}", rng.choice(froms))
        for _ in range(50_000)
    ]
    space.resolve(titles[0], froms[0])  # builds the resolver
    t0 = time.perf_counter()
    for link, fp in pairs:
        space.resolve(link, fp)
    elapsed = time.perf_counter() - t0
    assert elapsed < 1.0 * SLACK, elapsed
    for link, fp in pairs[:50]:
        assert space.resolve(link, fp) == reference_resolve(space, link, fp)


@pytest.mark.parametrize(
    "link", ["[[Ada Lovelace|x]]", "Ada Lovelace#Life", " ada lovelace "]
)
def test_forms_resolve_like_reference(links_space_dir: Path, link: str):
    space = Space(links_space_dir)
    for fp in _from_paths(space):
        assert space.resolve(link, fp) == reference_resolve(space, link, fp)
