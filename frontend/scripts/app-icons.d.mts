// Types of scripts/app-icons.mjs for the test that runs the generator in-process.
import type { IconifyJSON } from '@iconify/types'

export const FALLBACK: string
export function referencedPhIds(srcDir?: string): string[]
export function loadPhosphor(): IconifyJSON
export function buildSubset(full: IconifyJSON, ids: string[]): Promise<{ subset: IconifyJSON; missing: string[] }>
export function render(subset: IconifyJSON): string
export function generate(): Promise<{ text: string; ids: string[]; missing: string[]; count: number }>
