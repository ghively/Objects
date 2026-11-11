# Markdown reference

Every note is a `.md` file. Object writes plain Markdown wherever Markdown can say it, and a small HTML comment on its own line where it cannot, so the file still reads cleanly in any editor. Saving changes only the lines you edited.

## Properties (front matter)

The file starts with the note's properties between two `---` lines, in YAML:

    ---
    id: 3f1c9a20
    type: Task
    title: Order new laptops
    tags: [Hardware]
    collections: [This quarter]
    status: In Progress
    deadline: 2026-11-30
    project: "[[Office move]]"
    ---

`id` stays the same when you rename the note, so links keep working. Labels are stored by option name, dates as `YYYY-MM-DD`, and a property that points at other notes as one or more `[[Title]]` links.

## Headings

`#` to `####` at the start of a line make heading levels 1 to 4.

## Text

`**bold**`, `*italic*`, `~~strikethrough~~` and `` `code` ``. Underline, colors and small text are written as HTML or an annotation such as `<!-- block: color=bg-blue -->` on the line before the block.

## Lists

- `- ` or `* ` starts a bulleted list.
- `1. ` starts a numbered list. Alphabetical and roman lists are numbered lists with `<!-- block: list=alphabetical -->` or `list=roman` before them.
- Indent a line to nest it under the one above.

## To-dos

`- [ ] Call the vendor` is an open to-do and `- [x] Call the vendor` a done one.

## Quotes

`> ` starts a quote. A standout quote has `<!-- block: quote=standout -->` before it.

## Toggles

A toggle wraps its content in two comments. The first line inside is the toggle's title; the rest is hidden until it is opened:

    <!-- toggle -->
    Details
    The hidden part.
    <!-- /toggle -->

`<!-- toggle open -->` keeps it open. Groups and columns work the same way with `group` and `columns`.

## Links

- `[[Title]]` links to another note in the space; typing `@` or `[[` in the editor inserts one.
- `[text](address)` is an ordinary Markdown link.
- `![caption](Attachments/photo.png)` shows an image from the space's `Attachments/` folder.

## Code, tables and math

Fenced code blocks (three backticks, then a language name) keep their language. Tables are Markdown pipe tables with a header row. `$x^2$` is inline math and `$$ ... $$` a math block.
