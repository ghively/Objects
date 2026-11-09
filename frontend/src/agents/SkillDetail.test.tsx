import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('@/api/client', async (orig) => ({
  ...(await orig<typeof import('@/api/client')>()),
  api: (await import('@/test/mockApi')).mockApi(),
}))

// Object's editor reports its Markdown after typing and on blur; a textarea stands in for it here.
vi.mock('@/editor/StringEditor', () => ({
  StringEditor: (props: { value: string; onChange(v: string): void; onBlur?(): void; readOnly?: boolean; ariaLabel?: string }) => (
    <textarea
      aria-label={props.ariaLabel}
      defaultValue={props.value}
      readOnly={props.readOnly}
      onChange={(e) => props.onChange(e.target.value)}
      onBlur={() => props.onBlur?.()}
    />
  ),
}))

import { api, ConflictError } from '@/api/client'
import type { SkillDetail as SkillDetailData } from '@/api/types'
import { ledgerSummary, skillSummary } from '@/test/mockApi'
import { LEARNING_TEXT as T } from './learningText'
import { SKILL_SAVE_MS, SkillDetail } from './SkillDetail'

const mocked = vi.mocked(api)
const RESEARCHER = '01JC7ZK3T9Q4M2X8B5N6R1V0WE'
const SKILL_MD = '---\nname: rack-labels\ndescription: How to label server racks\ncreated_by: agent\n---\nUse the row letter.'
/** What the editor shows: SKILL.md without its frontmatter. */
const BODY = 'Use the row letter.'

function detail(partial: Partial<SkillDetailData> = {}): SkillDetailData {
  return {
    ...skillSummary({ name: 'rack-labels' }),
    text: SKILL_MD,
    revision: 'r1',
    files: [
      { path: 'SKILL.md', size: SKILL_MD.length },
      { path: 'references/rows.md', size: 12 },
      { path: 'scripts/label.bin', size: 40 },
    ],
    ...partial,
  }
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve()
  })
}

