/**
 * `codeBlock`: StarterKit's own is turned off and this one registered instead,
 * so later tasks can add the language picker, wrap, lock and the previews
 * (Task 9) without touching `document.ts`. A Mermaid fence is a code block
 * whose language is `mermaid` (it was a raw block in M1).
 *
 * Options (annotation): `wrap`, `lock`, `preview=edit|split|display`.
 */
import { CodeBlock as BaseCodeBlock } from '@tiptap/extension-code-block'
import './codeBlock.css'

export const CodeBlock = BaseCodeBlock.extend({})
