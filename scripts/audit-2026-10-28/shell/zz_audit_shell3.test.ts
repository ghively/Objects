import { it } from 'vitest'
import { matches, keysFor } from '@/lib/shortcuts'
it('azerty', () => {
  // AZERTY: the key labelled Z sits at the KeyW position; Ctrl+Z gives key 'z', code 'KeyW'.
  console.log('Ctrl+Z on AZERTY matches closeTab:', matches({ key: 'z', code: 'KeyW', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false } as any, keysFor('closeTab')))
  // AZERTY Ctrl+A (select all) is at KeyQ; Ctrl+Q (key 'q', code 'KeyA') -> Mod-a?
  console.log('Ctrl+Shift+Q on AZERTY (code KeyA) matches openTabList:', matches({ key: 'Q', code: 'KeyA', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true } as any, keysFor('openTabList')))
})
