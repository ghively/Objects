const nameBlackList: { name: string; static: boolean }[] = [
  // all existing static routes
  { name: 'error', static: true },
  { name: 'loading', static: true },
  { name: 'login', static: true },
  { name: 'register', static: true },
  { name: 'verify', static: true },
]

export function staticRoutes() {
  return nameBlackList
    .filter((el) => {
      return el.static
    })
    .map((el) => {
      return `/${el.name}`
    })
}
