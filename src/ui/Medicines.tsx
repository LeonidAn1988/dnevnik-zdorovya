import { useState } from 'react'
import type { Medicine } from '../types'
import type { Dosing } from '../logic/regimen'
import {
  medicineAlert,
  packsNeeded,
  restockList,
  restockText,
  RESTOCK_DAYS,
  SUPPLY_SOON_DAYS,
  type MedicineAlert,
  dosesToday,
  sortStock,
  type Stock,
} from '../logic/medicines'
import { KIND_LABEL } from '../logic/drugs'
import { monthYear, plural } from '../logic/plural'

// Наружу — для карточки препарата: ей нужен тот же падеж.
export { monthYear }
import { pharmacyLinks } from '../logic/pharmacies'
import { ChevronIcon, CopyIcon, SearchIcon, ShareIcon } from './icons'
import { packUnit } from '../logic/units'
import { MenuButton } from './Picker'
import { platform } from '../platform/ports'
import { canShareFile, copyTextOut, shareTextOut } from '../logic/io'
import { Banner } from './bits'

/**
 * Общие куски лекарственных разделов.
 *
 * «Приём» и «Аптечка» — разные экраны с разной частотой использования, но
 * предупреждения, полоса запаса и список покупок у них одни. Держать их здесь
 * дешевле, чем дублировать в двух файлах и потом расходиться формулировками.
 */

/**
 * «мая 2027», а не «май 2027». Intl с month: 'long' даёт именительный падеж, и
 * получается «годен до май 2027» — падеж приходится задавать руками.
 */
const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
]



/**
 * Пометка «БАД» или «гомеопатия».
 *
 * Стоит рядом с названием везде, где препарат назван: в списке, на его экране и
 * в отчёте врачу. Это не осуждение и не запрет — человек волен принимать что
 * хочет, — но и молчать нельзя: БАД лечебного действия не заявляет, а
 * гомеопатия действующего вещества в проверяемом количестве не содержит. Тот,
 * кто ведёт дневник давления, имеет право видеть разницу в своём же списке.
 */
export function KindTag({ kind }: { kind: Medicine['kind'] }) {
  if (!kind) return null
  return (
    <span className="kind-tag" data-kind={kind}>
      {KIND_LABEL[kind]}
    </span>
  )
}

/**
 * Как назвать поле состава.
 *
 * У лекарства это действующее вещество из реестра, у БАДа — то, источником чего
 * он объявлен. Называть второе действующим веществом нельзя: у БАДа его нет по
 * определению, и подпись обещала бы лечебное действие, которого он не заявляет.
 */
export const substanceLabel = (kind: Medicine['kind']): string =>
  kind === 1 ? 'Источник' : 'Действующее вещество'

const days = (n: number): string => `${n} ${plural(n, 'день', 'дня', 'дней')}`

export function alertText(alert: MedicineAlert, medicine: Medicine): string {
  switch (alert.kind) {
    case 'expired':
      // Дату не повторяем: она стоит полем «Годен до» в карточке препарата.
      return 'Срок годности истёк'
    case 'out':
      return 'Закончился'
    case 'low':
      return alert.days === 0 ? 'Хватит меньше чем на день' : `Хватит на ${days(alert.days)}`
    case 'expiring':
      return `Годен до конца ${monthYear(medicine.expires!)}`
  }
}

/** Строгий срок и кончившийся препарат — красным, остальное — жёлтым. */
export const ALERT_TONE: Record<MedicineAlert['kind'], 'critical' | 'warning'> = {
  expired: 'critical',
  out: 'critical',
  low: 'warning',
  expiring: 'warning',
}

export function MedicineNudge({
  count,
  items,
  onOpen,
  onDismiss,
}: {
  count: number
  /** Коробки, которые касаются человека, — из них берутся названия для баннера. */
  items: Stock[]
  onOpen: () => void
  /** «Понятно»: убрать баннер на неделю. Точка на вкладке «Аптечка» останется. */
  onDismiss: () => void
}) {
  if (count === 0) return null

  const now = Date.now()
  const тревожные = items.filter((item) => medicineAlert(item.box, item.intakes, now) !== null)
  const названия = тревожные.slice(0, 2).map((item) => item.box.name.trim()).filter(Boolean)
  const список =
    названия.length === 0
      ? 'Что-то заканчивается или у чего-то истекает срок годности.'
      : `${названия.join(', ')}${тревожные.length > названия.length ? ` и ещё ${тревожные.length - названия.length}` : ''}.`

  return (
    <Banner tone="warning">
      <b>
        Аптечка: {count} {plural(count, 'препарат требует', 'препарата требуют', 'препаратов требуют')} внимания
      </b>
      {/* Названия, а не «что-то»: приложение знает, о чём речь, и молчать об
          этом — заставлять открывать аптечку ради того, что можно сказать. */}
      <div style={{ marginTop: 4 }}>{список}</div>
      <div className="row" style={{ marginTop: 'var(--space-3)' }}>
        <button className="btn" onClick={onOpen}>
          Открыть аптечку
        </button>
        <button className="btn btn--sm" onClick={onDismiss}>
          Понятно
        </button>
      </div>
    </Banner>
  )
}

