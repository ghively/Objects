import chokidar, { type FSWatcher } from 'chokidar'
import { app, webContents } from 'electron'
import { debounce, defaults, union } from 'lodash-es'

type Paths = { paths: string | string[]; ignore?: string | string[] }
type Options = { ignore: string | string[]; debounce: number }

export function hmr(soft: Paths, hard?: Paths, options?: Partial<Options>) {
  options = <Options>defaults(options, <Options>{
    ignore: [/(^|[/\\])\../, 'node_modules', '**/*.map', '**/*.d.ts'],
    debounce: 500,
  })

  let isRelaunching = false

  const watchers: Record<string, FSWatcher> = {
    soft: chokidar.watch(soft.paths, {
      ignored: union([options.ignore].flat(), [soft.ignore].flat()).filter(
        (value): value is string => typeof value !== 'undefined'
      ),
    }),
  }

  if (typeof hard !== 'undefined') {
    watchers.hard = chokidar.watch(hard.paths, {
      ignored: union([options.ignore].flat(), [hard.ignore].flat()).filter(
        (value): value is string => typeof value !== 'undefined'
      ),
    })
  }

  app.on('quit', () => {
    Object.values(watchers).forEach((watcher) => watcher.close())
  })

  const handler = debounce((type: string) => {
    if (type === 'hard') {
      if (!isRelaunching) {
        app.relaunch()
        app.exit(0)
      }

      isRelaunching = true
    } else if (type === 'soft') {
      for (const view of webContents.getAllWebContents()) {
        view.reloadIgnoringCache()
      }
    }
  }, options.debounce)

  Object.entries(watchers).forEach(([type, watcher]) => {
    watcher.on('change', handler.bind(null, type))
  })
}
