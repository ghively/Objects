import awayback from 'awayback'
import type { TokenTypes } from '../models/tokens.model.js'

export type Events = {
  generatedBlock: (id: string) => void
  convertedToken: (data: { type: TokenTypes; bId: string; tId: string }) => void
}

export const events = awayback<Events, ['generatedBlock', 'convertedToken']>(['generatedBlock', 'convertedToken'])
