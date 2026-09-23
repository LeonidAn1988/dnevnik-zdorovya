import { useState } from 'react'
import type { Medicine, Regimen } from '../types'
import {
  type Stock,
  addPack,
  displayAlert,
  effectiveLeft,
  isEstimated,
  perDayOf,
  runsOutAt,
  setLeft,
  supplyDays,
  stageOn,
  formatCount,
  startOfDay
} from '../logic/medicines'
import { instructionUrl } from '../logic/drugs'
import { cleanTradeName, pharmacyLinks, searchEngineUrl } from '../logic/pharmacies'
import { platform } from '../platform/ports'
import { plural } from '../logic/plural'
import { describeEnd } from '../logic/regimen'
import { describeRhythm } from '../logic/rhythm'
import { packUnit, unitsOf } from '../logic/units'
import { NumberField } from './NumberField'
import { MenuButton } from './Picker'
import { Banner, BackBar } from './bits'
import { PencilIcon, TrashIcon } from './icons'
import { alertText, ALERT_TONE, KindTag, monthYear, substanceLabel, Supply } from './Medicines'

/**
 * Экран одного препарата.
 *
 * Отдельный экран, а не раскрытие в списке. Подробностей у препарата на десяток
 * полей — это заведомо больше, чем помещается в строку списка, а две цели
 * нажатия в одной карточке (открыть и раскрыть) дают промахи, особенно у
 * пожилых. На своём экране влезают и крупный шрифт, и полноразмерные кнопки.
 */

function Row({ label, value, note }: { label: string; value: React.ReactNode; note?: string }) {
  const empty = value === null || value === undefined || value === ''
  return (
    <div className="detail__row">
      <dt>{label}</dt>
      <dd>
        {empty ? <span className="fact__empty">не указано</span> : value}
        {note && <span className="fact__note">{note}</span>}
      </dd>
    </div>
  )
}

