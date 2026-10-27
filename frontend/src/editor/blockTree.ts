/**
 * Group M1's flat source blocks into a tree: leaf annotations attach to the
 * block below them, and container lines (toggle, group, columns) pair up
 * around their children (plan rules 4, 5 and 7). M8 adds the `indent`
 * container (`<!-- indent -->` … `<!-- /indent -->`), which pairs like the others.
 *
 * Invariant: `joinBlocks(flattenTree(buildTree(splitBlocks(body)))) === body`
 * for every input. Anything that does not pair or apply stays a plain leaf,
 * so malformed input never loses a byte.
 */
import {
  classifyEmbedLine,
  knownOption,
  parseAnnotation,
  singleLink,
  type Annotation,
  type ContainerName,
  type OptionTarget,
} from './annotations'
import type { SourceBlock } from './blocks'

/** Containers nest at most this deep; a deeper one stays plain lines. */
export const MAX_DEPTH = 8
/** A columns block holds at most this many columns (Task 7's `column{1,6}`); more stays plain. */
export const MAX_COLUMNS = 6

export type AnnotationLine = { raw: string /* the line with its EOL */; parsed: Annotation }

export type LeafNode = { kind: 'leaf'; block: SourceBlock; annotation?: AnnotationLine }
export type ContainerNode = {
  kind: 'container'
  name: ContainerName
  open: AnnotationLine
  /** One list for toggle and group; one per column for columns. */
  columns: TreeNode[][]
  /** The raw separator line before each column; `null` for the first. */
  separators: (string | null)[]
  close: { raw: string }
}
export type TreeNode = LeafNode | ContainerNode

/** What a source block can be, for the option table's "Applies to" column. */
export function blockTargets(block: SourceBlock): OptionTarget[] {
  switch (block.kind) {
    case 'paragraph': {
      const embed = classifyEmbedLine(block.raw)
      if (embed?.kind === 'image') return ['image']
      if (embed?.kind === 'media') return [embed.mediaKind]
      if (embed?.kind === 'objectEmbed') return ['objectEmbed']
      if (embed?.kind === 'blockRef') return ['blockRef']
      if (embed?.kind === 'dataView') return ['dataView']
      return singleLink(block.raw) ? ['paragraph', 'bookmark'] : ['paragraph']
    }
    case 'heading':
      return ['heading']
    case 'list':
      return /^ {0,3}\d{1,9}[.)]/.test(block.raw) ? ['list', 'orderedList'] : ['list']
    case 'blockquote':
      return ['blockquote']
    case 'code':
      return ['code']
    case 'table':
      return ['table']
    case 'math':
      return ['math']
    default:
      return []
  }
}

/** A leaf annotation applies when every known option applies to the block (unknown keys are neutral). */
export function annotationApplies(a: Annotation, block: SourceBlock): boolean {
  if (a.type !== 'leaf') return false
  const targets = blockTargets(block)
  if (targets.length === 0) return false
  return a.options.every((o) => {
    const known = knownOption(o.key)
    return !known || known.appliesTo.some((t) => targets.includes(t))
  })
}

/** The annotation on a single-line `html` block, or `null`. */
function annotationOf(block: SourceBlock): Annotation | null {
  if (block.kind !== 'html') return null
  return parseAnnotation(block.raw)
}

/** Ends with exactly one line break (rule 4: no blank line before the block). */
function endsWithOneBreak(raw: string): boolean {
  const body = raw.replace(/(?:\r\n|\n|\r)$/, '')
  return body !== raw && !/[\r\n]/.test(body)
}

type Pair = { open: number; close: number; separators: number[] }

/** Match container lines with a stack; returns the pairs keyed by open index. */
function pairContainers(blocks: SourceBlock[], parsed: (Annotation | null)[]): Map<number, Pair> {
  type Entry = { index: number; name: ContainerName; tooDeep: boolean; separators: number[] }
  const stack: Entry[] = []
  const pairs = new Map<number, Pair>()
  const depth = () => stack.filter((e) => !e.tooDeep).length

  for (let i = 0; i < blocks.length; i++) {
    const a = parsed[i]
    if (!a) continue
    if (a.type === 'open') {
      stack.push({ index: i, name: a.name!, tooDeep: depth() >= MAX_DEPTH, separators: [] })
    } else if (a.type === 'separator') {
      const top = stack[stack.length - 1]
      if (top && top.name === 'columns' && !top.tooDeep) top.separators.push(i)
    } else if (a.type === 'close') {
      let k = stack.length - 1
      while (k >= 0 && stack[k].name !== a.name) k--
      if (k < 0) continue // stray close: plain
      const entry = stack[k]
      stack.length = k // anything opened above it was never closed: plain
      if (entry.tooDeep) continue
      if (entry.separators.length > MAX_COLUMNS - 1) continue
      pairs.set(entry.index, { open: entry.index, close: i, separators: entry.separators })
    }
  }
  return pairs
}

/** Group `blocks` (from `splitBlocks`) into leaves and containers. */
export function buildTree(blocks: SourceBlock[]): TreeNode[] {
  const parsed = blocks.map(annotationOf)
  const pairs = pairContainers(blocks, parsed)

  /** Build the nodes of blocks[from, to). */
  const build = (from: number, to: number): TreeNode[] => {
    const out: TreeNode[] = []
    let i = from
    while (i < to) {
      const block = blocks[i]
      const a = parsed[i]
      const pair = pairs.get(i)
      if (pair && pair.close < to) {
        const bounds = [i, ...pair.separators, pair.close]
        const columns: TreeNode[][] = []
        for (let c = 0; c + 1 < bounds.length; c++) columns.push(build(bounds[c] + 1, bounds[c + 1]))
        out.push({
          kind: 'container',
          name: a!.name!,
          open: { raw: block.raw, parsed: a! },
          columns,
          separators: [null, ...pair.separators.map((s) => blocks[s].raw)],
          close: { raw: blocks[pair.close].raw },
        })
        i = pair.close + 1
        continue
      }
      const next = blocks[i + 1]
      if (
        a?.type === 'leaf' &&
        i + 1 < to &&
        endsWithOneBreak(block.raw) &&
        !pairs.has(i + 1) &&
        annotationApplies(a, next)
      ) {
        out.push({ kind: 'leaf', block: next, annotation: { raw: block.raw, parsed: a } })
        i += 2
        continue
      }
      out.push({ kind: 'leaf', block })
      i++
    }
    return out
  }

  return build(0, blocks.length)
}

/** The source blocks of `nodes`, in order: the inverse of `buildTree`. */
export function flattenTree(nodes: TreeNode[]): SourceBlock[] {
  const out: SourceBlock[] = []
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.kind === 'leaf') {
        if (node.annotation) out.push({ kind: 'html', raw: node.annotation.raw })
        out.push(node.block)
        continue
      }
      out.push({ kind: 'html', raw: node.open.raw })
      node.columns.forEach((column, c) => {
        const sep = node.separators[c]
        if (sep != null) out.push({ kind: 'html', raw: sep })
        walk(column)
      })
      out.push({ kind: 'html', raw: node.close.raw })
    }
  }
  walk(nodes)
  return out
}