const REASON_LABEL: Record<'out' | 'low' | 'expired' | 'expiring', string> = {
  out: 'закончился',
  expired: 'просрочен',
  low: 'кончается',
  expiring: 'истекает срок',
}

/**
 * «Сегодня» на «Обзоре»: что принять и сколько уже отмечено.
 *
 * Строки без кнопок — отмечают на «Приёме». Здесь только ответ на вопрос
 * «что мне сегодня», ради которого человек и открывает приложение утром.
 */
export function TodayCard({ medicines, onOpen }: { medicines: Dosing[]; onOpen: () => void }) {
  const now = Date.now()
  const rows = medicines
    .flatMap((medicine) => dosesToday(medicine, now).map((slot) => ({ medicine, slot })))
    .sort((a, b) => a.slot.time.localeCompare(b.slot.time))
  if (rows.length === 0) return null
  const left = rows.filter((r) => r.slot.takenAt === null).length

  return (
    <div className="card">
      <div className="card__head">
        <h2>Сегодня</h2>
        <span className="muted">{left === 0 ? 'всё отмечено' : `осталось отметить: ${left}`}</span>
      </div>
      <ul className="today">
        {rows.map(({ medicine, slot }) => (
          <li key={`${medicine.regimenId}-${slot.time}`} className="today__row" data-done={slot.takenAt !== null} data-overdue={slot.overdue}>
            <span className="today__time">{slot.time}</span>
            <span className="today__name">
              {medicine.name}
              {medicine.dose && <span className="today__dose"> {medicine.dose}</span>}
            </span>
            <span className="today__mark" aria-label={slot.takenAt !== null ? 'принято' : slot.overdue ? 'пропущено' : 'ещё не время'}>
              {slot.takenAt !== null ? '✓' : slot.overdue ? '!' : ''}
            </span>
          </li>
        ))}
      </ul>
      {left > 0 && (
        <div className="row" style={{ marginTop: 'var(--space-3)' }}>
          <button className="btn btn--primary" onClick={onOpen}>
            Отметить приём
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * «Заканчивается» на «Обзоре»: названия и сроки, а не «что-то заканчивается».
 * Пусто — карточки нет: спокойствие не нуждается в подтверждении.
 */
export function ShortageCard({
  stock,
  onOpen,
  onPick,
}: {
  stock: Stock[]
  onOpen: () => void
  /** Нажали на строку: открыть коробку сразу с полем остатка. */
  onPick: (id: string) => void
}) {
  const now = Date.now()
  const rows = sortStock(stock, now)
    .map((item) => ({ medicine: item.box, alert: medicineAlert(item.box, item.intakes, now) }))
    .filter((r): r is { medicine: Medicine; alert: MedicineAlert } => r.alert !== null)
  if (rows.length === 0) return null

  return (
    <div className="card">
      <div className="card__head">
        <h2>Заканчивается</h2>
        <span className="muted">
          {rows.length} {plural(rows.length, 'препарат', 'препарата', 'препаратов')}
        </span>
      </div>
      <ul className="shortage">
        {rows.map(({ medicine, alert }) => (
          <li key={medicine.id}>
            {/* Строка нажимается целиком: за пометкой «закончился» стоит одно
                действие — вписать, сколько на самом деле осталось. Искать для
                этого коробку в аптечке человек не должен. */}
            <button
              type="button"
              className="shortage__row"
              data-tone={ALERT_TONE[alert.kind]}
              onClick={() => onPick(medicine.id)}
            >
              <span className="shortage__name">{medicine.name}</span>
              <span className="shortage__why">{alertText(alert, medicine)}</span>
              <ChevronIcon />
            </button>
          </li>
        ))}
      </ul>
      <div className="row" style={{ marginTop: 'var(--space-3)' }}>
        <button className="btn" onClick={onOpen}>
          В аптечку
        </button>
      </div>
    </div>
  )
}

/**
 * Что пора купить.
 *
 * Отдельный экран, а не пометки в общем списке: в аптеке и в аптечном
 * приложении нужен готовый перечень, а не разбор десяти карточек. Список
 * отдаётся простым текстом — его вставляют в мессенджер, диктуют по телефону
 * и читают с экрана у прилавка.
 */
export function Restock({
  stock,
  ownerName,
  pharmacies = [],
  onPick,
}: {
  stock: Stock[]
  /** Кто её принимает — в общем списке дома. Пусто, когда человек один. */
  ownerName?: (item: Stock) => string | null
  /** Выбранные аптеки: под каждой строкой появятся ссылки на поиск. */
  pharmacies?: readonly string[]
  /** Нажали на название: открыть коробку сразу с полем остатка. */
  onPick: (id: string) => void
}) {
  // Все состояния объявлены до единственного выхода ниже. Иначе при пустом
  // списке покупок React насчитывает меньше хуков, чем в прошлый раз, и роняет
  // всё приложение в белый экран — ровно это и случилось у человека, который
  // переключился на того, кому покупать нечего.
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const list = restockList(stock, Date.now())
  if (list.length === 0) return null

  // Имя владельца ищется по коробке: `restockText` знает только про коробку,
  // а кто её принимает — свойство пары «коробка и курс».
  const чей = ownerName ? (m: Medicine) => ownerName(stock.find((s) => s.box.id === m.id)!) : undefined
  // Галочки и заголовок: список уходит сообщением в мессенджер, и там он
  // должен читаться списком, а не абзацем.
  const text = restockText(list, чей, { checklist: true })

  const copy = async () => {
    const ok = await copyTextOut(text)
    setFailed(!ok)
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="card" data-tour="restock">
      <div className="card__head">
        <h2>Купить</h2>
        <span className="muted">
          {list.length} {plural(list.length, 'препарат', 'препарата', 'препаратов')}
        </span>
      </div>

      <ul className="buy">
        {list.map(({ medicine, reason, need }) => (
          <li key={medicine.id} className="buy__row">
            {/* Открывается как в аптечке: строка целиком со шевроном, а не
                подчёркнутое имя. Подчёркивание стояло в одном ряду со ссылками
                аптек и читалось как ещё одна аптека. Кнопка тут не на всю
                строку, а на её верхнюю часть: ссылки аптек ниже — сами кнопки,
                а кнопка внутри кнопки это сломанная разметка. */}
            <button type="button" className="buy__open" onClick={() => onPick(medicine.id)}>
              <span className="buy__body">
                <span className="buy__name">{medicine.name}</span>
                {/* Имя владельца в строке покупок: без него список «что купить»
                    на всю семью не говорит, кому именно, а в аптеке это и есть
                    главный вопрос — брать одну пачку или две. */}
                {чей?.(medicine) && <span className="buy__owner">{чей(medicine)}</span>}
                {medicine.dose && <span className="buy__dose">{medicine.dose}</span>}
                <span className="buy__why" data-reason={reason}>
                  {REASON_LABEL[reason]}
                </span>
                {/* Не «внимание» и не красным: это не тревога, а обстоятельство
                    похода. За рецептурным сначала к врачу, и знать об этом надо
                    до выхода из дома, а не у прилавка. */}
                {medicine.rx && <span className="buy__rx">нужен рецепт</span>}
                {medicine.inn && medicine.inn !== medicine.name && (
                  <span className="buy__inn">по веществу: {medicine.inn}</span>
                )}
              </span>
              {/* Сколько брать — внутри кнопки: это сведения, а не действие, и
                  без них верхняя строка не была бы целой целью нажатия, а
                  шеврон стоял бы посреди строки, а не у края, как в аптечке. */}
              {need !== null && (
                <span className="buy__need">
                  {packsNeeded(medicine, need) !== null ? (
                    <>
                      {packsNeeded(medicine, need)} {plural(packsNeeded(medicine, need)!, 'пачка', 'пачки', 'пачек')}
                      <span className="fact__note">по {medicine.packSize} {packUnit(medicine)}</span>
                    </>
                  ) : (
                    `${need} ${packUnit(medicine)}`
                  )}
                </span>
              )}
              <ChevronIcon />
            </button>
            {/* Одна кнопка вместо ряда ссылок на каждую сеть.

                Аптек можно выбрать шесть, препаратов в списке бывает пять, и
                прежний ряд именованных ссылок разрастался в частокол из
                тридцати синих слов — список «что купить» переставал читаться
                как список. За кнопкой лист с теми же сетями; когда сеть одна,
                лист не открывается и нажатие ведёт прямо в неё.

                Значок с подписью, а не один значок: лупу узнают почти все, но
                «почти» здесь мало. Приложение отдают людям, для которых
                неопознанная кнопка означает, что ею не пользуются вовсе. */}
            {pharmacyLinks(medicine, pharmacies).length > 0 && (
              <span className="buy__where no-print">
                <MenuButton
                  className="btn btn--sm btn--labelled"
                  title={
                    <>
                      <SearchIcon />
                      Найти
                    </>
                  }
                  label="В какой аптеке искать"
                  options={pharmacyLinks(medicine, pharmacies).map((a) => ({ id: a.id, title: a.name }))}
                  onPick={(id) => {
                    const сеть = pharmacyLinks(medicine, pharmacies).find((a) => a.id === id)
                    // Через порт: на телефоне ссылку перехватывает приложение
                    // аптеки и открывается на своей главной, теряя запрос.
                    if (сеть) void platform().files.openExternal(сеть.href)
                  }}
                />
                {pharmacyLinks(medicine, pharmacies).some((a) => a.innHref) && (
                  <MenuButton
                    className="btn btn--sm"
                    title="по веществу"
                    label="В какой аптеке искать по веществу"
                    options={pharmacyLinks(medicine, pharmacies)
                      .filter((a) => a.innHref)
                      .map((a) => ({ id: a.id, title: a.name }))}
                    onPick={(id) => {
                      const сеть = pharmacyLinks(medicine, pharmacies).find((a) => a.id === id)
                      if (сеть?.innHref) void platform().files.openExternal(сеть.innHref)
                    }}
                  />
                )}
              </span>
            )}
          </li>
        ))}
      </ul>

      {/* В строку, а не столбиком: две кнопки во всю ширину под списком из
          одного препарата весили больше самого списка. Значок рядом с подписью
          позволяет сократить её до одного слова, и обе помещаются в ряд. */}
      <div className="row buy__actions" style={{ marginTop: 'var(--space-4)' }}>
        {canShareFile() && (
          <button
            className="btn btn--primary btn--labelled"
            // Текстом, а не файлом «купить.txt»: получатель видит сообщение в
            // ленте, а не вложение, которое надо открыть и которое непонятно
            // как называется.
            onClick={() => void shareTextOut(text, 'Купить в аптеке')}
          >
            <ShareIcon />
            Отправить
          </button>
        )}
        <button
          className={canShareFile() ? 'btn btn--labelled' : 'btn btn--primary btn--labelled'}
          onClick={() => void copy()}
        >
          <CopyIcon />
          {copied ? 'Скопировано' : 'Скопировать'}
        </button>
      </div>

      {failed && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Banner tone="critical">
            Скопировать не вышло — телефон не дал доступ к буферу обмена. Отправьте список кнопкой рядом.
          </Banner>
        </div>
      )}

      <p className="muted" style={{ margin: 'var(--space-3) 0 0' }}>
        Количество рассчитано на {RESTOCK_DAYS} {plural(RESTOCK_DAYS, 'день', 'дня', 'дней')}
        {ownerName ? ' по расписанию каждого.' : ' по вашему расписанию.'}
        {/* Фраза про просроченную пачку выводилась всегда, даже когда в списке
            одни «кончается». Человек 75 лет читал запрет принимать лекарство,
            шёл искать несуществующую просроченную пачку — а в худшем случае
            решал, что нельзя пить ту, что лежит дома. */}
        {list.some((item) => item.reason === 'expired') && (
          <> Просроченная пачка в запас не засчитана: у неё истёк срок годности.</>
        )}
      </p>
    </div>
  )
}

/** «26 августа» — дата, когда запас кончится. Она нагляднее, чем «через 13 дней». */
const dayMonth = (ts: number): string => {
  const d = new Date(ts)
  return `${d.getDate()} ${MONTHS_GENITIVE[d.getMonth()]}`
}

/** Горизонт полосы запаса. Дальше месяца загадывать бессмысленно, а полоса всё равно полна. */
const SUPPLY_HORIZON = 30

/**
 * Прогноз запаса: полоса и подпись.
 *
 * Полоса нужна для взгляда мельком — заполнена наполовину или почти пуста
 * видно быстрее, чем читается число. Смысл при этом несёт подпись: полоса
 * скрыта от скринридера, дублировать её словами нечем.
 */
export function Supply({ days, until }: { days: number; until: number | null }) {
  const state = days <= 0 ? 'critical' : days <= SUPPLY_SOON_DAYS ? 'warning' : 'ok'
  const fill = Math.max(2, Math.min(100, Math.round((days / SUPPLY_HORIZON) * 100)))

  return (
    <div className="supply" data-state={state}>
      <div className="supply__track" aria-hidden="true">
        <div className="supply__fill" style={{ width: `${fill}%` }} />
      </div>
      <div className="supply__text">
        {days <= 0 ? 'Запас кончился' : <>Хватит на {days} {plural(days, 'день', 'дня', 'дней')}</>}
        {until !== null && days > 0 && <span className="muted"> · до {dayMonth(until)}</span>}
      </div>
    </div>
  )
}
