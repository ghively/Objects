import TurndownService from 'turndown'
// @ts-expect-error Package ships types for the legacy 'domino' module name only, not '@mixmark-io/domino'.
import { createDocument } from '@mixmark-io/domino'
// @ts-expect-error Plugin package does not expose its named export type.
import { gfm as gfmTurndown } from '@guyplusplus/turndown-plugin-gfm'

function getTurndownInput(html: string) {
  if (typeof document !== 'undefined') return html
  return createDocument(html || '').body
}

export function htmlToMd(html: string): string {
  const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', hr: '---' })

  td.use(gfmTurndown)

  td.remove('style') // removes style tags from html

  // // Custom table handling
  // td.addRule('table', {
  //   filter: ['table'],
  //   replacement: function (content, node) {
  //     // Get all cells
  //     const cells = node.querySelectorAll('td, th')
  //     const nonEmptyCells = Array.from(cells)
  //       .map((cell) => cell.textContent?.trim())
  //       .filter((text) => text && text.length > 0)

  //     // If there's only one non-empty cell, just return its content
  //     if (nonEmptyCells.length <= 1) {
  //       return nonEmptyCells[0] || ''
  //     }

  //     // Otherwise return each non-empty cell as a paragraph

  //     return nonEmptyCells.join('\n\n') + '\n\n'
  //   },
  // })

  // // Prevent other rules from processing table elements
  // td.addRule('tableElements', {
  //   filter: ['tr', 'td', 'th', 'tbody', 'thead'],
  //   replacement: function (content) {
  //     return content
  //   },
  // })

  td.addRule('br-new-line', {
    filter: 'br',
    replacement: (_content: string) => {
      return '\n\n'
    },
  })

  // next two rules allow nested lists where nested element is not contained in li (non-standard html but used in email)
  td.addRule('list', {
    filter: ['ul', 'ol'],

    replacement: function (content, node) {
      const parent = node.parentNode

      // CHANGE: Allow for <ul> and <ol> that are improperly nested outside of <li>.
      if (node.parentNode?.nodeName.match(/^(UL|OL)$/i)) {
        content =
          '    ' +
          content
            .replace(/^\n+/, '') // remove leading newlines
            .replace(/\n+$/, '\n') // replace trailing newlines with just a single one
            .replace(/\n/gm, '\n    ') // indent
      }

      if (parent?.nodeName === 'LI' && parent?.lastElementChild === node) {
        return '\n' + content
      } else {
        return '\n\n' + content + '\n\n'
      }
    },
  })

  td.addRule('listItem', {
    filter: 'li',

    replacement: function (content, node, options) {
      content = content
        .replace(/^\n+/, '') // remove leading newlines
        .replace(/\n+$/, '\n') // replace trailing newlines with just a single one
        .replace(/\n/gm, '\n    ') // indent

      let prefix = options.bulletListMarker + '   '
      const parent = node.parentNode

      // CHANGE: Don't output two markers if there is an empty li.
      if (
        node.children.length === 1 &&
        node.children[0].nodeName.match(/^(UL|OL)$/i) &&
        node.textContent === node.children[0].textContent
      )
        prefix = '    '
      else if (parent && parent.nodeName === 'OL') {
        // @ts-expect-error Turndown node types do not expose DOM element helpers.
        const start = parent.getAttribute ? parent.getAttribute('start') : 0
        // CHANGE: When <ol> is improperly nested outside of <li>, get the numbering correct.
        const index = Array.prototype.indexOf.call(
          Array.prototype.filter.call(parent.children, (el) => el.nodeName === 'LI'),
          node
        )
        prefix = (start ? Number(start) + index : index + 1) + '.  '
      }

      return prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '')
    },
  })

  const markdown = td.turndown(getTurndownInput(html))

  return markdown
}
