import { useCallback, useEffect, useRef, useState } from 'react'
import type { Tour as TourData } from '../logic/tour'

/** Сколько ждём появления элемента после смены раздела, прежде чем пропустить шаг. */
const ЖДЁМ_МС = 900

/** Отступ рамки от самого элемента — чтобы обводка не легла на текст. */
const ПОЛЕ = 6

/** Зазор между карточкой и краями экрана. Совпадает с `--space-3`. */
const ЗАЗОР = 12

interface Место {
  top: number
  left: number
  width: number
  height: number
  /** Карточку пришлось поднять наверх: подсвеченное лежит у нижнего края. */
  сверху: boolean
}

function найти(target: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-tour="${target}"]`)
}

/**
 * Где рисовать рамку и с какой стороны экрана держать карточку.
 *
 * Считается от текущей прокрутки и ничего не двигает: этот же расчёт повторяется
 * на каждую прокрутку и поворот, и подкручивать экран на каждое движение пальца
 * было бы борьбой с человеком.
 *
 * Рамка обрезается по свободной от карточки полосе. Иначе история давления,
 * которая выше экрана втрое, «подсвечивалась» целиком: затемнения не
 * оставалось вовсе, и подсказка теряла смысл.
 */
function место(element: HTMLElement, высотаКарточки: number): Место {
  const vh = window.innerHeight
  const vw = window.innerWidth
  const занято = высотаКарточки + ЗАЗОР * 2
  const свободно = Math.max(140, vh - занято)

  const r = element.getBoundingClientRect()
  // Элемент упирается в низ экрана и подвинуть его нечем — он приклеен туда
  // (нижняя навигация). Тогда наверх уходит карточка.
  const сверху = r.bottom > свободно && r.top > занято
  const полосаОт = сверху ? занято : 0
  const полосаДо = сверху ? vh : свободно

  const top = Math.max(полосаОт, r.top - ПОЛЕ)
  const bottom = Math.min(полосаДо, r.bottom + ПОЛЕ)
  const left = Math.max(0, r.left - ПОЛЕ)
  const right = Math.min(vw, r.right + ПОЛЕ)

  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top), сверху }
}

/**
 * Курс по приложению: затемняет экран, обводит настоящую кнопку и объясняет её.
 *
 * **Карточка с текстом не летает рядом с кнопкой, а прижата к краю экрана.**
 * Всплывающий пузырёк со стрелкой красивее, но при очень крупном тексте он
 * перестаёт помещаться куда бы то ни было, а на телефоне ещё и прыгает от шага
 * к шагу. Прижатая карточка стоит на одном месте, и человек не ищет глазами,
 * где теперь написано. Наверх она уходит в одном случае — когда подсвеченное
 * приклеено к низу экрана и карточка закрыла бы его собой.
 *
 * **Нажимать подсвеченную кнопку нельзя, и это намеренно.** Курс ведёт сам:
 * переключает разделы, прокручивает к нужному месту. Разреши нажатия — человек
 * уходит вглубь экрана, курс теряет свой элемент, и вместо объяснения выходит
 * ловушка.
 */
export function Tour({
  tour,
  onTab,
  onClose,
}: {
  tour: TourData
  /** Открыть раздел приложения перед шагом. */
  onTab: (tab: string) => void
  onClose: () => void
}) {
  const [шаг, setШаг] = useState(0)
  // Какие шаги оказались не про эту сборку. Номерами, а не счётчиком: «Назад»
  // обязана перешагивать через них, иначе она возвращает на шаг, который тут же
  // снова пропускается, и выйти назад нельзя вовсе. Их число вычитается и из
  // номера, и из итога: иначе человек видел бы «шаг 1 из 4», потом «шаг 3 из 4»
  // и решил, что что-то пропустил сам.
  const пропуски = useRef(new Set<number>())
  const [пропущено, setПропущено] = useState(0)
  const [рамка, setРамка] = useState<Место | null>(null)
  const карточка = useRef<HTMLDivElement>(null)
  const previousFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const текущий = tour.steps[шаг]

  // Обработчики держим ссылками, а не зависимостями. Родитель передаёт их
  // стрелками, они новые на каждую перерисовку, а поиск элемента и смена
  // раздела перезапускаться от этого не должны.
  const внешнее = useRef({ onTab, onClose })
  внешнее.current = { onTab, onClose }

  // Закрытие — отдельным действием, а не внутри обновления состояния: React
  // выполняет обновляющую функцию во время отрисовки, и вызов родительского
  // `setState` оттуда — ошибка, которую он и печатает в консоль.
  const [кончился, setКончился] = useState(false)
  useEffect(() => {
    if (кончился) внешнее.current.onClose()
  }, [кончился])

  const дальше = useCallback(() => {
    setШаг((n) => {
      if (n + 1 >= tour.steps.length) return n
      return n + 1
    })
    setКончился((было) => было || шаг + 1 >= tour.steps.length)
  }, [tour.steps.length, шаг])

  // Раздел открываем отдельным действием: смена вкладки — это обновление
  // родителя, и внутри поиска элемента ей делать нечего.
  useEffect(() => {
    const step = tour.steps[шаг]
    if (step?.tab) внешнее.current.onTab(step.tab)
  }, [tour, шаг])

  const пересчитать = useCallback(() => {
    const step = tour.steps[шаг]
    const element = step && найти(step.target)
    if (element) setРамка(место(element, карточка.current?.offsetHeight ?? 0))
  }, [tour, шаг])

  // Ищем элемент, пока он не появится или не выйдет срок. Раздел мог только что
  // смениться, список — ещё грузиться; ждать один кадр мало.
  useEffect(() => {
    const step = tour.steps[шаг]
    if (!step) return
    let живо = true
    let кадр = 0
    const срок = performance.now() + ЖДЁМ_МС

    // Прокрутка в два прохода. Первый считается по высоте карточки, которая
    // в этот миг ещё от прошлого шага; когда текст нового шага длиннее,
    // подсвеченное промахивается мимо свободной полосы. Второй проход
    // доводит — и на этом останавливаемся, чтобы не гоняться за экраном.
    const подвести = (element: HTMLElement) => {
      const свободно = Math.max(140, window.innerHeight - (карточка.current?.offsetHeight ?? 0) - ЗАЗОР * 2)
      const r = element.getBoundingClientRect()
      // Элемент выше свободной полосы — показываем его начало, а не середину:
      // у списка и карточки смысл несёт заголовок, а не строки посередине.
      const цель = r.height > свободно ? ЗАЗОР : (свободно - r.height) / 2
      const сдвиг = r.top - цель
      if (Math.abs(сдвиг) > 2) window.scrollBy(0, сдвиг)
    }

    const искать = () => {
      if (!живо) return
      const element = найти(step.target)
      if (element) {
        подвести(element)
        // Мерим после прокрутки, а не до неё: иначе рамка встанет туда, где
        // элемент был мгновение назад.
        кадр = requestAnimationFrame(() => {
          if (!живо) return
          подвести(element)
          кадр = requestAnimationFrame(() => живо && пересчитать())
        })
        return
      }
      if (performance.now() > срок) {
        // Кнопки этого шага в этой сборке нет — шаг не нужен. Молча дальше:
        // объяснять человеку, что чего-то не показали, незачем.
        setРамка(null)
        пропуски.current.add(шаг)
        setПропущено(пропуски.current.size)
        дальше()
        return
      }
      кадр = requestAnimationFrame(искать)
    }
    кадр = requestAnimationFrame(искать)

    return () => {
      живо = false
      cancelAnimationFrame(кадр)
    }
  }, [tour, шаг, дальше, пересчитать])

  // Экран под курсом живёт своей жизнью: клавиатура, поворот, дорисованный
  // список. Высота самой карточки тоже меняется — от неё зависит, где рамку
  // обрезать, поэтому наблюдаем и за ней.
  useEffect(() => {
    window.addEventListener('scroll', пересчитать, true)
    window.addEventListener('resize', пересчитать)
    const observer = new ResizeObserver(пересчитать)
    observer.observe(document.body)
    if (карточка.current) observer.observe(карточка.current)
    return () => {
      window.removeEventListener('scroll', пересчитать, true)
      window.removeEventListener('resize', пересчитать)
      observer.disconnect()
    }
  }, [пересчитать])

  // aria-modal описывает окно, а inert закрывает фон для клавиатуры и
  // скринридера. Запоминаем прежнее состояние, чтобы не открыть чужую модалку.
  useEffect(() => {
    const changed = new Map<HTMLElement, boolean>()
    const isolate = () => {
      let node = карточка.current?.closest<HTMLElement>('.tour') ?? null
      while (node && node.parentElement) {
        for (const sibling of node.parentElement.children) {
          if (sibling instanceof HTMLElement && sibling !== node && !changed.has(sibling)) {
            changed.set(sibling, sibling.inert)
            sibling.inert = true
          }
        }
        node = node.parentElement
        if (node === document.body) break
      }
    }
    isolate()
    const observer = new MutationObserver(isolate)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      for (const [node, inert] of changed) node.inert = inert
      const fallback = document.querySelector<HTMLElement>('.tabs button[aria-current], button[aria-label="Справка"], main button:not([disabled]), .app button:not([disabled])')
      ;(previousFocus.current?.isConnected ? previousFocus.current : fallback)?.focus({ preventScroll: true })
    }
  }, [])

  // `preventScroll` обязателен. Карточка лежит в перекрытии `position: fixed`,
  // но Chrome, ставя на неё фокус, всё равно прокручивает документ — и уводит
  // подсвеченное за верхний край экрана. Проверено на настройках при очень
  // крупном тексте: страница уезжала в самый низ, и подсветки не было вовсе.
  useEffect(() => {
    карточка.current?.focus({ preventScroll: true })
  }, [шаг])

  useEffect(() => {
    const наКлавишу = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && карточка.current) {
        const controls = [...карточка.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(el => el.getClientRects().length)
        const index = controls.indexOf(document.activeElement as HTMLElement)
        if (!controls.length || (event.shiftKey ? index <= 0 : index < 0 || index === controls.length - 1)) {
          event.preventDefault()
          ;(event.shiftKey ? controls.at(-1) : controls[0])?.focus({ preventScroll: true })
        }
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        внешнее.current.onClose()
      }
    }
    window.addEventListener('keydown', наКлавишу)
    return () => window.removeEventListener('keydown', наКлавишу)
  }, [])

  if (!текущий) return null

  const последний = шаг + 1 >= tour.steps.length
  // Возвращаться некуда, если все предыдущие шаги оказались пропущены: кнопка
  // была бы, а нажатие ничего не меняло.
  const естьНазад = Array.from({ length: шаг }, (_, i) => i).some((i) => !пропуски.current.has(i))

  return (
    <div className="tour no-print">
      {/* Ловит нажатия по затемнению: курс ведёт сам, случайные попадания по
          экрану под ним только сбивают. */}
      <div className="tour__veil" />

      {рамка && рамка.height > 0 && (
        <div
          className="tour__hole"
          style={{ top: рамка.top, left: рамка.left, width: рамка.width, height: рамка.height }}
        />
      )}

      <div
        className={`tour__card${рамка?.сверху ? ' tour__card--top' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        ref={карточка}
      >
        <div className="tour__meta">
          {/* Только счётчик. Название курса рядом с ним при очень крупном
              тексте переносится на вторую строку и наезжает на «Закрыть», а
              пользы не несёт: курс человек выбрал сам минуту назад. */}
          <span className="tour__of">
            Шаг {шаг + 1 - пропущено} из {tour.steps.length - пропущено}
          </span>
          <button className="tour__close" onClick={onClose} aria-label="Закрыть подсказки">
            Закрыть
          </button>
        </div>

        {/* Живая область: при смене шага диктор читает новый заголовок и текст,
            а не молчит, пока человек ищет, что изменилось. */}
        <div role="status" aria-live="polite">
          <h2 id="tour-title" className="tour__title">
            {текущий.title}
          </h2>
          <p className="tour__text">{текущий.text}</p>
        </div>

        <div className="tour__actions">
          {естьНазад && (
            <button
              className="btn"
              onClick={() =>
                setШаг((n) => {
                  let назад = n - 1
                  while (назад > 0 && пропуски.current.has(назад)) назад--
                  return Math.max(0, назад)
                })
              }
            >
              Назад
            </button>
          )}
          <button className="btn btn--primary tour__next" onClick={дальше}>
            {последний ? 'Готово' : 'Дальше'}
          </button>
        </div>
      </div>
    </div>
  )
}
