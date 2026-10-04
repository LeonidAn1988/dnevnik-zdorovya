import { useEffect, useId, useRef, useState } from 'react'
import {
  describeDrug,
  filterByForm,
  makersOf,
  mergeBooks,
  searchHits,
  variantsOf,
  KIND_LABEL,
  type MatchField,
  type Drug,
  type DrugBook,
  type DrugVariant,
} from '../logic/drugs'
import { Working } from './bits'

/**
 * Поле названия препарата с подсказкой из реестра.
 *
 * Справочник весит больше самого приложения, поэтому подгружается лениво —
 * только когда человек открыл форму препарата, и один раз за сеанс. Дальше его
 * держит кэш служебного работника, и офлайн он тоже доступен.
 *
 * Ручной ввод остаётся равноправным: в реестре 11 тысяч наименований, но в
 * домашней аптечке лежат и старые препараты, и привезённые из-за границы.
 * Подсказка помогает, а не запрещает.
 */

let cached: DrugBook | null = null
let loading: Promise<void> | null = null
/** Кому сообщить, когда доедет вторая половина справочника. */
const waiting = new Set<(book: DrugBook | null, failed: boolean) => void>()

const fetchBook = (name: string): Promise<DrugBook | null> =>
  fetch(new URL(name, document.baseURI))
    .then((r) => (r.ok ? (r.json() as Promise<DrugBook>) : null))
    .catch(() => null)

/**
 * Справочник в два приёма: сначала лекарства, следом БАДы.
 *
 * Файлов два, потому что реестра два — лекарства ведёт Минздрав, добавки
 * санитарная служба, — а поиск обязан быть один, и человеку про ведомства
 * знать незачем.
 *
 * Ждать оба разом нельзя: вместе они под восемьсот килобайт, и на медленной
 * сети подсказка молчала бы всё это время. Поэтому лекарства показываются, как
 * только приехали, а добавки подмешиваются к ним следом. Если добавки не
 * доехали вовсе, поиск работает по лекарствам: половина справочника лучше
 * пустого поля.
 */
/** Справочник не доехал: поле обязано сказать об этом, а не молчать. */
let failed = false

/** Загрузить заново после отказа. */
export function retryBook(): void {
  failed = false
  loading = null
}

function loadBook(notify: (book: DrugBook | null, failed: boolean) => void): () => void {
  // Подписываемся всегда, даже когда что-то уже есть: между приездом лекарств
  // и приездом добавок форму могли открыть заново, и без подписки такое поле
  // так и осталось бы без БАДов до перезагрузки страницы.
  waiting.add(notify)
  if (cached) notify(cached, failed)

  const announce = () => waiting.forEach((listener) => listener(cached, failed))
  if (!loading) {
    loading = fetchBook('drugs.json')
      .then((drugs) => {
        cached = drugs
        announce()
        return fetchBook('supplements.json')
      })
      .then((supplements) => {
        cached = cached ? mergeBooks(cached, supplements) : supplements
        announce()
      })
      .catch(() => {
        // Отказ больше не проглатывается. Раньше `loading` оставался
        // выполненным обещанием, и повторить загрузку было нечем до
        // перезагрузки приложения: поле молча уверяло, что препарата нет в
        // реестре, хотя реестра просто не было.
        failed = true
        loading = null
        announce()
      })
  }
  return () => {
    waiting.delete(notify)
  }
}

const FIELD_LABEL = {
  name: '',
  inn: 'по веществу',
  maker: 'по производителю',
  // Совпало и название, и дозировка — про это не пишем: человек сам набрал
  // цифру и видит её в подписи.
  dose: 'по дозировке',
  form: 'по форме выпуска',
} as const

/** «14 августа 2026» — дата выгрузки реестра словами. */
const BOOK_DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

function bookDate(iso: string): string {
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? iso : BOOK_DATE.format(parsed)
}

