import type { ReactNode } from 'react'
import { classify } from '../logic/classify'
import { BackIcon, ChevronIcon } from './icons'

/**
 * Цветовая метка категории давления. Цвет всегда идёт вместе с названием —
 * ни одно значение не передаётся одним лишь цветом.
 */
export function CategoryBadge({ sys, dia, solid = false }: { sys: number; dia: number; solid?: boolean }) {
  const category = classify(sys, dia)
  return (
    <span className={solid ? 'badge badge--solid' : 'badge'} style={{ ['--dot' as string]: category.color }}>
      <span className="badge__dot" />
      {category.label}
    </span>
  )
}


export type BannerTone = 'critical' | 'warning' | 'info' | 'good'

const BANNER_ICONS: Record<BannerTone, string> = {
  critical: '⚠',
  warning: '⚠',
  info: 'ℹ',
  good: '✓',
}

export function Banner({ tone, children }: { tone: BannerTone; children: ReactNode }) {
  return (
    <div className={`banner banner--${tone}`}>
      <span className="banner__icon" aria-hidden="true">
        {BANNER_ICONS[tone]}
      </span>
      <div>{children}</div>
    </div>
  )
}

/**
 * Строка списка, ведущая на другой экран: заголовок, текущее значение, шеврон.
 *
 * Значение здесь обязательно. Список из одних названий заставляет открывать
 * все шесть подэкранов подряд, чтобы вспомнить, что настроено, — а приходят в
 * настройки обычно ради одного.
 *
 * Разметка та же, что у строки препарата в аптечке: приём уже опознан, и
 * заводить ради настроек второй вид списка незачем.
 */
export function NavRow({
  title,
  value,
  onOpen,
  tour,
  mark,
}: {
  title: string
  value?: string
  onOpen: () => void
  /** Якорь для гайд-курса: по нему курс находит строку и обводит её. */
  tour?: string
  /**
   * Точка внимания у названия: за этой строкой что-то ждёт решения.
   *
   * Та же точка, что на вкладке и на служебной кнопке, и означает она то же.
   * Подпись к ней обязательна для чтения с экрана: цветная точка молчит.
   */
  mark?: string
}) {
  return (
    <li className="pill" data-tour={tour}>
      <button className="pill__open" onClick={onOpen}>
        <span className="pill__head">
          <span className="pill__title">
            <span className="pill__name">{title}</span>
            {mark && (
              <>
                <span className="pill__mark" aria-hidden="true" />
                <span className="sr-only">{mark}</span>
              </>
            )}
          </span>
          <ChevronIcon />
        </span>
        {value && <span className="pill__sub">{value}</span>}
      </button>
    </li>
  )
}

/**
 * Возврат на уровень выше.
 *
 * Подпись одна на всё приложение — «Назад», и она совпадает с тем, что делает
 * системная кнопка. Разные подписи вроде «К настройкам» и «К людям» звучат
 * заботливее, но занимают полстроки, а на телефоне с крупным текстом
 * рассыпаются на три строки: стрелка отдельно, слова под ней.
 *
 * `btn--back` держит подпись в одну строку. Обычным кнопкам перенос нужен —
 * при системном шрифте 200 % длинные подписи иначе выходят за карточку, — но
 * здесь слово одно, и переносить в нём нечего.
 */
export function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <div className="row no-print">
      <button className="btn btn--back" onClick={onBack}>
        <BackIcon />
        Назад
      </button>
    </div>
  )
}

/**
 * Что приложение делает прямо сейчас.
 *
 * Полоска под шапкой и одна строка словами. Раньше всё, что идёт само —
 * чтение копий семьи при открытии, запись копии после правки, — происходило
 * молча: экран замирал на секунду, и понять, думает приложение или сломалось,
 * было нечем. Для пожилого человека это разница между «подожду» и «нажму ещё
 * раз пять и позвоню сыну».
 *
 * Полоса неопределённая: сколько осталось, приложение не знает, а рисовать
 * проценты, которых нет, — врать. Строка говорит, что именно идёт.
 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  )
}

/**
 * Плавное раскрытие вместо мгновенного появления.
 * Анимируется grid-template-rows, а не height — содержимое не прыгает и
 * не нужно знать его высоту заранее.
 *
 * inert обязателен: нулевая высота с overflow: hidden прячет содержимое только
 * визуально, а скринридер продолжал бы зачитывать свёрнутые баннеры, и в них же
 * оставались бы досягаемые с клавиатуры кнопки.
 */
export function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  return (
    <div className="reveal" data-open={open} inert={!open}>
      <div>{children}</div>
    </div>
  )
}

export function Working({ label }: { label: string | null }) {
  return (
    <div className="no-print" aria-live="polite" aria-atomic="true">
      <Reveal open={label !== null}>
        <div className="working">
          <div className="progress progress--indeterminate" aria-hidden="true">
            <div className="progress__bar" />
          </div>
          <span className="working__label">{label ?? ''}</span>
        </div>
      </Reveal>
    </div>
  )
}
