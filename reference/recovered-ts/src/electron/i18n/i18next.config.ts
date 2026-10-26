import i18nextBackend from 'i18next-fs-backend'
import i18n from 'i18next'
import { languageKeys } from '../../shared-logic/models/general.model.js'

import en from '../../shared-logic/locales/core/en.json' with { type: 'json' }
import de from '../../shared-logic/locales/core/de.json' with { type: 'json' }
import es from '../../shared-logic/locales/core/es.json' with { type: 'json' }
import fr from '../../shared-logic/locales/core/fr.json' with { type: 'json' }
import hu from '../../shared-logic/locales/core/hu.json' with { type: 'json' }
import gb from '../../shared-logic/locales/core/en-gb.json' with { type: 'json' }
import pt from '../../shared-logic/locales/core/pt-br.json' with { type: 'json' }
import nl from '../../shared-logic/locales/core/nl.json' with { type: 'json' }
import it from '../../shared-logic/locales/core/it.json' with { type: 'json' }

function electronCatalog(core: { Electron?: unknown; general?: unknown }) {
  return {
    Electron: core.Electron,
    general: core.general,
  }
}

const i18nextOptions = {
  resources: {
    en: {
      translation: electronCatalog(en),
    },
    de: {
      translation: electronCatalog(de),
    },
    es: {
      translation: electronCatalog(es),
    },
    fr: {
      translation: electronCatalog(fr),
    },
    hu: {
      translation: electronCatalog(hu),
    },
    'en-gb': {
      translation: electronCatalog(gb),
    },
    'pt-br': {
      translation: electronCatalog(pt),
    },
    nl: {
      translation: electronCatalog(nl),
    },
    it: {
      translation: electronCatalog(it),
    },
  },

  interpolation: {
    escapeValue: false,
    prefix: '{',
    suffix: '}',
  },

  saveMissing: true,
  fallbackLng: 'en',
  whitelist: languageKeys,
}

i18n.use(i18nextBackend)
if (!i18n.isInitialized) i18n.init(i18nextOptions)

export default i18n