export function MedicineCard({
  stock,
  onBack,
  onSave,
  onDelete,
  onStopRegimen,
  onEdit,
  owner,
  pharmacies = [],
  editLeft = false,
}: {
  /** Коробка вместе с курсами, которые из неё принимают. */
  stock: Stock
  onBack: () => void
  onSave: (item: Medicine, regimen?: Regimen | null) => Promise<void>
  onDelete: () => void
  /** Прекратить приём, оставив коробку в аптечке. */
  onStopRegimen?: (id: string) => void
  onEdit: () => void
  /** Кто её принимает. Пусто — человек один или не принимает никто. */
  owner?: string | null
  /** Выбранные аптеки: по кнопке на каждую. */
  pharmacies?: readonly string[]
  /**
   * Открыть сразу с полем остатка.
   *
   * Из «Заканчивается» и «Купить» приходят с одним намерением — вписать новое
   * число. Показывать им карточку и заставлять искать кнопку значит вернуть то
   * самое лишнее касание, ради которого строка и сделана нажимаемой.
   */
  editLeft?: boolean
}) {
  const medicine = stock.box
  const приёмы = stock.intakes
  /**
   * Курс, о котором говорит карточка.
   *
   * Их может быть несколько — одну упаковку принимают двое. Подробности
   * расписания показываем по первому: разложить два разных расписания в одной
   * карточке негде, а кто именно принимает, написано строкой выше.
   */
  const курс = приёмы[0]
  const [addingPack, setAddingPack] = useState(false)
  const [packValue, setPackValue] = useState(String(medicine.packSize ?? ''))
  const [editingLeft, setEditingLeft] = useState(editLeft)
  const [leftValue, setLeftValue] = useState(
    editLeft ? String(effectiveLeft(medicine, приёмы, Date.now()) ?? '') : String(medicine.left ?? ''),
  )
  const [confirming, setConfirming] = useState(false)

  const now = Date.now()
  const { alert: shownAlert, showSupply, enough } = displayAlert(medicine, приёмы, now)
  const supply = supplyDays(medicine, приёмы, now)
  const left = effectiveLeft(medicine, приёмы, now)
  const estimated = isEstimated(medicine, приёмы, now)
  const perDay = курс ? perDayOf(курс, now) : null

  /**
   * Схема с меняющейся дозой — одной строкой: по сколько сейчас и когда
   * следующая перемена. Без срока человек не знает, что доза скоро изменится,
   * и держит это в голове сам — ровно то, ради чего схема и заводилась.
   */
  const этап = курс ? stageOn(курс, now) : null
  const схема = (() => {
    if (!этап) return null
    if (этап.finished) return 'курс закончен'
    const доза = `по ${formatCount(этап.perTime)} за приём`
    if (этап.endsAt === null) return `${доза}, дальше так же`
    const дней = Math.max(0, Math.ceil((этап.endsAt - startOfDay(now)) / (24 * 60 * 60 * 1000)))
    const следующий = курс?.plan?.[этап.index + 1]
    const дальше = следующий ? `дальше по ${formatCount(следующий.perTime)}` : 'дальше приём заканчивается'
    return `${доза} ещё ${дней} ${plural(дней, 'день', 'дня', 'дней')}, ${дальше}`
  })()

  // Ритм приписан к временам, а не вынесен отдельной строкой: «08:00, через
  // день» — это один ответ на один вопрос «когда принимать», и разносить его
  // по двум строкам значит заставлять собирать обратно.
  const ритм = describeRhythm(курс?.rhythm)
  const schedule = курс?.times?.length
    ? `${курс.times.join(', ')}${ритм ? ` · ${ритм}` : ''}`
    : perDay !== null
      ? `${perDay} ${plural(perDay, 'раз', 'раза', 'раз')} в день`
      : ''

  const аптеки = pharmacyLinks(medicine, pharmacies)
  const поВеществу = аптеки.filter((а) => а.innHref)

  return (
    <div className="stack">
      <BackBar onBack={onBack} />

      <div className="card">
        <div className="card__head">
          <h2>
            {medicine.name}
            <KindTag kind={medicine.kind} />
          </h2>
          <span className="muted">
            {/* Владелец назван прямо: карточку открывают и из общей аптечки,
                где рядом лежат чужие коробки, а экран при этом на другого
                человека не переключается. */}
            {[owner, medicine.dose].filter(Boolean).join(' · ')}
          </span>
        </div>

        {shownAlert && (
          <div className={`pill__alert pill__alert--${ALERT_TONE[shownAlert.kind]}`}>
            {alertText(shownAlert, medicine)}
          </div>
        )}

        {showSupply && <Supply days={supply!} until={runsOutAt(medicine, приёмы, now)} />}

        {/* Курс кончается раньше, чем запас: докупать нечего, и полоса запаса
            тут только пугала бы месячной меркой. */}
        {enough && курс && <div className="supply supply--ok">Хватит до конца курса</div>}

        {/* Все кнопки про остаток, и выглядеть они должны одинаково. */}
        <div className="row row--stack" style={{ marginTop: 'var(--space-4)' }}>
          {medicine.packSize ? (
            <button className="btn btn--primary" onClick={() => void onSave(addPack(medicine, приёмы, Date.now()))}>
              Купил упаковку — {medicine.packSize} {packUnit(medicine)}
            </button>
          ) : null}
          {/* Третьей кнопкой, а не парой в строку: две кнопки разной длины
              рядом дают ту самую лесенку, ради которой здесь и появился
              столбик во всю ширину. */}
          <button
            className="btn"
            onClick={() => {
              // Размер подставляем привычный: чаще всего это поле открывают,
              // чтобы поменять 30 на 60, а не набрать число с нуля.
              if (!addingPack) setPackValue(String(medicine.packSize ?? ''))
              setEditingLeft(false)
              setAddingPack((open) => !open)
            }}
          >
            {medicine.packSize ? 'Другая упаковка' : 'Купил упаковку'}
          </button>
          <button
            className="btn"
            onClick={() => {
              // Поле заполняется при открытии редактора, а не при показе
              // карточки: остаток к этому моменту мог списаться расписанием.
              if (!editingLeft) setLeftValue(String(effectiveLeft(medicine, приёмы, Date.now()) ?? ''))
              setAddingPack(false)
              setEditingLeft((open) => !open)
            }}
          >
            Поправить остаток
          </button>
        </div>

        {addingPack && (
          <form
            className="pill__left-edit"
            onSubmit={async (event) => {
              event.preventDefault()
              const parsed = Number(packValue.replace(',', '.'))
              if (!Number.isFinite(parsed) || parsed <= 0) return
              await onSave(addPack(medicine, приёмы, Date.now(), parsed))
              setAddingPack(false)
            }}
          >
            <div style={{ maxWidth: 170 }}>
              <NumberField
                label={unitsOf(medicine).packLabel}
                value={packValue}
                onChange={setPackValue}
                min={1}
                max={500}
                start={30}
                size="compact"
                autoFocus
              />
            </div>
            <div className="row">
              <button type="submit" className="btn btn--primary btn--sm">
                Добавить
              </button>
              <button type="button" className="btn btn--sm" onClick={() => setAddingPack(false)}>
                Отмена
              </button>
            </div>
          </form>
        )}

        {editingLeft && (
          <form
            className="pill__left-edit"
            onSubmit={async (event) => {
              event.preventDefault()
              const parsed = Number(leftValue.replace(',', '.'))
              if (!Number.isFinite(parsed)) return
              await onSave(setLeft(medicine, parsed, Date.now()))
              setEditingLeft(false)
            }}
          >
            <div style={{ maxWidth: 170 }}>
              <NumberField
                label="Сколько осталось"
                value={leftValue}
                onChange={setLeftValue}
                min={0}
                max={999}
                start={30}
                size="compact"
                autoFocus
              />
            </div>
            <div className="row">
              <button type="submit" className="btn btn--primary btn--sm">
                Сохранить
              </button>
              <button type="button" className="btn btn--sm" onClick={() => setEditingLeft(false)}>
                Отмена
              </button>
            </div>
          </form>
        )}
      </div>

      <div className="card">
        <div className="card__head">
          <h2>О препарате</h2>
        </div>

        <dl className="detail">
          <Row
            label="Остаток"
            // Половинки — дробью и с запятой: «55.5 шт.» это машинный вывод.
            value={left === null ? '' : `${estimated ? '≈ ' : ''}${formatCount(left)} ${packUnit(medicine)}`}
            note={курс?.autoDeduct ? 'отмечать не нужно' : estimated ? 'по расчёту' : undefined}
          />
          <Row
            label="Приём"
            value={schedule}
            note={курс?.meal === 'before' ? 'до еды' : курс?.meal === 'after' ? 'после еды' : undefined}
          />
          {/* Конец курса отдельной строкой, а не припиской к расписанию: после
              него препарат перестаёт напоминать о себе, и это самостоятельный
              факт — такой же, как срок годности у коробки. */}
          {курс && describeEnd(курс, now) && <Row label="Принимать до" value={describeEnd(курс, now)!} />}
          {medicine.rx && <Row label="Отпуск" value="по рецепту" note="напомним за две недели" />}
          {схема && <Row label="Как принимать" value={схема} />}
          {/* `== null` ловит и `undefined`: у коробки, пришедшей из копии или
              слияния, поля может не быть вовсе, и `monthYear` печатал «undefined NaN». */}
          <Row label="Годен до" value={medicine.expires == null ? '' : monthYear(medicine.expires)} />
          <Row label="Форма выпуска" value={medicine.form ?? ''} />
          <Row label={substanceLabel(medicine.kind)} value={medicine.inn ?? ''} />
          <Row label="Производитель" value={medicine.maker ?? ''} />
          <Row label="В упаковке" value={medicine.packSize ? `${medicine.packSize} ${packUnit(medicine)}` : ''} />
          {medicine.note && <Row label="Примечание" value={medicine.note} />}
        </dl>

        {/* Один абзац фактов, без назиданий: что человеку принимать — его дело,
            наше дело — не выдавать одно за другое. */}
        {medicine.kind === 1 && (
          <Banner tone="info">
            <b>Это БАД, а не лекарство.</b>
            <div style={{ marginTop: 4 }}>
              Добавки регистрируются как пищевая продукция: лечебного действия они не заявляют и клинических испытаний,
              как лекарства, не проходят. Назначенные препараты БАД не заменяет.
            </div>
          </Banner>
        )}
        {medicine.kind === 2 && (
          <Banner tone="info">
            <b>Это гомеопатическое средство.</b>
            <div style={{ marginTop: 4 }}>
              Оно зарегистрировано как лекарство, но действующего вещества в проверяемом количестве не содержит.
              Назначенные препараты им не заменяют.
            </div>
          </Banner>
        )}

        {/* `row--stack`, а не просто `row`: шесть кнопок разной длины —
            «Изменить», «Инструкция», аптеки, «Больше не принимаю», «Удалить» —
            складывались лесенкой из прямоугольников разной ширины. Правило
            заведено ещё в 0.8.2 (экран копии, аптечка, карточка препарата), но
            при разделении коробки и курса в 0.27.0 с этой карточки потерялось.
            Столбик одной ширины читается как список действий, лесенка — как
            случайность вёрстки. */}
        <div className="row row--stack" style={{ marginTop: 'var(--space-5)' }}>
          <button className="btn" onClick={onEdit}>
            <PencilIcon />
            Изменить
          </button>
          <a
            className="btn"
            href={instructionUrl(medicine.name, medicine.dose)}
            target="_blank"
            rel="noopener noreferrer"
          >
            Инструкция
          </a>
          {/* Выбранные аптеки — по кнопке на каждую, поиск сразу по названию и
              дозировке. Если ни одна не выбрана, остаётся общий поиск: он ищет
              по действующему веществу и находит дешёвые аналоги. Запрос в обоих
              случаях уходит с устройства человека, от нас наружу не идёт ничего. */}
          {аптеки.length > 0 ? (
            аптеки.map((аптека) => (
              <a
                key={аптека.id}
                className="btn"
                href={аптека.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => {
                  event.preventDefault()
                  void platform().files.openExternal(аптека.href)
                }}
              >
                {аптека.name}
              </a>
            ))
          ) : (
            <a className="btn" href={searchEngineUrl(medicine)} target="_blank" rel="noopener noreferrer">
              Найти в аптеке
            </a>
          )}
          {поВеществу.length > 0 && (
            // Запасной путь, когда торговое имя не находится: та же сеть, но
            // по действующему веществу. Одной кнопкой, а не по кнопке на сеть:
            // рядом уже стоит ряд аптек, и второй такой же ряд не читается.
            // Куда идти, спрашиваем — молча вести в первую попавшуюся нельзя.
            <MenuButton
              className="btn btn--sm"
              title={`По веществу: ${cleanTradeName(medicine.inn ?? '')}`}
              label="В какой аптеке искать"
              options={поВеществу.map((а) => ({ id: а.id, title: а.name }))}
              onPick={(id) => {
                const сеть = поВеществу.find((а) => а.id === id)
                if (сеть) void platform().files.openExternal(сеть.innHref!)
              }}
            />
          )}
          {/* Прекратить приём — не то же самое, что выбросить коробку, и с
              0.27.0 это два разных действия. Курс кончился, а пачка осталась в
              шкафу: она ещё годна, и удалять её незачем. Кнопка не красная —
              ничего не разрушается, запись о приёме просто перестаёт быть. */}
          {курс && onStopRegimen && !confirming && (
            <button className="btn" onClick={() => onStopRegimen(курс.regimenId)}>
              Больше не принимаю
            </button>
          )}
          {confirming ? (
            <>
              {/* «Отмена» занимает место, где только что была кнопка
                  «Удалить». Раньше туда вставало «Удалить насовсем», и второе
                  нажатие подряд — обычное дело у пожилого человека и на
                  медленном телефоне — стирало препарат без единого вопроса.
                  Опасное действие обязано переехать, а не подставиться под
                  палец. */}
              <button className="btn" onClick={() => setConfirming(false)}>
                Отмена
              </button>
              <button className="btn btn--danger" onClick={onDelete}>
                Удалить насовсем
              </button>
            </>
          ) : (
            <button className="btn btn--danger" onClick={() => setConfirming(true)}>
              <TrashIcon />
              Удалить из аптечки
            </button>
          )}
        </div>

        {/* Одной строкой вместо абзаца: человеку важно знать, куда он сейчас
            попадёт, а не как устроен реестр. */}
        <div className="muted" style={{ marginTop: 'var(--space-3)' }}>
          Инструкция и аптеки открываются в браузере.
        </div>
      </div>
    </div>
  )
}
