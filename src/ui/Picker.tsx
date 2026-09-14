import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { FunnelIcon } from './icons'

/**
 * Выбор списком снизу: фильтр с видимым значением и меню без него.
 *
 * Раньше на месте фильтра стоял ряд кнопок — по кнопке на человека и по кнопке
 * на срок запаса. Ряд честно показывал все варианты сразу, но рос вместе с
 * семьёй: четыре имени с «Все» не помещаются в строку ни при каком размере
 * текста, а в аптечке таких рядов было два подряд, и на маленьком экране они
 * съедали место, ради которого человек сюда и пришёл.
 *
 * Кнопка занимает одну строку при любом числе вариантов. Выбранное значение
 * остаётся на экране прямым текстом — это условие, а не украшение: на
 * «Давлении» и «Приёме» та же кнопка отвечает на вопрос «кому я это сейчас
 * записываю», и спрятать ответ под безымянный значок значит однажды записать
 * чужое давление.
 *
 * Список — модальный лист снизу. Не выпадающее меню: выпадающее обрезается
 * прокручиваемым предком, и его строки приходится делать мелкими. Лист берёт
 * ширину экрана, строки в нём по 44 пикселя, и системный `<dialog>` сам даёт
 * Esc, возврат фокуса и затемнение позади.
 */

/** Один вариант в листе. */
export interface PickOption {
  id: string
  title: string
  /** Пояснение второй строкой — когда одного названия мало. */
  hint?: string
  /** Отделить чертой: вариант не из того же ряда, что соседи. */
  apart?: boolean
}

/**
 * Сам лист. Общий для обеих кнопок: поведение у них обязано быть одинаковым,
 * а различаются они только тем, что нарисовано на кнопке и в строках.
 */
function Sheet({
  dialogRef,
  label,
  children,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>
  label: string
  children: ReactNode
}) {
  // Приложение ведёт свою историю экранов, и аппаратная «Назад» на телефоне
  // может снять экран из-под открытого листа. Тогда лист закрываем сами —
  // иначе он повиснет над разделом, к которому уже не относится.
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return
    const закрыть = () => el.close()
    window.addEventListener('popstate', закрыть)
    return () => window.removeEventListener('popstate', закрыть)
  }, [dialogRef])

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      aria-label={label}
      // Клик мимо списка — по самому `<dialog>`, а не по его содержимому:
      // затемнение и есть элемент, лист внутри перехватывает своё.
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close()
      }}
    >
      <div className="sheet__body">
        <p className="sheet__title">{label}</p>
        <div className="sheet__list">{children}</div>
        <button type="button" className="btn sheet__close" onClick={() => dialogRef.current?.close()}>
          Закрыть
        </button>
      </div>
    </dialog>
  )
}

/** Строка листа. Место под галочку держится всегда, чтобы подписи не съезжали. */
function Row({ option, chosen, onPick }: { option: PickOption; chosen: boolean | null; onPick: () => void }) {
  return (
    <button
      type="button"
      className="sheet__row"
      data-apart={option.apart ? '' : undefined}
      aria-pressed={chosen === null ? undefined : chosen}
      onClick={onPick}
    >
      <span className="sheet__mark" aria-hidden="true">
        {chosen ? '✓' : ''}
      </span>
      <span className="sheet__name">
        {option.title}
        {option.hint && <span className="sheet__hint">{option.hint}</span>}
      </span>
    </button>
  )
}

/** Фильтр: воронка, выбранное значение и список, где оно отмечено. */
export function FilterButton({
  label,
  selected,
  options,
  onPick,
}: {
  /** Заголовок листа и подпись кнопки для чтения с экрана: «Чей дневник». */
  label: string
  /** Что выбрано — по ключу, а не по подписи: двух Саш в семье не запретишь. */
  selected: string
  options: PickOption[]
  onPick: (id: string) => void
}) {
  const лист = useRef<HTMLDialogElement>(null)
  const выбран = options.find((item) => item.id === selected) ?? options[0]
  const value = выбран?.title ?? ''

  return (
    <>
      {/* На кнопке — только выбранное. Подпись группы ушла в `aria-label` и в
          заголовок листа: «Что показывать: Все сроки» в одну строку на 360 px
          при крупном тексте не помещается, а значение помещается всегда. */}
      <button
        type="button"
        className="filterbtn"
        aria-haspopup="dialog"
        aria-label={`${label}: ${value}`}
        onClick={() => лист.current?.showModal()}
      >
        <FunnelIcon />
        <span className="filterbtn__value">{value}</span>
      </button>

      <Sheet dialogRef={лист} label={label}>
        {options.map((item) => (
          <Row
            key={item.id}
            option={item}
            chosen={item.id === выбран?.id}
            onPick={() => {
              onPick(item.id)
              лист.current?.close()
            }}
          />
        ))}
      </Sheet>
    </>
  )
}

/**
 * Кнопка со списком, куда пойти: выбранного значения у неё нет.
 *
 * Нужна там, где вариантов несколько, а «текущего» среди них не бывает: поиск
 * по действующему веществу в одной из подключённых аптек. Раньше такая ссылка
 * молча вела в первую попавшуюся сеть — человек с двумя аптеками всегда
 * попадал в одну и ту же и не понимал, почему во вторую не попасть.
 */
export function MenuButton({
  title,
  label,
  className = 'btn',
  options,
  onPick,
}: {
  /** Надпись на кнопке. Не только строка: рядом с текстом бывает значок. */
  title: ReactNode
  /** Заголовок листа: чем этот список отличается от соседнего. */
  label: string
  className?: string
  options: PickOption[]
  onPick: (id: string) => void
}) {
  const лист = useRef<HTMLDialogElement>(null)
  // Один вариант — выбирать не из чего, и лист был бы лишним касанием.
  const одна = options.length <= 1

  return (
    <>
      <button
        type="button"
        className={className}
        aria-haspopup={одна ? undefined : 'dialog'}
        onClick={() => (одна ? options[0] && onPick(options[0].id) : лист.current?.showModal())}
      >
        {title}
      </button>
      {!одна && (
        <Sheet dialogRef={лист} label={label}>
          {options.map((item) => (
            <Row
              key={item.id}
              option={item}
              chosen={null}
              onPick={() => {
                onPick(item.id)
                лист.current?.close()
              }}
            />
          ))}
        </Sheet>
      )}
    </>
  )
}
