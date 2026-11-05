// Pressing a button (a button block or a Button property cell): run the button rule on one
// object and tell the user how it went with a short notice. Nothing is written by the client;
// the server runs the rule and announces its writes.
import { api } from '@/api/client'
import { showToast } from '@/editor/media/upload'
import { runMessage } from './useAutomations'

/** Run rule `ruleId` on the object at `path`; answers the notice shown ("Done" or the failure). */
export async function runButton(ruleId: string, path: string): Promise<{ ok: boolean; message: string }> {
  try {
    const run = await api.runAutomation(ruleId, path)
    const message = runMessage(run)
    showToast(message)
    return { ok: run.status === 'ok', message }
  } catch (e) {
    const message = e instanceof Error && e.message ? e.message : String(e)
    showToast(message)
    return { ok: false, message }
  }
}
