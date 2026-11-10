"""API error messages read as full sentences (fidelity sweep 2026-11-08, item 26).

Every message the backend answers with as ``detail`` (shown verbatim by the frontend's
``errorText()`` and toasts) starts with a capital letter or an opening quote, ends with a full
stop, question mark or exclamation mark, and quotes names with plain double quotes instead of
Python's ``!r`` repr.

The sources are walked with ``ast``: the string literals and f-strings passed to the
routers' ``_error``/``error`` helpers and to the detail-carrying exceptions (``Problem``,
``RuleRefused``, ``_Hide``, ``HTTPException``), the ``{"detail": ...}`` dict entries, and the
module-level constants those sites use (``NO_BATCH``, ``media.UPLOAD_LIMIT_DETAIL``, ...).
Messages built by domain code and forwarded with ``str(exc)`` are checked where they are made:
the literals passed to the constructors of those domain exceptions (``DETAIL_EXCEPTIONS``).
"""

from __future__ import annotations

import ast
from pathlib import Path

import objectapp

PACKAGE = Path(objectapp.__file__).parent
SOURCES = sorted(PACKAGE.glob("*.py")) + sorted((PACKAGE / "importers").glob("*.py"))

DETAIL_HELPERS = {"_error", "error", "Problem", "RuleRefused", "_Hide", "HTTPException"}
# Domain exceptions whose text the routers forward as the detail (`str(exc)` / `exc.message` /
# `exc.detail`); review 2026-11-08, NIT 8. Their constructor's literal is the message the user reads.
DETAIL_EXCEPTIONS = {
    "InvalidValue", "TemplateError", "AgentNotFound", "AgentInvalid", "AgentConflict", "AgentReadOnly",
    "SpaceNotFound", "SpaceIsCurrent", "SpaceFolderChanged", "SpaceNameProblem", "TrashUnavailable",
    "QueueRefused", "SeamRefused", "SeamUnavailable", "NotWorkItem", "IllegalMove", "ApiError",
    "FormulaError", "ProposalInvalid", "MappingProblem", "BoardInvalid", "BoardReadOnly",
    "NotAWhiteboard", "FrontmatterError", "SettingsProblem", "SpaceConfigProblem", "ConfirmRequired",
    "DailyNoteExists", "RestoreConflict", "ReadOnly", "TypeReadOnly", "RunRefused", "SkillError",
    "SkillConflict", "LearningInvalid", "Busy", "Denied", "LimitExceeded", "NotASource",
    "DelegationError",
}
# Not here: `SourceDamaged` (its text is a skipped file's note in the import report, not a detail)
# and `SourceMissing` (the route answers its own sentence).
DETAIL_HELPERS = DETAIL_HELPERS | DETAIL_EXCEPTIONS
# Constructors whose message is not their first argument: only that argument is the message
# (``SettingsProblem(key, message)``, ``ConfirmRequired(affected, detail)``, ...).
MESSAGE_ARG = {"SettingsProblem": 1, "SpaceConfigProblem": 1, "ConfirmRequired": 1, "DailyNoteExists": 1}
# Names that open a message and always hold a capitalised subject built next to it:
# whiteboardfile's ``owner = f"Block {key}"``, automations' ``where = f"Action {n}"``,
# workvalues' ``_one_line(..., "A step", ...)``.
SUBJECTS = {"owner", "where", "what"}
# Names that close a message and hold another message this walk checks where it is made
# (``f"{where}: {exc}"`` forwards an `InvalidValue`).
FORWARDED = {"exc"}
# Messages that put a status code before the app's own detail, which is checked at its source
# (the MCP tools answer "403: This token can only read.").
STATUS_PREFIXED = {
    "f'{res.status_code}: {detail} {json.dumps(extra, default=str)}'",
    "f'{res.status_code}: {detail or body}'",
    "f'Conflict: {detail}'",  # a 409 refusal without a version (decision S5's delete_collection)
}
DETAIL_KEYWORDS = {"detail", "message"}

# Messages that must keep their exact text (the frontend compares against them). Each entry
# names the file that compares; keep the list to those, so the style covers everything else.
# None today: the 2026-11-08 sweep found no frontend comparison against a detail it changed.
KEPT_FOR_FRONTEND: dict[str, str] = {
    # M30 (design 5a): an imported Source's read-only reason, shown as a label on the object page
    # ("Imported source"), so it stays a label, not a sentence.
    "Imported source": "importers/sources.py SOURCE_READ_ONLY",
}


def _is_text(node: ast.AST) -> bool:
    return (isinstance(node, ast.Constant) and isinstance(node.value, str)) or isinstance(
        node, ast.JoinedStr
    )


def _module_constants(tree: ast.Module) -> dict[str, tuple[int, ast.AST]]:
    out: dict[str, tuple[int, ast.AST]] = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, ast.Name) and _is_text(node.value):
                out[target.id] = (node.lineno, node.value)
    return out


def _imports(tree: ast.Module) -> tuple[dict[str, str], dict[str, str]]:
    """``from .mod import NAME`` as {NAME: mod} and ``from . import mod`` / ``import mod`` as {alias: mod}."""
    names: dict[str, str] = {}
    modules: dict[str, str] = {}
    for node in tree.body:
        if isinstance(node, ast.ImportFrom):
            if node.module is None and node.level:
                for alias in node.names:
                    modules[alias.asname or alias.name] = alias.name
            elif node.module:
                mod = node.module.split(".")[-1]
                for alias in node.names:
                    names[alias.asname or alias.name] = mod
        elif isinstance(node, ast.Import):
            for alias in node.names:
                modules[alias.asname or alias.name] = alias.name.split(".")[-1]
    return names, modules