describe('SkillDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocked.agentSkill.mockResolvedValue(detail())
  })

  describe('editing', () => {
    beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: false }))
    afterEach(() => vi.useRealTimers())

    test('test opening a skill edits SKILL.md with the revision', async () => {
      render(<SkillDetail agentId={RESEARCHER} name="rack-labels" archived={false} onClose={() => undefined} />)
      await settle()
      expect(mocked.agentSkill).toHaveBeenCalledWith(RESEARCHER, 'rack-labels', false)
      const editor = screen.getByRole('textbox', { name: 'SKILL.md' })
      expect(editor).toHaveValue(BODY)

      mocked.saveAgentSkillFile.mockResolvedValueOnce({ revision: 'r2' })
      fireEvent.change(editor, { target: { value: `${BODY} Then the slot.` } })
      await act(async () => {
        vi.advanceTimersByTime(SKILL_SAVE_MS - 1)
      })
      expect(mocked.saveAgentSkillFile).not.toHaveBeenCalled()
      await act(async () => {
        vi.advanceTimersByTime(1)
      })
      await settle()
      expect(mocked.saveAgentSkillFile).toHaveBeenCalledWith(RESEARCHER, 'rack-labels', 'SKILL.md', `${SKILL_MD} Then the slot.`, 'r1')

      // On blur at once, with the new revision; a 409 keeps the text and offers a reload.
      mocked.saveAgentSkillFile.mockRejectedValueOnce(new ConflictError('r9'))
      fireEvent.change(editor, { target: { value: `${BODY} Twice.` } })
      fireEvent.blur(editor)
      await settle()
      expect(mocked.saveAgentSkillFile).toHaveBeenLastCalledWith(RESEARCHER, 'rack-labels', 'SKILL.md', `${SKILL_MD} Twice.`, 'r2')
      expect(screen.getByText(T.conflict)).toBeInTheDocument()

      mocked.agentSkill.mockResolvedValue(detail({ text: 'Changed elsewhere.', revision: 'r9' }))
      fireEvent.click(screen.getByRole('button', { name: T.reload }))
      await settle()
      expect(screen.queryByText(T.conflict)).toBeNull()
      expect(screen.getByRole('textbox', { name: 'SKILL.md' })).toHaveValue('Changed elsewhere.')
    })

    test('test the frontmatter stays out of the editor and is saved byte for byte', async () => {
      // accept-m18.6: the Markdown editor read `---` frontmatter as text and saved it back as a heading.
      const head = '---\r\nname: rack-labels\r\ndescription: How to label server racks\r\ncreated_by: agent\r\n---\r\n'
      mocked.agentSkill.mockResolvedValue(detail({ text: `${head}# Rack labels\r\n\r\nUse the row letter.` }))
      render(<SkillDetail agentId={RESEARCHER} name="rack-labels" archived={false} onClose={() => undefined} />)
      await settle()
      const editor = screen.getByRole('textbox', { name: 'SKILL.md' })
      // (a textarea reports CRLF as LF; the editor gets the body without the frontmatter)
      expect(editor).toHaveValue('# Rack labels\n\nUse the row letter.')
      expect(screen.getByText(/description: How to label server racks/)).toBeInTheDocument()
      mocked.saveAgentSkillFile.mockResolvedValueOnce({ revision: 'r2' })
      fireEvent.change(editor, { target: { value: '# Rack labels\n\nUse the row letter. Then the slot.' } })
      fireEvent.blur(editor)
      await settle()
      expect(mocked.saveAgentSkillFile).toHaveBeenCalledWith(
        RESEARCHER,
        'rack-labels',
        'SKILL.md',
        `${head}# Rack labels\n\nUse the row letter. Then the slot.`,
        'r1',
      )
    })
  })

  test('test a binary support file shows no editor', async () => {
    mocked.agentSkillFile.mockImplementation(async (_id, _name, path) =>
      path === 'scripts/label.bin'
        ? { path, text: null, revision: 'b1', binary: true }
        : { path, text: 'Rows A to F.', revision: 'f1', binary: false },
    )
    const user = userEvent.setup()
    render(<SkillDetail agentId={RESEARCHER} name="rack-labels" archived={false} onClose={() => undefined} />)
    const files = await screen.findByRole('group', { name: 'Files' })

    await user.click(within(files).getByRole('button', { name: 'references/rows.md' }))
    expect(await screen.findByRole('textbox', { name: 'references/rows.md' })).toHaveValue('Rows A to F.')
    expect(mocked.agentSkillFile).toHaveBeenCalledWith(RESEARCHER, 'rack-labels', 'references/rows.md', false)

    await user.click(within(files).getByRole('button', { name: 'scripts/label.bin' }))
    expect(await screen.findByText(T.notText)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  test('test Pin and Archive call their routes', async () => {
    const user = userEvent.setup()
    render(<SkillDetail agentId={RESEARCHER} name="rack-labels" archived={false} onClose={() => undefined} />)
    await user.click(await screen.findByRole('button', { name: T.pin }))
    expect(mocked.pinAgentSkill).toHaveBeenCalledWith(RESEARCHER, 'rack-labels', true)

    // Pinned, it offers Unpin.
    await waitFor(() => expect(screen.getByRole('button', { name: T.unpin })).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: T.unpin }))
    expect(mocked.pinAgentSkill).toHaveBeenLastCalledWith(RESEARCHER, 'rack-labels', false)

    mocked.agentSkill.mockResolvedValue(detail({ state: 'archived' }))
    await user.click(screen.getByRole('button', { name: T.archive }))
    expect(mocked.archiveAgentSkill).toHaveBeenCalledWith(RESEARCHER, 'rack-labels')
    expect(await screen.findByRole('button', { name: T.restore })).toBeInTheDocument()
    await waitFor(() => expect(mocked.agentSkill).toHaveBeenLastCalledWith(RESEARCHER, 'rack-labels', true))
  })

  test("test the skill's History offers Undo per change", async () => {
    mocked.agentLedger.mockResolvedValue({
      entries: [
        ledgerSummary({ id: '01JLEDGER00000000000000002', target: 'skill', action: 'patch', skill: 'rack-labels', line: "Patched 'rack-labels'" }),
        ledgerSummary({ id: '01JLEDGER00000000000000001', target: 'skill', action: 'create', skill: 'rack-labels', line: "Created the skill 'rack-labels'" }),
      ],
      more: false,
    })
    const user = userEvent.setup()
    render(<SkillDetail agentId={RESEARCHER} name="rack-labels" archived={false} onClose={() => undefined} />)
    const list = await screen.findByRole('list', { name: T.history })
    expect(mocked.agentLedger).toHaveBeenCalledWith(RESEARCHER, expect.objectContaining({ skill: 'rack-labels' }))
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    for (const r of rows) expect(within(r).getByRole('button', { name: /Undo/ })).toBeEnabled()
    await user.click(within(rows[0]).getByRole('button', { name: `${T.undo}: Patched 'rack-labels'` }))
    expect(mocked.undoLedgerEntry).toHaveBeenCalledWith(RESEARCHER, '01JLEDGER00000000000000002')
  })
})
