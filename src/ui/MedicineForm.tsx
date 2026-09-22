import { useRef, useState } from 'react'
import type { DoseStage, IntakeSlot, Medicine, Person, Regimen, Rhythm } from '../types'
import { expiryToMonth, formatTime, monthToExpiry, normalizeTimes, parseTime } from '../logic/medicines'
import { formGroup as formGroupOf, FORM_GROUPS, normalize, variantsOf, type Drug, type DrugVariant } from '../logic/drugs'
import { NumberField } from './NumberField'
import { Field } from './bits'
import { DrugPicker, VariantPicker } from './DrugPicker'
import { RhythmPicker } from './RhythmPicker'
import { MenuButton } from './Picker'
import { DROPS_PER_ML, dosesInPack, needsDropSize, unitsOf } from '../logic/units'
import { normalizeRhythm } from '../logic/rhythm'
import { daysLeftOf, endsAfter, formatDay } from '../logic/regimen'
import { substanceLabel } from './Medicines'
import { PURPOSE_HINTS, suggestPurpose } from '../logic/cabinet'

/**
 * Заведение и правка препарата.
 *
 * Вынесено из общего файла аптечки: форма живёт своей жизнью и по объёму равна
 * целому экрану, а рядом с ней в одном файле лежали список, приёмы и покупки.
 */

/** Псевдовариант в списке форм: за ним прячется свободный ввод. */
const СВОЯ_ФОРМА = '\u0000своя'

const MEALS: { key: Regimen['meal']; title: string }[] = [
  { key: undefined, title: 'Неважно' },
  { key: 'before', title: 'До еды' },
  { key: 'after', title: 'После еды' },
]

/**
 * Готовые времена: почти все схемы приёма укладываются в эти четыре.
 *
 * Часы приходят из настроек, а не зашиты сюда: у кого-то утро в шесть, а вечер
 * в семнадцать, и таким людям приходилось вводить время руками для каждого
 * препарата.
 */
type Presets = { time: string; title: string }[]

function presetsOf(slots: IntakeSlot[]): Presets {
  return slots.map((slot) => ({ time: slot.time, title: slot.title }))
}

/**
 * Время приёма кнопками плюс поле для своего.
 *
 * Набирать время руками на телефоне пожилому человеку тяжело, а четыре готовых
 * значения покрывают почти все назначения. Своё время остаётся для остальных.
 */
function TimePicker({
  times,
  presets,
  onChange,
}: {
  times: string[]
  presets: Presets
  onChange: (next: string[]) => void
}) {
  const [custom, setCustom] = useState('')

  const toggle = (time: string) =>
    onChange(normalizeTimes(times.includes(time) ? times.filter((t) => t !== time) : [...times, time]))

  const addCustom = () => {
    if (parseTime(custom) === null) return
    onChange(normalizeTimes([...times, formatTime(parseTime(custom)!)]))
    setCustom('')
  }

  const extra = times.filter((t) => !presets.some((p) => p.time === t))

  return (
    <>
      <div className="chips">
        {presets.map(({ time, title }) => (
          <button key={time} type="button" className="chip" aria-pressed={times.includes(time)} onClick={() => toggle(time)}>
            {title} <span className="muted">{time}</span>
          </button>
        ))}
        {extra.map((time) => (
          <button key={time} type="button" className="chip" aria-pressed onClick={() => toggle(time)}>
            {time}
          </button>
        ))}
      </div>

      <div className="row" style={{ marginTop: 'var(--space-3)' }}>
        <input
          type="time"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          aria-label="Своё время приёма"
          style={{ maxWidth: 150 }}
        />
        <button type="button" className="btn btn--sm" onClick={addCustom} disabled={parseTime(custom) === null}>
          Добавить время
        </button>
      </div>

      {times.length === 0 && (
        <p className="muted" style={{ margin: 'var(--space-2) 0 0' }}>
          Без расписания препарат просто лежит в аптечке: остаток считается по полю «В день», напоминаний нет.
        </p>
      )}
    </>
  )
}

/**
 * Форма препарата. Раскрывается на месте, как и правка измерения: модальное окно
 * на телефоне отбирает весь экран ради четырёх полей.
 */
