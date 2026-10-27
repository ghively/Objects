/**
 * Slides for an object's presentation: a title slide (title, cover image, description, the visible
 * properties) and then the body, cut into a new slide at each top-level H1 or H2 heading and each
 * top-level horizontal line (our choice; the splitting rule is not in the trimmed reference).
 *
 * The heading opens its slide; the horizontal line itself is dropped. Content inside containers
 * (toggles, columns, groups, indented blocks) never splits. A slide with only blank text is left
 * out. Each slide's body is the original source text of its blocks, so the read-only editor shows
 * it exactly as the page does.
 */
import { joinBlocks, splitBlocks, type SourceBlock } from '@/editor/blocks'
import { buildTree, flattenTree, type TreeNode } from '@/editor/blockTree'

export type Slide = { kind: 'title' } | { kind: 'content'; body: string }

/** A top-level heading that opens a slide: ATX `#`/`##` or a setext heading (always level 1 or 2). */
export function isSlideHeading(block: SourceBlock): boolean {
  if (block.kind !== 'heading') return false
  const first = block.raw.replace(/^﻿/, '').split(/\r\n|\r|\n/)[0] ?? ''
  const atx = /^ {0,3}(#{1,6})(?:[ \t]|$)/.exec(first)
  return atx ? atx[1].length <= 2 : true
}

function isRule(block: SourceBlock): boolean {
  return block.kind === 'hr'
}

/** The content slides' bodies, in order. */
export function splitSlideBodies(body: string): string[] {
  const nodes = buildTree(splitBlocks(body))
  const out: string[] = []
  let current: TreeNode[] = []
  const flush = () => {
    const text = joinBlocks(flattenTree(current))
    if (text.trim() !== '') out.push(text)
    current = []
  }
  for (const node of nodes) {
    if (node.kind === 'leaf' && isRule(node.block)) {
      flush()
      continue
    }
    if (node.kind === 'leaf' && isSlideHeading(node.block)) flush()
    current.push(node)
  }
  flush()
  return out
}

/** Every slide: the title slide first, then the body's slides. */
export function buildSlides(body: string): Slide[] {
  return [{ kind: 'title' }, ...splitSlideBodies(body).map((b): Slide => ({ kind: 'content', body: b }))]
}
