import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { DESTINATION_GROUPS, groupOf, type DestinationGroup } from '../logic/destinations'
import { CabinetIcon, MoreIcon, OverviewIcon, ReadingsIcon, ReportIcon } from './icons'
import { registerBackLayer } from './backLayers'

const ICONS = { today: OverviewIcon, diary: ReadingsIcon, cabinet: CabinetIcon, reports: ReportIcon, more: MoreIcon }
export const ROUTE_LABELS: Record<string, string> = {
  overview: 'Сегодня', intake: 'Весь день', bp: 'Давление', glucose: 'Сахар',
  labs: 'Анализы', cabinet: 'Аптечка', report: 'Отчёт врачу', memo: 'Памятка',
  settings: 'Настройки', sync: 'Прибор', guide: 'Справка', notifications: 'Уведомления',
}

export function ConceptNavigation({ route, routes, onGroup, onRoute }: {
  route: string
  routes: readonly string[]
  onGroup: (group: DestinationGroup) => void
  onRoute: (route: string) => void
}) {
  const group = groupOf(route)
  const navRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLDialogElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [menu, setMenu] = useState(false)
  const local = DESTINATION_GROUPS.find(item => item.key === group)!.routes.filter(key => routes.includes(key))
  const close = () => setMenu(false)
  useEffect(() => {
    if (!menu) return
    menuRef.current?.showModal()
    const unregister = registerBackLayer(() => { close(); return true })
    return () => { unregister(); menuRef.current?.close(); triggerRef.current?.focus({ preventScroll: true }) }
  }, [menu])
  useLayoutEffect(() => {
    const nav = navRef.current
    if (!nav) return
    const update = () => {
      const root = nav.closest<HTMLElement>('.app')
      root?.style.setProperty('--bottom-tabs-height', getComputedStyle(nav).position === 'fixed' ? nav.getBoundingClientRect().height + 'px' : '0px')
      const header = root?.querySelector('header.topbar')
      if (header) root?.style.setProperty('--concept-header-height', header.getBoundingClientRect().height + 'px')
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(nav)
    const header = nav.closest('.app')?.querySelector('header.topbar')
    if (header) observer.observe(header)
    return () => observer.disconnect()
  }, [])
  return <>
    <nav ref={navRef} className="tabs concept-navigation no-print" aria-label="Основные разделы" data-tour="concept-navigation">
      {DESTINATION_GROUPS.map(item => {
        const Icon = ICONS[item.key]
        return <button key={item.key} type="button" className="tab concept-navigation__item"
          data-group={item.key} aria-current={group === item.key ? 'page' : undefined}
          data-tour={item.key === 'more' ? 'concept-more' : undefined}
          onClick={() => onGroup(item.key)}>
          <Icon /><span>{item.title}</span>
        </button>
      })}
      <button ref={triggerRef} type="button" className="concept-navigation__sections" aria-haspopup="dialog"
        aria-expanded={menu} onClick={() => setMenu(true)}>
        <MoreIcon /><span>Разделы</span><span className="sr-only">, сейчас {DESTINATION_GROUPS.find(item => item.key === group)?.title}</span>
      </button>
    </nav>
    {local.length > 1 && <nav className="concept-subnav no-print" aria-label="Раздел дневника">
      {local.map(key => <button key={key} type="button" data-route={key} data-tour={key === 'guide' ? 'tool-guide' : 'tab-' + key}
        aria-current={route === key ? 'page' : undefined} onClick={() => onRoute(key)}>
        {ROUTE_LABELS[key]}
      </button>)}
    </nav>}
    {menu && <dialog ref={menuRef} className="concept-sections" aria-labelledby="concept-sections-title"
      onClose={close} onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === event.currentTarget) close() }}>
      <div className="card__head"><h2 id="concept-sections-title">Разделы</h2><button className="btn" onClick={close}>Закрыть</button></div>
      <div className="stack">{DESTINATION_GROUPS.map(item => <section key={item.key}>
        <h3>{item.title}</h3>
        <div className="concept-sections__routes">{item.routes.filter(key => routes.includes(key)).map(key =>
          <button key={key} type="button" className="btn" aria-current={route === key ? 'page' : undefined} onClick={() => { close(); onRoute(key) }}>{ROUTE_LABELS[key]}</button>
        )}</div>
      </section>)}</div>
    </dialog>}
  </>
}
