/** Navigation is a projection of existing routes, never a second route stack. */
export const DESTINATION_GROUPS = [
  { key: 'today', title: 'Сегодня', routes: ['overview', 'intake'] },
  { key: 'diary', title: 'Дневник', routes: ['bp', 'glucose', 'labs'] },
  { key: 'cabinet', title: 'Аптечка', routes: ['cabinet'] },
  { key: 'reports', title: 'Отчёты', routes: ['report', 'memo'] },
  { key: 'more', title: 'Ещё', routes: ['settings', 'sync', 'guide', 'notifications'] },
] as const
export type DestinationGroup = typeof DESTINATION_GROUPS[number]['key']

export function groupOf(route: string): DestinationGroup {
  return DESTINATION_GROUPS.find(group => (group.routes as readonly string[]).includes(route))?.key ?? 'today'
}

export function defaultRoute(group: DestinationGroup, available: readonly string[], remembered?: string): string {
  const routes = DESTINATION_GROUPS.find(item => item.key === group)!.routes as readonly string[]
  return (remembered && available.includes(remembered) && routes.includes(remembered) ? remembered : undefined)
    ?? routes.find(route => available.includes(route)) ?? 'overview'
}