export function DrugPicker({
  value,
  group,
  onChange,
  onPick,
  onBook,
}: {
  value: string
  /** Группа формы: сужает поиск до таблеток, капель, мазей и так далее. */
  group?: string
  onChange: (next: string) => void
  /**
   * Выбор из справочника. Варианты отдаём уже с названиями форм: словарь форм
   * живёт здесь, и форме препарата про его устройство знать незачем.
   */
  onPick: (drug: Drug, variants: DrugVariant[], makers: string[]) => void
  /**
   * Справочник доехал.
   *
   * Форме он нужен не ради подсказок — те рисует само поле, — а чтобы
   * дозаполнить то, чего у старой коробки нет. Признак рецептурности появился
   * позже самих коробок, и без этого он остался бы невидимым для всех, кто уже
   * пользуется приложением: пятнадцать коробок пришлось бы открыть руками.
   */
  onBook?: (book: DrugBook) => void
}) {
  const [book, setBook] = useState<DrugBook | null>(cached)
  /** Справочник не доехал — это не то же самое, что «препарата нет в реестре». */
  const [bookFailed, setBookFailed] = useState(false)
  /** Растёт по нажатию «Повторить»: перезапускает загрузку. */
  const [попытка, setПопытка] = useState(0)
  const [criterion, setCriterion] = useState<MatchField | 'all'>('all')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [touched, setTouched] = useState(false)
  const listId = useId()
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  /** Откуда палец начал касание: по нему отличается нажатие от прокрутки. */
  const touchFrom = useRef<{ x: number; y: number } | null>(null)

  // Отписка возвращена самим loadBook: без неё пришедшие следом добавки
  // дёргали бы состояние уже размонтированного поля.
  useEffect(
    () =>
      loadBook((next, отказ) => {
        setBook(next)
        setBookFailed(отказ)
        if (next) onBook?.(next)
      }),
    [попытка],
  )

  // Клик мимо закрывает подсказку. Без этого на телефоне она перекрывает
  // соседние поля и остаётся висеть.
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const pool = book ? filterByForm(book.items, book.forms, group ?? '') : []
  const hits = book && touched ? searchHits(pool, value, book.makers ?? [], 8, criterion, book.forms) : []
  const found = hits.map((hit) => hit.drug)
  const visible = open && found.length > 0

  /**
   * Высота списка считается по месту, а не задаётся в стилях.
   *
   * Нижняя навигация прилипшая, и фиксированные 300px залезали под неё —
   * последняя подсказка оказывалась недосягаемой. Свободное место меряем до
   * верха навигации; если его совсем мало, сначала подтягиваем поле вверх.
   */
  useEffect(() => {
    if (!visible) return
    let timer: ReturnType<typeof setTimeout>

    /**
     * Нижняя граница списка. Навигация прилипшая только на телефоне; на широком
     * экране она уезжает вверх, и отсчёт от неё схлопывал список до минимума —
     * на десктопе помещалось полтора пункта при полном экране свободного места.
     */
    const floorOf = (bottom: number) => {
      const nav = document.querySelector('nav.tabs')
      const navTop = nav?.getBoundingClientRect().top ?? Infinity
      return navTop > bottom ? Math.min(navTop, window.innerHeight) : window.innerHeight
    }

    const fit = () => {
      const box = boxRef.current?.getBoundingClientRect()
      const list = listRef.current
      if (!box || !list) return
      list.style.maxHeight = `${Math.max(140, Math.round(floorOf(box.bottom) - box.bottom - 12))}px`
    }

    const box = boxRef.current?.getBoundingClientRect()
    const floor = box ? floorOf(box.bottom) : window.innerHeight
    if (box && floor - box.bottom < 220) {
      boxRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      // Пересчитываем после прокрутки: до неё свободное место другое.
      timer = setTimeout(fit, 420)
    } else {
      fit()
    }

    return () => clearTimeout(timer)
  }, [visible, found.length])

  const choose = (drug: Drug) => {
    onPick(drug, variantsOf(drug, book?.forms ?? []), makersOf(drug, book?.makers ?? []))
    setOpen(false)
    setActive(-1)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!visible) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((prev) => (prev + step + found.length) % found.length)
    } else if (event.key === 'Enter') {
      // Перехватываем всегда, пока список открыт: без подсвеченного пункта
      // Enter уходил в форму и сохранял препарат с недописанным названием.
      event.preventDefault()
      if (active >= 0) choose(found[active])
    } else if (event.key === 'Escape') {
      setOpen(false)
      setActive(-1)
    }
  }

  return (
    <div className="suggest" ref={boxRef}>
      <label className="field" style={{ marginBottom: 'var(--space-3)' }}>
        <span>Искать по</span>
        <select aria-label="Искать по" value={criterion} onChange={e => { setCriterion(e.target.value as typeof criterion); setOpen(true); setActive(-1) }}>
          <option value="all">Всем данным</option><option value="name">Названию</option><option value="inn">Действующему веществу</option><option value="maker">Производителю</option><option value="dose">Дозировке</option><option value="form">Форме выпуска</option>
        </select>
      </label>
      <label className="field">
        <span>{criterion === 'all' || criterion === 'name' ? 'Название или поиск препарата' : 'Поиск препарата'}</span>
        <input
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            setTouched(true)
            setOpen(true)
            setActive(-1)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Лозартан"
          autoFocus={!window.matchMedia('(pointer: coarse)').matches}
          autoComplete="off"
          // Автозамена молча правит название препарата, и человек этого не
          // замечает — частая жалоба в отзывах на приложения этого класса.
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={visible}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        />
      </label>

      {visible && (
        <ul className="suggest__list" id={listId} ref={listRef} role="listbox" aria-label="Препараты из реестра">
          {hits.map(({ drug, field }, i) => (
            <li key={drug.n} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                className="suggest__item"
                data-active={i === active ? 'true' : undefined}
                onClick={(event) => { if (event.detail === 0) choose(drug) }}
                // mousedown, а не click: клик приходит после blur, и список
                // успевает закрыться раньше, чем выбор доедет.
                onMouseDown={(event) => {
                  event.preventDefault()
                  choose(drug)
                }}
                // Пальцем выбираем по отпусканию и только если палец не ехал.
                // Раньше стоял `onTouchStart`, и прокрутка списка подсказок
                // выбирала то лекарство, по которому человек случайно провёл, —
                // список нельзя было пролистать вовсе.
                onTouchStart={(event) => {
                  const t = event.touches[0]
                  touchFrom.current = t ? { x: t.clientX, y: t.clientY } : null
                }}
                onTouchEnd={(event) => {
                  const from = touchFrom.current
                  touchFrom.current = null
                  const t = event.changedTouches[0]
                  if (!from || !t) return
                  // Десять пикселей — обычный допуск на дрожание пальца.
                  if (Math.abs(t.clientX - from.x) > 10 || Math.abs(t.clientY - from.y) > 10) return
                  event.preventDefault()
                  choose(drug)
                }}
              >
                <span className="suggest__name">
                  {drug.n}
                  {/* Вид стоит у самого названия, а не в подписи: человек
                      выбирает строку по названию и мимо подписи проскакивает. */}
                  {drug.k && <span className="suggest__kind">{KIND_LABEL[drug.k]}</span>}
                </span>
                {describeDrug(drug, book?.forms ?? [], group ?? '') && (
                  <span className="suggest__meta">
                    {describeDrug(drug, book?.forms ?? [], group ?? '')}
                    {/* Говорим, по какому полю нашлось: иначе непонятно, почему
                        по запросу «ибупрофен» выпал «Нурофен». */}
                    {FIELD_LABEL[field] && <span className="suggest__why"> · найдено {FIELD_LABEL[field]}</span>}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Дату выгрузки показываем именно здесь, а не в настройках: она нужна
          ровно в ту секунду, когда препарат не нашёлся. Справочник стареет, и
          «его нет в реестре» и «реестру полгода» — разные объяснения, между
          которыми человек вправе выбирать сам. */}
      {/* Справочник ещё едет — поле не вправе утверждать, что препарата нет.
          Полосу показываем сразу, не дожидаясь ввода: файл справочника весит
          мегабайты, и на мобильной сети ожидание заметное. Молчащее поле в это
          время выглядит сломанным, а оно просто ещё не готово подсказывать. */}
      <Working label={!book && !bookFailed ? 'Загружается справочник лекарств…' : null} />
      {!book && !bookFailed && touched && value.trim().length >= 2 && (
        <div className="muted" style={{ marginTop: 'var(--space-1)' }}>
          Название можно вписать руками, так тоже правильно.
        </div>
      )}

      {bookFailed && touched && (
        <div className="muted" style={{ marginTop: 'var(--space-1)' }}>
          Справочник не загрузился. Впишите название с упаковки — так тоже правильно.{' '}
          <button
            className="btn btn--sm"
            type="button"
            style={{ marginTop: 'var(--space-2)' }}
            onClick={() => {
              retryBook()
              setBookFailed(false)
              setПопытка((n) => n + 1)
            }}
          >
            Повторить
          </button>
        </div>
      )}

      {book && touched && value.trim().length >= 2 && found.length === 0 && (
        <div className="muted" style={{ marginTop: 'var(--space-1)' }}>
          В реестре не нашлось — впишите название с упаковки, так тоже правильно.
          {book.date && <> Справочник обновлён {bookDate(book.date)}.</>}
        </div>
      )}
    </div>
  )
}

/**
 * Форма выпуска и дозировка кнопками.
 *
 * Набирать «12,5 мг» руками на телефоне мучительно, а угадывать, в каких формах
 * бывает препарат, — тем более. Форма спрашивается первой, потому что дозировки
 * у форм разные: у геля «5 %», у капсул «200 мг», и общий список был бы смесью,
 * из которой можно выбрать несуществующую пару.
 *
 * Когда форма одна, выбирать не из чего — её ставят молча, и человек видит
 * сразу дозировки.
 */
export function VariantPicker({
  variants,
  form,
  dose,
  onForm,
  onDose,
}: {
  variants: DrugVariant[]
  form: string
  dose: string
  onForm: (form: string) => void
  onDose: (dose: string) => void
}) {
  if (variants.length === 0) return null

  const chosen = variants.find((v) => v.form === form)
  const doses = chosen?.doses ?? (variants.length === 1 ? variants[0].doses : [])

  return (
    <>
      {variants.length > 1 && (
        <div>
          <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
            Форма выпуска
          </div>
          <div className="chips" role="group" aria-label="Формы выпуска из реестра">
            {variants.map((variant) => (
              <button
                key={variant.form}
                type="button"
                className="chip"
                aria-pressed={variant.form === form}
                onClick={() => onForm(variant.form)}
              >
                {variant.form}
              </button>
            ))}
          </div>
        </div>
      )}

      {doses.length > 0 && (
        <div className="chips" role="group" aria-label="Дозировки из реестра">
          {doses.map((item) => (
            <button
              key={item}
              type="button"
              className="chip"
              aria-pressed={dose.trim() === item}
              onClick={() => onDose(item)}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </>
  )
}