def collect_messages() -> list[tuple[str, ast.AST]]:
    """Every (location, literal node) the API answers with as a detail."""
    trees = {p: ast.parse(p.read_text(encoding="utf-8")) for p in SOURCES}
    constants = {p.stem: _module_constants(t) for p, t in trees.items()}
    found: list[tuple[str, ast.AST]] = []
    seen: set[tuple[str, int]] = set()

    def add(path: Path, node: ast.AST) -> None:
        key = (str(path), node.lineno)
        if key not in seen:
            seen.add(key)
            found.append((f"{path.relative_to(PACKAGE.parent)}:{node.lineno}", node))

    for path, tree in trees.items():
        own = constants[path.stem]
        imported_names, imported_modules = _imports(tree)
        for name, (_line, value) in own.items():
            if name.endswith(("_DETAIL", "_FAILED")):  # answered through an exception's text
                add(path, value)

        def resolve(node: ast.AST) -> None:
            if _is_text(node):
                add(path, node)
            elif isinstance(node, ast.Name):
                if node.id in own:
                    add(path, own[node.id][1])
                elif node.id in imported_names and node.id in constants.get(imported_names[node.id], {}):
                    mod = imported_names[node.id]
                    add(PACKAGE / f"{mod}.py", constants[mod][node.id][1])
            elif isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
                mod = imported_modules.get(node.value.id)
                if mod and node.attr in constants.get(mod, {}):
                    add(PACKAGE / f"{mod}.py", constants[mod][node.attr][1])

        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                fn = node.func
                name = fn.id if isinstance(fn, ast.Name) else fn.attr if isinstance(fn, ast.Attribute) else None
                if name in DETAIL_HELPERS:
                    args = node.args
                    if name in MESSAGE_ARG:
                        args = args[MESSAGE_ARG[name] : MESSAGE_ARG[name] + 1]
                    for arg in args:
                        if not (isinstance(arg, ast.Constant) and isinstance(arg.value, int)):
                            resolve(arg)
                    for kw in node.keywords:
                        if kw.arg in DETAIL_KEYWORDS:
                            resolve(kw.value)
            elif isinstance(node, ast.Dict):
                for key, value in zip(node.keys, node.values):
                    if isinstance(key, ast.Constant) and key.value == "detail" and value is not None:
                        resolve(value)
    return found


def _names(part: ast.AST, names: set[str]) -> bool:
    """`part` is ``{name}`` or ``{str(name)}`` for a name in `names`."""
    if not isinstance(part, ast.FormattedValue) or part.conversion != -1:
        return False
    value = part.value
    if isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id == "str":
        value = value.args[0] if len(value.args) == 1 else value
    return isinstance(value, ast.Name) and value.id in names


def _problems(node: ast.AST) -> list[str]:
    problems: list[str] = []
    if isinstance(node, ast.Constant):
        text = node.value
        first, last = text[:1], text[-1:]
    else:
        assert isinstance(node, ast.JoinedStr)
        parts = node.values
        for part in parts:
            if isinstance(part, ast.FormattedValue) and part.conversion == ord("r"):
                problems.append("uses !r repr quoting")
                break
        head, tail = parts[0], parts[-1]
        first = head.value[:1] if isinstance(head, ast.Constant) else ""
        if _names(head, SUBJECTS):
            first = "A"
        last = tail.value[-1:] if isinstance(tail, ast.Constant) else ""
        if _names(tail, FORWARDED):
            last = "."
    if not (first.isupper() or first == '"'):
        problems.append("does not start with a capital letter or a quote")
    if last not in {".", "?", "!"}:
        problems.append("does not end with a full stop")
    return problems


def test_detail_messages_are_full_sentences():
    messages = collect_messages()
    assert len(messages) > 150, "the walk found too few messages; the pattern changed"
    bad: list[str] = []
    for where, node in messages:
        text = node.value if isinstance(node, ast.Constant) else ast.unparse(node)
        if text in KEPT_FOR_FRONTEND or text in STATUS_PREFIXED:
            continue
        problems = _problems(node)
        if problems:
            bad.append(f"{where}: {text!r}: {'; '.join(problems)}")
    assert not bad, "\n".join(["API messages that are not full sentences:", *bad])


def test_no_repr_quoting_in_any_detail_fstring():
    """No f-string anywhere in the package quotes a value with ``!r`` for a user-facing message."""
    bad: list[str] = []
    for where, node in collect_messages():
        if isinstance(node, ast.JoinedStr) and any(
            isinstance(p, ast.FormattedValue) and p.conversion == ord("r") for p in node.values
        ):
            bad.append(f"{where}: {ast.unparse(node)}")
    assert not bad, "\n".join(["details with !r:", *bad])


def test_allow_listed_messages_still_exist():
    """Every allow-listed message is still made somewhere, so the lists do not go stale and hide
    a new message that happens to share an old text."""
    allowed = {**KEPT_FOR_FRONTEND, **dict.fromkeys(STATUS_PREFIXED, "")}
    assert allowed, "nothing is allow-listed; drop this test with the lists"
    texts = {
        node.value if isinstance(node, ast.Constant) else ast.unparse(node)
        for _where, node in collect_messages()
    }
    stale = sorted(text for text in allowed if text not in texts)
    assert not stale, stale
