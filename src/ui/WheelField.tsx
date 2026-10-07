import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Барабан выбора значения — как в системном выборе времени.
 *
 * Для давления это удобнее клавиатуры: значения лежат в известном диапазоне,
 * прокрутка начинается от текущего значения, а не с нуля, и набирать ничего не
 * нужно. Клавиатура на телефоне при этом ещё и закрывает пол-экрана.
 *
 * Ось выбирается по месту. Вертикальные колёса встают парой «верхнее и нижнее»,
 * но третье к ним на узком экране уже не помещается: при 360px внутри карточки
 * остаётся 296px, а три колонки по 92px с зазорами требуют 300. Пульс поэтому
 * кладётся горизонтальным барабаном под ними — он и по смыслу вторичен.
 *
 * Управляется тремя способами: прокруткой, колесом мыши и стрелками с
 * клавиатуры. Для скринридера это spinbutton с текущим значением.
 */

const SIZE = { y: 40, x: 68 } as const
const VISIBLE_Y = 5

/** Keep the scrolling geometry and the highlight in sync with large text. */
function useWheelScale() {
  const read = () => typeof document === 'undefined' ? 1 : Math.max(1, parseFloat(getComputedStyle(document.documentElement).fontSize) / 16 || 1)
  const [scale, setScale] = useState(read)
  useLayoutEffect(() => {
    const update = () => setScale(read())
    update()
    const resize = new ResizeObserver(update)
    resize.observe(document.documentElement)
    const attributes = new MutationObserver(update)
    attributes.observe(document.documentElement, { attributes: true, attributeFilter: ['data-text', 'style', 'class'] })
    window.addEventListener('resize', update)
    return () => { resize.disconnect(); attributes.disconnect(); window.removeEventListener('resize', update) }
  }, [])
  return scale
}