export function MedicineForm({
  medicine,
  regimens = [],
  intakeSlots,
  people,
  activePerson,
  onSave,
  onCancel,
}: {
  medicine?: Medicine
  /**
   * Курсы приёма этой коробки.
   *
   * Форма правит один — тот, что принадлежит выбранному человеку, а если
   * такого нет, первый. Второй курс на ту же коробку заводится на экране
   * приёма: случай «одну пачку пьют двое» редкий, и тащить его в форму
   * заведения препарата значит усложнить её всем ради немногих.
   */
  regimens?: Regimen[]
  /** Часы стандартных приёмов из настроек. */
  intakeSlots: IntakeSlot[]
  /** Люди в дневнике. Пока он один, выбора человека в форме нет вовсе. */
  people: Person[]
  /** Кто выбран сейчас — ему и достаётся новый курс. */
  activePerson: string
  onSave: (item: Medicine, regimen: Regimen | null) => Promise<void>
  onCancel: () => void
}) {
  /** Курс, который правит форма: свой у выбранного человека, иначе первый. */
  const курс = regimens.find((r) => r.person === activePerson) ?? regimens[0] ?? undefined
  /**
   * Чья коробка.
   *
   * Поле нужно не при заведении — там владельцем становится выбранный человек, —
   * а при исправлении ошибки: завели Конкор, глядя на свой экран, а он женин.
   * Без этого поля исправить это можно только удалив и заведя заново, потеряв
   * заодно отметки о приёме.
   */
  // Новая коробка — тому, кто выбран сверху. Существующая без владельца
  // (заведена до появления людей) лежит у первого человека, и форма обязана
  // показать его же: иначе правка остатка при открытом «Отце» молча
  // переписала бы владельца.
  const [owner, setOwner] = useState(курс?.person || activePerson)
  const [name, setName] = useState(medicine?.name ?? '')
  const [dose, setDose] = useState(medicine?.dose ?? '')
  const [left, setLeft] = useState(medicine?.left !== null && medicine?.left !== undefined ? String(medicine.left) : '')
  const [perDay, setPerDay] = useState(
    курс?.perDay !== null && курс?.perDay !== undefined ? String(курс.perDay).replace('.', ',') : '',
  )
  const [month, setMonth] = useState(medicine?.expires ? expiryToMonth(medicine.expires) : '')
  /** «Принимаю с» — месяц со слов человека, для ответа врачу. */
  const [startedMonth, setStartedMonth] = useState(курс?.startedAt ? expiryToMonth(курс.startedAt) : '')
  const [note, setNote] = useState(medicine?.note ?? '')
  const [inn, setInn] = useState(medicine?.inn ?? '')
  const [form, setForm] = useState(medicine?.form ?? '')
  const [maker, setMaker] = useState(medicine?.maker ?? '')
  /**
   * Для чего его держат — полка в шкафу.
   *
   * Подсказка появляется при выборе препарата из реестра и только в пустое
   * поле: в уже заведённую коробку категория не проставляется молча, а то,
   * что человек написал сам, не переписывается. Он назвал полку своими
   * словами, и это вернее любой таблицы.
   */
  const [purpose, setPurpose] = useState(medicine?.purpose ?? '')
  const [rx, setRx] = useState(medicine?.rx ?? false)
  /** Человек тронул галку сам — справочник больше не вмешивается. */
  const rxTouched = useRef(false)
  /** БАД или гомеопатия — из справочника. Обычное лекарство пометки не несёт. */
  const [kind, setKind] = useState<Medicine['kind']>(medicine?.kind)
  const [packSize, setPackSize] = useState(medicine?.packSize ? String(medicine.packSize) : '')
  const [dropsPerMl, setDropsPerMl] = useState(medicine?.dropsPerMl ? String(medicine.dropsPerMl) : '')
  const [packs, setPacks] = useState<number[]>([])
  /** Группа формы сужает поиск: человек держит коробку и знает, таблетки это или мазь. */
  const [group, setGroup] = useState('')
  /** Варианты выпуска выбранного препарата: форма и её дозировки. */
  const [variants, setVariants] = useState<DrugVariant[]>([])
  /** Человек выбрал «Своя формулировка» — показываем поле вместо списка. */
  const [своя, setСвоя] = useState(false)
  const [times, setTimes] = useState<string[]>(normalizeTimes(курс?.times ?? []))
  const [perTime, setPerTime] = useState(String(курс?.perTime ?? 1))
  const [rhythm, setRhythm] = useState<Rhythm | undefined>(() => normalizeRhythm(курс?.rhythm))
  /**
   * Схема с меняющейся дозой. Пустой список означает «доза одна и та же» —
   * так ведёт себя подавляющее большинство коробок, и заводить схему для них
   * не надо.
   */
  const [plan, setPlan] = useState<DoseStage[]>(курс?.plan ?? [])
  /**
   * Сколько дней курса осталось, считая сегодняшний. Пусто — курс без конца.
   *
   * Отсчёт всегда от сегодня, а не от дня заведения препарата. «Принимаю с» —
   * это про жизнь человека, там бывает и позапрошлый год, и трёхдневный курс
   * от такого начала оказывался законченным задолго до того, как его завели.
   * «Осталось три дня» понимается одинаково и в первый день курса, и в пятый.
   *
   * Храним длину, а не дату: врач называет «курс десять дней», и человек
   * повторяет это же.
   */
  const сегодня = Date.now()
  const осталось = курс ? daysLeftOf(курс, сегодня) : null
  const [длина, setДлина] = useState(осталось !== null && осталось > 0 ? String(осталось) : '')
  const дней = Number(длина.replace(',', '.'))
  /*
   * Пустое поле у законченного курса означает «не трогаем», а не «без конца».
   *
   * Иначе правка названия у давно отменённого препарата молча воскрешала бы
   * его: конец исчез — значит, курс снова бессрочный, и напоминания вернулись
   * бы тем же вечером.
   */
  const законченный = осталось !== null && осталось <= 0
  const endsAt =
    длина.trim() !== '' && Number.isFinite(дней) && дней > 0
      ? endsAfter(сегодня, дней)
      : законченный
        ? (курс?.endsAt ?? null)
        : null

  const [meal, setMeal] = useState<Regimen['meal']>(курс?.meal)
  const [autoDeduct, setAutoDeduct] = useState(курс?.autoDeduct ?? false)
  // Единицы зависят от формы выпуска: у капель упаковка в миллилитрах, а приём
  // в каплях, и подписи полей обязаны это говорить.
  const формыПрепарата = variants.map((v) => v.form).filter(Boolean)
  // Группы сужаются до тех, что есть у выбранного препарата. Ничего не
  // подтянулось — показываем все: домашняя аптечка шире реестра.
  const доступныеГруппы =
    формыПрепарата.length > 0
      ? FORM_GROUPS.filter((g) => формыПрепарата.some((f) => formGroupOf(f) === g.key))
      : FORM_GROUPS
  const единицы = unitsOf({ form })
  const капельВоФлаконе = dosesInPack({
    form,
    packSize: Number(packSize) || undefined,
    dropsPerMl: Number(dropsPerMl) || undefined,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const numberOrNull = (raw: string): number | null => {
    const value = Number(raw.replace(',', '.'))
    return raw.trim() === '' || !Number.isFinite(value) ? null : value
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (name.trim() === '') {
      setError('Без названия препарат не найти в списке.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const коробка: Medicine = {
        id: medicine?.id ?? '',
        name: name.trim(),
        dose: dose.trim(),
        inn: inn.trim() || undefined,
        form: form.trim() || undefined,
        maker: maker.trim() || undefined,
        rx: rx || undefined,
        kind,
        packSize: Number(packSize) > 0 ? Number(packSize) : undefined,
        // Только у капель: у прочих форм число бессмысленно и мешало бы при
        // смене формы выпуска.
        dropsPerMl: needsDropSize({ form }) && Number(dropsPerMl) > 0 ? Number(dropsPerMl) : undefined,
        left: numberOrNull(left),
        expires: month ? monthToExpiry(month) : null,
        note: note.trim() || undefined,
        purpose: purpose.trim() || undefined,
        regNumber: medicine?.regNumber,
        /*
         * Дата подтверждения остатка сбрасывается только когда остаток и
         * правда правили.
         *
         * Раньше она ставилась при любом сохранении: поправил название — и
         * расчётный расход обнулился, а показанный остаток подскочил вверх.
         * Это тот же дефект, что чинился в отметке приёма, только с другой
         * стороны.
         */
        leftAt: numberOrNull(left) === (medicine?.left ?? null) ? medicine?.leftAt : Date.now(),
      }

      /*
       * Курс заводится, только когда есть что в нём хранить.
       *
       * Коробка в шкафу, которую никто не принимает, — обычное состояние
       * домашней аптечки, и выдумывать ей пустой курс значило бы записать в
       * дневник назначение, которого не было.
       */
      const естьКурс =
        times.length > 0 || plan.length > 0 || numberOrNull(perDay) !== null || startedMonth !== '' || !!курс
      const следующий: Regimen | null = естьКурс
        ? {
            id: курс?.id ?? '',
            medicineId: medicine?.id ?? '',
            person: people.length > 1 ? owner : (курс?.person ?? activePerson),
            perDay: numberOrNull(perDay),
            startedAt: startedMonth ? (monthToExpiry(startedMonth) ?? undefined) : undefined,
            autoDeduct: autoDeduct || undefined,
            times: times.length > 0 ? times : undefined,
            perTime: times.length > 0 ? Number(perTime) || 1 : undefined,
            // Ритм без расписания бессмыслен: принимать «через день по
            // потребности» не значит ничего, и считать по такому препарату нечего.
            rhythm: times.length > 0 ? normalizeRhythm(rhythm) : undefined,
            // Схема сохраняется только со своим началом: без даты этапы не с чего
            // отсчитывать. Начало — день, когда схему завели, если человек не
            // указал «принимаю с».
            plan: plan.length > 0 ? plan : undefined,
            planFrom:
              plan.length > 0
                ? (курс?.planFrom ?? (startedMonth ? (monthToExpiry(startedMonth) ?? Date.now()) : Date.now()))
                : undefined,
            meal: times.length > 0 ? meal : undefined,
            endsAt: endsAt ?? undefined,
            /*
             * Отметки, история и день заведения переносятся, а не теряются.
             *
             * Форма собирает курс заново из полей, и всё, что она не назвала
             * явно, при сохранении пропадает. `since` не назывался — и правка
             * названия стирала дату заведения. Следом возвращались пропуски за
             * то время, когда препарата ещё не было.
             */
            taken: курс?.taken,
            history: курс?.history,
            foldedUntil: курс?.foldedUntil,
            since: курс?.since,
          }
        : null

      await onSave(коробка, следующий)
    } catch (caught) {
      // Без этого отказ уходил в никуда: форма оставалась открытой со всеми
      // полями, ошибка не показывалась, и человек либо жал ещё раз, либо
      // уходил в уверенности, что препарат заведён. Хранилище отказывает
      // редко, но именно поэтому такой отказ и нельзя оставлять беззвучным.
      setError(
        'Не удалось сохранить: телефон отказал в записи. Проверьте, есть ли свободное место, и повторите. ' +
          (caught instanceof Error ? caught.message : ''),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="stack" style={{ gap: 'var(--space-4)' }}>
      {/* Кнопки закреплены сверху. Форма препарата — самый длинный экран
          приложения: расписание, ритм, схема доз, сроки, примечание. Внизу
          «Сохранить» приходилось искать прокруткой, а на полпути человек не
          знал, записано уже или нет.

          Липкая полоса, а не просто первый блок: при прокрутке она остаётся
          под шапкой приложения (`z-index` ниже её двадцати, иначе накрыла бы
          название). */}
      <div className="row form-actions--top">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          Сохранить
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Отмена
        </button>
      </div>
      {/* Форма спрашивается до поиска: в реестре больше двух тысяч написаний
          формы, и без сужения «капли» найдутся вперемешку с ампулами и
          таблетками.

          Когда препарат уже выбран, реестр знает его настоящие формы — и
          предлагать остальные незачем: «Конкор» не выпускают мазью. Пока не
          выбран, показываем все восемь. */}
      <div>
        <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
          Форма выпуска
        </div>
        <div className="chips" role="group" aria-label="Форма выпуска">
          {доступныеГруппы.map((item) => (
            <button
              key={item.key}
              type="button"
              className="chip"
              aria-pressed={group === item.key}
              onClick={() => setGroup(group === item.key ? '' : item.key)}
            >
              {item.title}
            </button>
          ))}
        </div>
      </div>

      {/* Владелец — первым полем и только когда людей больше одного. Ошибиться
          человеком легко, а найти ошибку потом трудно: коробка просто исчезает
          из аптечки того, кто её ищет. */}
      {people.length > 1 && (
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
            Чей препарат
          </div>
          <div className="segmented segmented--fill segmented--chips" role="group" aria-label="Чей препарат">
            {/* `type="button"` обязателен: кнопка внутри формы без него —
                отправка, и нажатие на имя человека сохраняло и закрывало
                форму вместо того, чтобы выбрать владельца. */}
            {people.map((person, index) => (
              <button
                key={person.id}
                type="button"
                aria-pressed={owner === person.id}
                onClick={() => setOwner(person.id)}
              >
                {person.name || `Человек ${index + 1}`}
              </button>
            ))}
          </div>
        </div>
      )}

      <DrugPicker
        group={group}
        value={name}
        onBook={(book) => {
          const найдено = name.trim()
            ? book.items.find((item) => normalize(item.n) === normalize(name))
            : undefined

          // Формы этого препарата — когда справочник доехал. Без этого выбор
          // формы списком работал бы только у коробки, которую заводят прямо
          // сейчас: варианты приходят из подсказки при выборе названия. А
          // правят чаще уже заведённые, и там список был бы всегда пуст.
          if (найдено && variants.length === 0) setVariants(variantsOf(найдено, book.forms))

          // Признак рецептурности появился позже коробок: у заведённых раньше
          // его нет, и без этого фича осталась бы невидимой для всех, кто уже
          // пользуется приложением. Подставляем один раз, когда справочник
          // доехал, и только если человек ничего не выбирал сам.
          if (medicine?.rx !== undefined || rxTouched.current) return
          if (найдено) setRx(найдено.r === 1)
        }}
        onChange={(next) => {
          setName(next)
          // Правка названия руками отвязывает карточку от реестра: варианты
          // могли относиться к другому препарату. Сами поля не трогаем —
          // теперь они видимые и заполнены человеком либо справочником, и
          // стирать их за спиной нельзя: опечатку в названии правят чаще, чем
          // меняют сам препарат.
          setKind(undefined)
          setVariants([])
          setPacks([])
        }}
        onPick={(drug: Drug, picked: DrugVariant[], drugMakers: string[]) => {
          setName(drug.n)
          setInn(drug.i ?? '')
          // Из реестра, но правится руками: пометка относится к форме выпуска,
          // а не к конкретной пачке в тумбочке.
          rxTouched.current = true
          setRx(drug.r === 1)
          setVariants(picked)
          setMaker(drugMakers[0] ?? '')
          setKind(drug.k)
          // Категорию предлагаем только в пустое поле: своё название полки
          // дороже подсказанного.
          setPurpose((было) => было || (suggestPurpose({ name: drug.n, inn: drug.i }) ?? ''))
          // Форма одна — выбирать не из чего, ставим молча. Заодно подставляем
          // единственную дозировку: спрашивать про выбор из одного незачем.
          // При выбранной группе подставляем форму из неё: человек уже сказал,
          // что ищет мазь, спрашивать его о том же второй раз незачем.
          const inGroup = group ? picked.filter((v) => formGroupOf(v.form) === group) : picked
          const only = inGroup.length === 1 ? inGroup[0] : picked.length === 1 ? picked[0] : null
          setForm(only?.form ?? '')
          setPacks(only?.packs ?? [])
          if (only?.doses.length === 1) setDose(only.doses[0])
        }}
      />

      <VariantPicker
        variants={variants}
        form={form}
        dose={dose}
        onForm={(next) => {
          setForm(next)
          // Дозировка от прежней формы к новой не относится: «5 %» у геля и
          // «200 мг» у капсул — разные величины. Упаковки тоже свои.
          setDose('')
          setPacks(variants.find((v) => v.form === next)?.packs ?? [])
        }}
        onDose={setDose}
      />

      <Field label="Дозировка, как на упаковке">
        <input value={dose} onChange={(e) => setDose(e.target.value)} placeholder="50 мг" />
      </Field>

      {/* Форма, вещество и производитель — обычные поля, а не подписи.
          Подписью они были потому, что приходили из справочника; но справочник
          знает не всё, и препарат, заведённый руками или привезённый из-за
          границы, оставался без формы навсегда: в правке этих строк просто не
          было. Чипы из справочника выше никуда не делись — они заполняют поле,
          а не заменяют его. */}
      {/* Из реестра — списком, иначе полем. Списка «все формы» здесь нет
          намеренно: в справочнике их 2301 написание, и выбирать из них на
          телефоне нельзя. Реестр знает формы этого препарата, а для того, чего
          в реестре нет, честный ответ — своя формулировка. */}
      {/* Не «Форма выпуска»: так уже названы чипы в начале формы, и две разные
          вещи с одной подписью на одном экране человек читает как одну — выбрал
          наверху «Таблетки», доскроллил до пустого поля и решил, что не
          сохранилось. Наверху — грубая группа для поиска, здесь — точное
          написание из реестра. */}
      <Field label="Как написано на упаковке">
        {формыПрепарата.length > 0 && !своя ? (
          <MenuButton
            className="btn btn--wide"
            title={form || 'Выбрать форму'}
            label="Форма выпуска"
            options={[
              ...формыПрепарата.map((f) => ({ id: f, title: f })),
              { id: СВОЯ_ФОРМА, title: 'Своя формулировка', apart: true },
            ]}
            onPick={(id) => {
              if (id === СВОЯ_ФОРМА) {
                setСвоя(true)
                return
              }
              setForm(id)
              setPacks(variants.find((v) => v.form === id)?.packs ?? [])
            }}
          />
        ) : (
          <input value={form} onChange={(e) => setForm(e.target.value)} placeholder="Таблетки" />
        )}
      </Field>

      <div className="grid grid--two">
        <Field label={substanceLabel(kind)}>
          <input value={inn} onChange={(e) => setInn(e.target.value)} placeholder="Бисопролол" />
        </Field>
        <Field label="Производитель">
          <input value={maker} onChange={(e) => setMaker(e.target.value)} placeholder="не указан" />
        </Field>
      </div>

      <div>
        <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
          Сколько в упаковке
        </div>
        {packs.length > 0 && (
          <div className="chips" role="group" aria-label="Размеры упаковки из реестра">
            {packs.map((size) => (
              <button
                key={size}
                type="button"
                className="chip"
                aria-pressed={Number(packSize) === size}
                onClick={() => setPackSize(String(size))}
              >
                {size} {единицы.pack}
              </button>
            ))}
          </div>
        )}
        {/* Ширина в `rem`, а не в точках: на «Очень крупном» поле в 170 точек
            не росло вместе с текстом, и число в нём жалось к краям. */}
        <div style={{ maxWidth: '11rem', marginTop: packs.length > 0 ? 'var(--space-3)' : 0 }}>
          <NumberField
            label={единицы.packLabel}
            value={packSize}
            onChange={setPackSize}
            min={1}
            max={500}
            start={30}
            /* Пустая коробка между «−» и «+» выглядит поломкой: у соседних
               полей число стоит, у этого нет. Подсказка говорит, чего ждут. */
            placeholder="30"
            size="compact"
          />
        </div>

        {/* Сколько капель в миллилитре — вопрос только к каплям и только
            потому, что без него нельзя списать флакон: две капли это не
            «минус два», а минус одна двадцатая миллилитра. Постоянной это
            число не является — у масляных капля мельче, — поэтому оно поле, а
            рядом сказано, где посмотреть настоящее. */}
        {needsDropSize({ form }) && (
          <div className="row" style={{ marginTop: 'var(--space-3)', alignItems: 'flex-end' }}>
            <div style={{ maxWidth: 190 }}>
              <NumberField
                label="Капель в 1 мл"
                value={dropsPerMl}
                onChange={setDropsPerMl}
                min={1}
                max={100}
                start={DROPS_PER_ML}
                size="compact"
              />
            </div>
            <div className="muted" style={{ flex: '1 1 12rem', minWidth: 0 }}>
              Обычно 20, у масляных капель бывает 30–40 — точное число печатают в инструкции.
              {капельВоФлаконе !== null && <> Во флаконе выйдет около {капельВоФлаконе} капель.</>}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid--two">
        {/* Единица рядом с числом: «10» у флакона капель это миллилитры, а у
            пачки таблеток штуки, и по самому полю не догадаться. */}
        <NumberField
          label="Осталось"
          value={left}
          onChange={setLeft}
          placeholder="30"
          min={0}
          max={999}
          start={30}
          unit={единицы.pack}
          size="compact"
        />
        <NumberField
          label="В день"
          value={perDay}
          onChange={setPerDay}
          placeholder="1"
          min={0.5}
          max={12}
          start={1}
          step={0.5}
          decimals={1}
          size="compact"
        />
      </div>

      <div>
        <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
          Когда принимать
        </div>
        <TimePicker times={times} presets={presetsOf(intakeSlots)} onChange={setTimes} />
        {times.length > 0 && plan.length > 0 && (
          <div className="muted" style={{ marginTop: 'var(--space-3)' }}>
            Доза задана схемой ниже — поле «{единицы.doseLabel.toLowerCase()}» она заменяет.
          </div>
        )}

        {/* В какие дни — отдельный вопрос от «в котором часу», и стоит он
            сразу за временами: «через день по таблетке утром» читается в том
            же порядке, в каком это произносит врач. */}
        {times.length > 0 && (
          <div style={{ marginTop: 'var(--space-4)' }}>
            <RhythmPicker value={rhythm} onChange={setRhythm} now={Date.now()} />
          </div>
        )}

        {/* Конец курса — рядом с расписанием, а не в схеме доз: врач говорит
            «курс десять дней» отдельно от того, по сколько принимать. После
            последнего дня напоминания молчат, а коробка перестаёт числиться
            кончающейся — но из аптечки не пропадает. */}
        <div style={{ marginTop: 'var(--space-4)', maxWidth: 190 }}>
          <NumberField
            label={осталось !== null && осталось > 0 ? 'Осталось дней' : 'Курс, дней'}
            value={длина}
            onChange={setДлина}
            min={1}
            max={365}
            start={10}
            placeholder="—"
          />
        </div>
        <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
          {endsAt === null
            ? 'Пусто — курс без конца: напоминания не перестанут приходить.'
            : законченный && длина.trim() === ''
              ? `Курс окончен ${formatDay(endsAt)}. Впишите число дней, чтобы начать заново.`
              : `Последний день — ${formatDay(endsAt)}. Потом напоминания молчат.`}
        </div>

        {times.length > 0 && plan.length === 0 && (
          <div className="row" style={{ marginTop: 'var(--space-3)', alignItems: 'flex-end' }}>
            <div style={{ maxWidth: 150 }}>
              <NumberField
                label={единицы.doseLabel}
                value={perTime}
                onChange={setPerTime}
                min={1}
                max={10}
                start={1}
                size="compact"
              />
            </div>
            <div style={{ flex: '1 1 12rem', minWidth: 0 }}>
              {/* Подпись обязательна. Три кнопки без неё стояли рядом с «штук
                  за приём», и было непонятно ни что они значат, ни что даст
                  выбор. «Условия приёма» — потому что еда здесь не
                  единственное возможное условие, а первое из них. */}
              <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
                Условия приёма
              </div>
              <div className="segmented" role="group" aria-label="Условия приёма">
                {MEALS.map(({ key, title }) => (
                  <button
                    key={title}
                    type="button"
                    aria-pressed={meal === key || (key === undefined && !meal)}
                    onClick={() => setMeal(key)}
                  >
                    {title}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {times.length > 0 && meal && (
          // Что человек получит за этот выбор — прямым текстом. Иначе кнопка
          // нажата, а результат всплывает через сутки в уведомлении, и связать
          // одно с другим уже нечем.
          <div className="muted">
            «{meal === 'before' ? 'до еды' : 'после еды'}» будет приписано в напоминании, на экране приёма и в отчёте
            врачу.
          </div>
        )}
      </div>

      {times.length > 0 && (
        <details open={plan.length > 0}>
          <summary>Доза меняется — наращивание или отмена</summary>
          <div className="stack" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
            {plan.length === 0 ? (
              <div className="muted">
                Например: неделю по половине, потом по целой. Или наоборот — при отмене.
              </div>
            ) : (
              plan.map((этап, i) => (
                <div className="slotrow" key={i}>
                  <Field label={`Этап ${i + 1}: ${единицы.doseLabel.toLowerCase()}`}>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.5"
                      min="0"
                      max="10"
                      value={String(этап.perTime)}
                      onChange={(e) =>
                        setPlan(plan.map((x, j) => (j === i ? { ...x, perTime: Number(e.target.value) || 0 } : x)))
                      }
                    />
                  </Field>
                  <Field label={этап.days === null ? 'дальше так же' : 'дней'}>
                    <input
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="365"
                      // Пустое поле у последнего этапа значит «дальше так же»:
                      // схема наращивания заканчивается поддерживающей дозой.
                      value={этап.days === null ? '' : String(этап.days)}
                      placeholder="без конца"
                      onChange={(e) =>
                        setPlan(
                          plan.map((x, j) =>
                            j === i ? { ...x, days: e.target.value === '' ? null : Number(e.target.value) || 1 } : x,
                          ),
                        )
                      }
                    />
                  </Field>
                  <button type="button" className="btn btn--sm" onClick={() => setPlan(plan.filter((_, j) => j !== i))}>
                    Убрать
                  </button>
                </div>
              ))
            )}
            <div className="row">
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setPlan([...plan, { perTime: plan.length ? plan[plan.length - 1].perTime : 0.5, days: 7 }])}
              >
                Добавить этап
              </button>
            </div>
            {plan.length > 0 && (
              <div className="muted">
                {plan[plan.length - 1].days === null
                  ? 'Последний этап без срока — приём продолжается с этой дозой.'
                  : 'У последнего этапа указан срок: когда он выйдет, приём закончится.'}
              </div>
            )}
          </div>
        </details>
      )}

      {(times.length > 0 || left.trim() !== '') && (
        <div>
          <label className="badge">
            <input type="checkbox" checked={autoDeduct} onChange={(e) => setAutoDeduct(e.target.checked)} />
            Списывать без подтверждения
          </label>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            {autoDeduct
              ? 'Остаток уменьшается сам по расписанию. Отмечать приём не нужно — кнопка «Принял» пропадёт.'
              : 'Остаток уменьшается только по кнопке «Принял». Включите, если отмечать каждый приём не хочется.'}
          </p>
        </div>
      )}

      <div>
        <label className="badge">
          <input
            type="checkbox"
            checked={rx}
            onChange={(e) => {
              rxTouched.current = true
              setRx(e.target.checked)
            }}
          />
          Отпускают по рецепту
        </label>
        <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
          {rx
            ? 'Напомним за две недели, а не за одну: сначала попасть к врачу, и только потом в аптеку.'
            : 'Напомним за неделю до конца запаса.'}
        </p>
      </div>

      <Field label="Годен до — месяц с упаковки">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </Field>

      {/* Необязательное поле, и спрашивается месяцем, а не днём: день начала
          приёма человек не помнит, а спрашивать то, чего не помнят, — верный
          способ получить выдуманное число. Отвечает на вопрос врача «как
          давно принимаете», на который дневник иначе ответить не может: он
          знает только, когда завели карточку. */}
      <Field label="Принимаю с">
        <input type="month" value={startedMonth} onChange={(e) => setStartedMonth(e.target.value)} />
      </Field>

      {/* Полка в шкафу, а не диагноз: «мы держим это от давления», а не «вам
          показано при гипертонии». Поле свободное — люди называют полки своими
          словами («мамино», «в дорогу»), — а чипы рядом снимают набор текста с
          девяти случаев из десяти.

          Чипы, а не выпадающий список: `datalist` в Android WebView ведёт себя
          по-разному от версии к версии, а пожилому человеку попасть пальцем в
          кнопку проще, чем в строку системного списка. Тот же приём, что у
          формы выпуска и у выбора человека выше. */}
      <Field label="Для чего">
        <input
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="или своими словами"
          autoComplete="off"
        />
      </Field>
      <div className="segmented segmented--chips purpose-hints" role="group" aria-label="Для чего">
        {PURPOSE_HINTS.map((hint) => (
          <button
            key={hint}
            type="button"
            aria-pressed={normalize(purpose) === normalize(hint)}
            // Повторное нажатие снимает выбор: ткнули не туда — поправили тем
            // же движением, не стирая текст руками.
            onClick={() => setPurpose((было) => (normalize(было) === normalize(hint) ? '' : hint))}
          >
            {hint}
          </button>
        ))}
      </div>

      <Field label="Примечание">
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="утром, после еды" />
      </Field>

      {error && (
        <div className="pill__alert pill__alert--critical" role="alert">
          {error}
        </div>
      )}
    </form>
  )
}
