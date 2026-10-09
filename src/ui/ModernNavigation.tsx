import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type NavItem = {
  key: string
  label: string
  short: string
  tour?: string
  Icon: () => React.ReactElement
}

type ToolItem = {
  key: string
  label: string
  tour?: string
  Icon: () => React.ReactElement
}

function SectionsIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>
}

/** Navigation is adaptive only when the large-text labels cannot stay on one line. */
export function ModernNavigation({
  modern,
  placement,
  visibleTabs,
  tools,
  activeKey,
  personName,
  attention,
  onSelect,
}: {
  modern: boolean
  placement: 'tools' | 'tabs'
  visibleTabs: readonly NavItem[]
  tools: readonly ToolItem[]
  activeKey: string
  personName: string
  attention: Readonly<Record<string, string | undefined>>
  onSelect: (key: string) => void
}) {
  const tabsRef = useRef<HTMLElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const sectionsRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<'tools' | 'tabs' | null>(null)
  const [sectionsOpen, setSectionsOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [useSectionsMenu, setUseSectionsMenu] = useState(false)

  useEffect(() => {
    if (!modern || placement !== 'tabs') {
      setUseSectionsMenu(false)
      return
    }
    const nav = tabsRef.current
    if (!nav) return
    const measure = () => {
      const largeText = document.documentElement.dataset.text === 'xlarge'
      if (!largeText) {
        setUseSectionsMenu(false)
        return
      }
      const sample = nav.querySelector<HTMLElement>('.tab')
      const label = sample?.querySelector<HTMLElement>('.tab__short')
      if (!sample || !label) return
      const labelStyle = getComputedStyle(label)
      const buttonStyle = getComputedStyle(sample)
      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')
      if (!context) return
      context.font = `${labelStyle.fontWeight} ${labelStyle.fontSize} ${labelStyle.fontFamily}`
      const horizontalPadding = Number.parseFloat(buttonStyle.paddingLeft) + Number.parseFloat(buttonStyle.paddingRight)
      const border = Number.parseFloat(buttonStyle.borderLeftWidth) + Number.parseFloat(buttonStyle.borderRightWidth)
      const navStyle = getComputedStyle(nav)
      const innerWidth = nav.clientWidth - Number.parseFloat(navStyle.paddingLeft) - Number.parseFloat(navStyle.paddingRight)
      const gaps = Number.parseFloat(navStyle.columnGap || navStyle.gap) || 0
      // Icons and labels are stacked vertically. Only the widest label must
      // fit within its grid cell; adding icon width and the vertical gap here
      // falsely condensed four tabs at 390px with large text.
      const cellWidth = (innerWidth - gaps * Math.max(0, visibleTabs.length - 1)) / visibleTabs.length
      const availableLabelWidth = cellWidth - horizontalPadding - border
      const widestLabel = Math.max(...visibleTabs.map(item => context.measureText(item.short).width))
      setUseSectionsMenu(widestLabel > availableLabelWidth + 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(nav)
    window.addEventListener('resize', measure)
    void document.fonts?.ready.then(measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [modern, placement, visibleTabs.length])

  useEffect(() => {
    if (placement !== 'tabs') return
    const nav = tabsRef.current
    const app = nav?.closest<HTMLElement>('.app')
    if (!nav || !app) return
    const updateDockSpace = () => {
      const rect = nav.getBoundingClientRect()
      const height = getComputedStyle(nav).position === 'fixed' ? window.innerHeight - rect.top : rect.height
      app.style.setProperty('--bottom-tabs-height', `${Math.ceil(height)}px`)
    }
    updateDockSpace()
    const observer = new ResizeObserver(updateDockSpace)
    observer.observe(nav)
    window.addEventListener('resize', updateDockSpace)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateDockSpace)
    }
  }, [placement, useSectionsMenu])

  const pinnedTabs = [
    ...['overview', 'intake'].map(key => visibleTabs.find(item => item.key === key)).filter((item): item is NavItem => Boolean(item)),
    ...visibleTabs.filter(item => item.key !== 'overview' && item.key !== 'intake'),
  ].slice(0, 2)
  const pinnedKeys = new Set(pinnedTabs.map(item => item.key))
  const hiddenTabs = visibleTabs.filter(item => !pinnedKeys.has(item.key))
  const activeIsHidden = useSectionsMenu && visibleTabs.some(item => item.key === activeKey) && !pinnedKeys.has(activeKey)
  const hiddenSectionAttention = hiddenTabs.find(item => attention[item.key])
  const serviceAttention = tools.filter(item => attention[item.key])
  const rememberFocusTarget = () => { returnFocusRef.current = placement }
  const closeSections = () => {
    rememberFocusTarget()
    if (dialogRef.current?.open) dialogRef.current.close()
    setSectionsOpen(false)
  }
  const closeTools = () => {
    rememberFocusTarget()
    if (dialogRef.current?.open) dialogRef.current.close()
    setToolsOpen(false)
  }

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const shouldOpen = placement === 'tabs' ? sectionsOpen : toolsOpen
    if (shouldOpen && !dialog.open) dialog.showModal()
    else if (!shouldOpen && dialog.open) dialog.close()
  }, [placement, sectionsOpen, toolsOpen])

  const openSections = () => {
    setToolsOpen(false)
    setSectionsOpen(true)
  }
  const openTools = () => {
    setSectionsOpen(false)
    setToolsOpen(true)
  }
  const onDialogClose = () => {
    setSectionsOpen(false)
    setToolsOpen(false)
  }
  const select = (key: string) => {
    if (placement === 'tabs') closeSections()
    else closeTools()
    onSelect(key)
  }

  useLayoutEffect(() => {
    if (sectionsOpen || toolsOpen || !returnFocusRef.current) return
    const target = returnFocusRef.current === 'tabs' ? sectionsRef.current : moreRef.current
    returnFocusRef.current = null
    target?.focus({ preventScroll: true })
  }, [sectionsOpen, toolsOpen])

  const renderTools = () => modern ? (
    <nav className="tools no-print modern-tools" aria-label="Служебные разделы" data-tour="tools">
      <button ref={moreRef} type="button" className="tool modern-tools__trigger" aria-haspopup="dialog"
        aria-expanded={toolsOpen} aria-controls="modern-tools-sheet"
        aria-label={serviceAttention.length ? `Ещё. ${serviceAttention.map(item => `${item.label}: ${attention[item.key]}`).join('; ')}` : 'Ещё'} onClick={openTools}>
        <span>Ещё</span>{serviceAttention.length > 0 && <span className="tab__mark" aria-hidden="true" />}
      </button>
    </nav>
  ) : (
    <nav className="tools no-print" aria-label="Служебные разделы" data-tour="tools">
      {tools.map(item => <button key={item.key} className="tool" data-tour={item.tour}
        aria-current={activeKey === item.key ? 'page' : undefined} aria-label={attention[item.key] ? `${item.label}: ${attention[item.key]}` : item.label}
        onClick={() => onSelect(item.key)}>
        <item.Icon /><span>{item.label}</span>
        {attention[item.key] && <span className="tab__mark" aria-hidden="true" />}
      </button>)}
    </nav>
  )

  const sheetId = placement === 'tabs' ? 'modern-sections-sheet' : 'modern-tools-sheet'
  return <>
    {placement === 'tools' && renderTools()}
    {placement === 'tabs' && <>
    <nav ref={tabsRef} className="tabs" aria-label="Разделы дневника" data-tour="tabs"
      data-sections-menu={modern && useSectionsMenu ? 'true' : undefined}
      style={{ ['--tab-count' as string]: modern && useSectionsMenu ? 3 : visibleTabs.length }}>
      {(modern && useSectionsMenu ? pinnedTabs : visibleTabs).map(item => (
        <button key={item.key} className="tab" data-tour={item.tour}
          aria-current={activeKey === item.key ? 'page' : undefined}
          aria-label={attention[item.key] ? `${item.label}: ${attention[item.key]}` : item.label}
          onClick={() => onSelect(item.key)}>
          <span className="tab__icon"><item.Icon /></span>
          <span className="tab__full">{item.label}</span>
          <span className="tab__short">{item.short}</span>
          {attention[item.key] && <span className="tab__mark" aria-hidden="true" />}
        </button>
      ))}
      {modern && useSectionsMenu && <button ref={sectionsRef} type="button" className="tab modern-sections-trigger"
        aria-haspopup="dialog" aria-expanded={sectionsOpen}
        aria-current={activeIsHidden ? 'page' : undefined} aria-controls={sheetId}
        aria-label={hiddenSectionAttention ? `Разделы. ${hiddenSectionAttention.label}: ${attention[hiddenSectionAttention.key]}` : 'Разделы'} onClick={openSections}>
        <span className="tab__icon"><SectionsIcon /></span><span className="tab__full">Разделы</span><span className="tab__short">Разделы</span>
        {hiddenSectionAttention && <span className="tab__mark" aria-hidden="true" />}
      </button>}
    </nav>
    </>}

    {modern && (placement === 'tools' ? toolsOpen : sectionsOpen) && <dialog ref={dialogRef} id={sheetId} className="sheet modern-nav-sheet"
      aria-labelledby="modern-nav-title" onCancel={() => { rememberFocusTarget(); setSectionsOpen(false); setToolsOpen(false) }} onClose={onDialogClose}
      onClick={event => { if (event.target === dialogRef.current) { if (placement === 'tabs') closeSections(); else closeTools() } }}>
      <div className="modern-nav-sheet__head">
        <div><h2 id="modern-nav-title">{sectionsOpen ? 'Разделы' : 'Ещё'}</h2><p>Для дневника: <b>{personName}</b></p></div>
        <button className="modern-nav-sheet__close" type="button" aria-label="Закрыть меню" onClick={() => { if (placement === 'tabs') closeSections(); else closeTools() }}>Закрыть</button>
      </div>
      {placement === 'tabs' ? <nav className="modern-nav-sheet__list" aria-label="Разделы дневника">
        {visibleTabs.map(item => <button key={item.key} type="button" aria-current={activeKey === item.key ? 'page' : undefined}
          onClick={() => select(item.key)}><item.Icon /><span>{item.label}{activeKey === item.key ? ' · открыт' : ''}</span>
          {attention[item.key] && <small>{attention[item.key]}</small>}</button>)}
      </nav> : <nav className="modern-nav-sheet__list" aria-label="Служебные разделы">
        {tools.map(item => <button key={item.key} type="button" aria-current={activeKey === item.key ? 'page' : undefined}
          aria-label={attention[item.key] ? `${item.label}: ${attention[item.key]}` : item.label}
          onClick={() => select(item.key)}><item.Icon /><span>{item.label}{activeKey === item.key ? ' · открыт' : ''}</span>
          {attention[item.key] && <small>{attention[item.key]}</small>}</button>)}
      </nav>}
    </dialog>}
  </>
}