export function WheelField({
  label,
  unit,
  value,
  onChange,
  min,
  max,
  start,
  step = 1,
  decimals = 0,
  ariaSuffix,
  axis = 'y',
}: {
  label: string
  unit?: string
  /** Пустая строка означает «ещё не выбрано»: барабан встаёт на значение по умолчанию. */
  value: string
  onChange: React.Dispatch<React.SetStateAction<string>>
  min: number
  max: number
  /** Где стоит колесо, пока значение не выбрано. От min отсчитывать нельзя:
   *  для давления это 40, и до 120 пришлось бы крутить восемьдесят делений. */
  start: number
  step?: number
  decimals?: number
  /** Что дочитывать скринридеру после числа, например «мм рт. ст.». */
  ariaSuffix?: string
  axis?: 'x' | 'y'
}) {
  const listRef = useRef<HTMLDivElement>(null)
  /**
   * Таймеров два, и это принципиально. Раньше был один на две задачи — снять
   * флаг «прокручиваю сам» и зафиксировать значение после остановки. Пробный
   * размонтаж в StrictMode гасил таймер сброса флага, флаг оставался поднятым
   * навсегда, и барабан крутился, не меняя значения.
   */
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flagTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  /** Пока идёт наша собственная прокрутка, события scroll игнорируются. */
  const scrolling = useRef(false)
  const [focused, setFocused] = useState(false)

  const scale = useWheelScale()
  const item = Math.max(axis === 'y' ? 48 : 68, Math.round(SIZE[axis] * scale))
  const layoutItem = useRef(item)
  const horizontal = axis === 'x'
  const count = Math.round((max - min) / step) + 1

  const format = useCallback(
    (n: number) => (decimals > 0 ? n.toFixed(decimals).replace('.', ',') : String(Math.round(n))),
    [decimals],
  )
  const parse = (raw: string) => Number(raw.replace(',', '.'))
  const valueAt = useCallback((i: number) => min + i * step, [min, step])

  const current = parse(value)
  const chosen = Number.isFinite(current) && value !== ''
  const defaultIndex = Math.min(count - 1, Math.max(0, Math.round((start - min) / step)))
  const index = chosen ? Math.round((current - min) / step) : defaultIndex
  const safeIndex = Math.min(count - 1, Math.max(0, index))

  /**
   * Что мы сами отдали наружу последним. Без этого эффект позиционирования
   * возвращал колесо назад на каждое наше же изменение — прокрутка пружинила.
   */
  const emitted = useRef<string | null>(null)

  const offsetOf = useCallback(
    (node: HTMLDivElement) => (horizontal ? node.scrollLeft : node.scrollTop),
    [horizontal],
  )

  const scrollTo = useCallback(
    (target: number, smooth: boolean) => {
      const node = listRef.current
      if (!node) return
      scrolling.current = true
      const behavior = smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto'
      node.scrollTo(horizontal ? { left: target * item, behavior } : { top: target * item, behavior })
      clearTimeout(flagTimer.current)
      flagTimer.current = setTimeout(() => {
        scrolling.current = false
      }, 260)
    },
    [horizontal, item],
  )

  useLayoutEffect(() => {
    const node = listRef.current
    if (!node) return
    if (layoutItem.current !== item) {
      // A pending gesture used the old row size. It must not divide the new
      // scroll position by that size and silently commit a different number.
      clearTimeout(settleTimer.current)
      layoutItem.current = item
      emitted.current = null
      scrollTo(safeIndex, false)
      return
    }
    if (scrolling.current) return
    // Значение пришло от нашей же прокрутки — трогать позицию нельзя.
    if (value === emitted.current) return
    if (Math.round(offsetOf(node) / item) !== safeIndex) scrollTo(safeIndex, false)
  }, [value, safeIndex, item, offsetOf, scrollTo])

  useEffect(
    () => () => {
      clearTimeout(settleTimer.current)
      clearTimeout(flagTimer.current)
      // Флаг сбрасывается вручную: иначе после пробного размонтажа он остался бы
      // поднятым вместе с погашенным таймером.
      scrolling.current = false
    },
    [],
  )

  /**
   * Слушатель вешается вручную, а не через onScroll у React: событие прокрутки
   * не всплывает, и делегирование его не ловит — обработчик просто не
   * вызывался, барабан крутился, но значение не менялось.
   */
  const handleScroll = useRef<() => void>(() => {})
  handleScroll.current = () => {
    if (scrolling.current) return
    clearTimeout(settleTimer.current)
    // Значение фиксируем после остановки: иначе оно дёргается на каждом кадре.
    settleTimer.current = setTimeout(() => {
      const node = listRef.current
      if (!node) return
      const landed = Math.min(count - 1, Math.max(0, Math.round(offsetOf(node) / item)))
      const next = format(valueAt(landed))
      emitted.current = next
      onChange((prev) => (prev === next ? prev : next))
    }, 120)
  }

  useEffect(() => {
    const node = listRef.current
    if (!node) return
    const listener = () => handleScroll.current()
    node.addEventListener('scroll', listener, { passive: true })
    return () => node.removeEventListener('scroll', listener)
  }, [])

  const commit = (target: number, smooth: boolean) => {
    const clamped = Math.min(count - 1, Math.max(0, target))
    const next = format(valueAt(clamped))
    emitted.current = next
    onChange(next)
    scrollTo(clamped, smooth)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    const back = horizontal ? 'ArrowLeft' : 'ArrowUp'
    const forward = horizontal ? 'ArrowRight' : 'ArrowDown'
    const moves: Record<string, number> = {
      [back]: -1,
      [forward]: 1,
      PageUp: -10,
      PageDown: 10,
      Home: -count,
      End: count,
    }
    const delta = moves[event.key]
    if (delta === undefined) return
    event.preventDefault()
    commit(safeIndex + delta, true)
  }

  const items = Array.from({ length: count }, (_, i) => valueAt(i))
  /** По краям нужен отступ в половину видимой области, иначе крайние значения не встанут в центр. */
  const pad = horizontal ? `calc(50% - ${item / 2}px)` : `${(item * VISIBLE_Y - item) / 2}px`

  return (
    <div className={`wheel wheel--${axis}`} style={{ ['--wheel-step' as string]: `${item}px` }}>
      <div className="wheel__label">
        {label}
        {unit && <span className="wheel__unit">{unit}</span>}
      </div>
      <div className={focused ? 'wheel__box wheel__box--focused' : 'wheel__box'}>
        {/* Полоса выделения лежит под списком и не перехватывает касания. */}
        <div className="wheel__marker" aria-hidden="true" />
        <div
          ref={listRef}
          className="wheel__list"
          role="spinbutton"
          tabIndex={0}
          aria-label={label}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={chosen ? current : undefined}
          aria-valuetext={chosen ? `${format(current)}${ariaSuffix ? ` ${ariaSuffix}` : ''}` : 'не выбрано'}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={horizontal ? { height: item } : { height: item * VISIBLE_Y }}
        >
          <div className="wheel__pad" style={horizontal ? { width: pad } : { height: pad }} />
          {items.map((entry, i) => (
            <div
              key={entry}
              className="wheel__item"
              style={horizontal ? { width: item } : { height: item }}
              aria-hidden="true"
              onClick={() => commit(i, true)}
              data-selected={i === safeIndex ? 'true' : undefined}
              data-pending={i === safeIndex && !chosen ? 'true' : undefined}
            >
              {format(entry)}
            </div>
          ))}
          <div className="wheel__pad" style={horizontal ? { width: pad } : { height: pad }} />
        </div>
      </div>
    </div>
  )
}
