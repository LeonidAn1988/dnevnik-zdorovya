/**
 * Люди в дневнике: кого ведём и у кого какая кнопка на приборе.
 *
 * Отдельная сущность появилась потому, что прежние «Пользователь 1» и
 * «Пользователь 2» — это две кнопки на корпусе тонометра, а не два человека в
 * семье. Людей может быть четверо, у ребёнка прибора нет вовсе, и лекарства у
 * него всё равно свои.
 *
 * Список и человек — два экрана, а не одна длинная карточка: у каждого есть имя,
 * кнопка прибора, часы приёма и удаление, и вчетвером это было четыре
 * одинаковых блока подряд, в которых легко удалить не того.
 */

import { useState } from 'react'
import type { IntakeSlot, LabTest, Measurement, Regimen, Person, Settings as SettingsData } from '../types'
import {
  freeDeviceUsers,
  intakeSlotsOf,
  MAX_PEOPLE,
  newPersonId,
  newSlotId,
  readingOwnerId,
  regimensOfPerson,
  setIntakeSlots,
} from '../logic/people'
import { describePerson } from '../logic/settings'
import { plural } from '../logic/plural'
import { BackBar, Banner, Field, NavRow } from './bits'
import { FilterButton } from './Picker'

/** Кнопка пользователя на приборе: своя, чужая занятая или никакой. */
function DeviceMemory({
  person,
  people,
  onChange,
}: {
  person: Person
  people: Person[]
  onChange: (next: 1 | 2 | undefined) => void
}) {
  const свободные = freeDeviceUsers(people, person.id)

  return (
    <div>
      <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
        Кнопка пользователя на тонометре
      </div>
      <div className="segmented segmented--fill" role="group" aria-label={`Кнопка на тонометре, ${person.name}`}>
        <button aria-pressed={person.deviceUser === undefined} onClick={() => onChange(undefined)}>
          Нет
        </button>
        {([1, 2] as const).map((memory) => (
          <button
            key={memory}
            aria-pressed={person.deviceUser === memory}
            // Занятую другим кнопку не отдаём: два человека на одной памяти —
            // это один дневник давления на двоих, где не разобрать, чьё
            // измерение, и разобрать потом уже нельзя.
            disabled={!свободные.includes(memory)}
            onClick={() => onChange(memory)}
          >
            {memory}
          </button>
        ))}
      </div>
      <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
        {person.deviceUser === undefined
          ? 'Дневник давления будет пустым — прибор помнит только двоих.'
          : 'Измерение ложится тому, чья кнопка нажата на приборе.'}
      </div>
    </div>
  )
}

/** Экран одного человека: имя, кнопка прибора, часы приёма, удаление. */
export function PersonScreen({
  person,
  settings,
  regimens,
  labs,
  familyOutdated,
  measurements,
  onChange,
  onMerge,
  onDelete,
  onBack,
}: {
  person: Person
  settings: SettingsData
  /** Нужны, чтобы сказать при удалении, что станет с его курсами приёма. */
  regimens: Regimen[]
  /** Нужны, чтобы перед объединением назвать и анализы: они переезжают вместе
      со снимками бланков, а снимки в копию дневника не идут. */
  labs: LabTest[]
  /** Сколько телефонов семьи прислали файл сборки, не знающей про курсы. */
  familyOutdated: number
  /** Нужны, чтобы показать до объединения, сколько записей перейдёт. */
  measurements: Measurement[]
  onChange: (next: Partial<SettingsData>) => void
  /**
   * Объединить: курсы, анализы и лишний человек уходят к выжившему.
   *
   * `dropMeasurements` — стереть измерения проигравшего вместо переноса.
   * Нужно, когда прибор давали проверить и замеры легли на лишнего человека:
   * переносить их к себе значит испортить свою историю чужими числами.
   */
  onMerge: (loser: string, winner: string, dropMeasurements?: boolean) => Promise<void>
  /** Перенести курсы удаляемого человека тому, кто останется первым. */
  onDelete: (who: string, to: string) => Promise<void>
  onBack: () => void
}) {
  const [удаляем, setУдаляем] = useState(false)
  /** Стереть записи проигравшего вместо переноса. По умолчанию — переносим. */
  const [стеретьЗаписи, setСтеретьЗаписи] = useState(false)
  /** С кем объединяем. Пусто — выбор ещё не сделан. */
  const [сливаемС, setСливаемС] = useState<string | null>(null)
  /** Кто остаётся главным. */
  const [главный, setГлавный] = useState<string>(person.id)
  const [занято, setЗанято] = useState(false)
  const { people } = settings
  const его = regimensOfPerson(regimens, person.id)
  const последний = people.length === 1

  /** Сколько записей числится за человеком — считаем так же, как их ищет экран. */
  const записейУ = (id: string) => {
    const кто = people.find((p) => p.id === id)
    return measurements.filter((m) => (m.person ? m.person === id : кто?.deviceUser != null && m.user === кто.deviceUser))
      .length
  }
  /** Курсов приёма у человека. Коробки с 0.27.0 ничьи и в счёт не идут. */
  const курсовУ = (id: string) => regimensOfPerson(regimens, id).length
  const анализовУ = (id: string) => labs.filter((t) => t.owner === id).length
  const другие = people.filter((p) => p.id !== person.id)
  const второй = сливаемС ? people.find((p) => p.id === сливаемС) : null
  const проигравший = второй && (главный === person.id ? второй : person)
  const выживший = второй && (главный === person.id ? person : второй)
  /**
   * Имя, по которому человека можно отличить.
   *
   * Ровно тот случай, ради которого всё и делается: у владельца в списке двое
   * «Я», и предупреждение «Останется Я, записи на имя Я будут ложиться Я»
   * бессмысленно.
   *
   * Кнопкой прибора различать можно не всегда: до 0.25.0 каждый запуск заводил
   * нового «Я» с той же кнопкой, и в настоящем дневнике оба «Я» сидят на
   * первой. Поэтому черта берётся только та, которая у тёзки одна такая, а
   * если не различает ни одна — номер строки в списке. Он различает всегда.
   */
  const имя = (p: Person | null | undefined) => {
    if (!p) return 'без имени'
    const своё = p.name.trim() || 'без имени'
    const тёзки = people.filter((другой) => (другой.name.trim() || 'без имени') === своё)
    if (тёзки.length < 2) return своё
    const различает = (черта: (x: Person) => unknown) => тёзки.filter((x) => черта(x) === черта(p)).length === 1
    if (p.deviceUser && различает((x) => x.deviceUser)) return `${своё} (кнопка ${p.deviceUser})`
    if (различает((x) => записейУ(x.id)))
      return `${своё} (${записейУ(p.id)} ${plural(записейУ(p.id), 'запись', 'записи', 'записей')})`
    if (различает((x) => курсовУ(x.id)))
      return `${своё} (${курсовУ(p.id)} ${plural(курсовУ(p.id), 'курс приёма', 'курса приёма', 'курсов приёма')})`
    return `${своё} (№ ${people.findIndex((x) => x.id === p.id) + 1} в списке)`
  }

  /**
   * Кто из двоих главнее по умолчанию.
   *
   * Одних записей мало: у тёзок на настоящем дневнике их поровну — оба сидят
   * на первой кнопке прибора и видят одни и те же. Тогда решают курсы приёма, а
   * если и их поровну — тот, чей дневник открыт. Иначе главным по умолчанию
   * вставал бы пустой, и владельцу пришлось бы это заметить.
   */
  const весомее = (a: Person, b: Person) => {
    const вес = (p: Person) => [записейУ(p.id), курсовУ(p.id), p.id === settings.activePerson ? 1 : 0]
    const [x, y] = [вес(a), вес(b)]
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] > y[i] ? a : b
    return b
  }

  /**
   * Кто ещё сейчас показывает записи без пометки, которые уедут выжившему.
   *
   * Экран измерений отдаёт запись без пометки каждому, кто сидит на её кнопке
   * прибора, а после объединения она закрепляется за человеком явно. Для
   * третьего с той же кнопкой это значит, что записи из его списка пропадут —
   * и знать об этом надо до нажатия, а не после.
   */
  const теряют = (() => {
    if (!выживший || !проигравший) return []
    const кнопки = new Set(
      measurements
        .filter((m) => !m.person)
        .filter((m) => {
          const чей = readingOwnerId(people, m)
          return чей === выживший.id || чей === проигравший.id
        })
        .map((m) => m.user),
    )
    return people.filter(
      (p) => p.id !== выживший.id && p.id !== проигравший.id && p.deviceUser != null && кнопки.has(p.deviceUser),
    )
  })()

  const заменить = (fields: Partial<Person>) =>
    onChange({ people: people.map((p) => (p.id === person.id ? { ...p, ...fields } : p)) })

  const приёмы = intakeSlotsOf(person, settings)
  const заменитьПриём = (index: number, fields: Partial<IntakeSlot>) =>
    onChange(setIntakeSlots(settings, person.id, приёмы.map((slot, i) => (i === index ? { ...slot, ...fields } : slot))))
  const добавитьПриём = () => {
    const now = Date.now()
    // Время новой кнопки — через три часа после последней: подставлять полночь
    // значит заставить человека крутить барабан от нуля.
    const последняя = приёмы[приёмы.length - 1]?.time ?? '08:00'
    const [ч, м] = последняя.split(':').map(Number)
    const дальше = `${String((ч + 3) % 24).padStart(2, '0')}:${String(м || 0).padStart(2, '0')}`
    onChange(setIntakeSlots(settings, person.id, [...приёмы, { id: newSlotId(now), title: `В ${дальше}`, time: дальше }]))
  }

  return (
    <div className="stack">
      <BackBar onBack={onBack} />

      <div className="card">
        <div className="card__head">
          <h2>{person.name.trim() || 'Человек'}</h2>
        </div>

        <div className="stack" style={{ gap: 'var(--space-5)' }}>
          <div>
            <Field label="Имя">
              <input
                value={person.name}
                placeholder="как называть в дневнике"
                onChange={(event) => заменить({ name: event.target.value })}
              />
            </Field>
            <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
              Попадёт в отчёт для врача.
            </div>
          </div>

          <DeviceMemory person={person} people={people} onChange={(next) => заменить({ deviceUser: next })} />

          <div>
            <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
              Часы приёма
            </div>
            <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
              Эти часы предложим, когда будете задавать расписание в аптечке.
            </div>

            <div className="stack" style={{ gap: 'var(--space-4)' }}>
              {приёмы.map((slot, index) => (
                <div className="slotrow" key={slot.id}>
                  <Field label="Название">
                    <input
                      value={slot.title}
                      placeholder="Утром"
                      onChange={(e) => заменитьПриём(index, { title: e.target.value })}
                    />
                  </Field>
                  <Field label="Время">
                    <input
                      type="time"
                      value={slot.time}
                      onChange={(e) => заменитьПриём(index, { time: e.target.value || slot.time })}
                    />
                  </Field>
                  <button
                    className="btn btn--sm"
                    // Последнюю не убираем: без кнопок форма препарата теряет
                    // быстрый ввод времени вовсе, а вернуть их будет негде.
                    disabled={приёмы.length <= 1}
                    onClick={() => onChange(setIntakeSlots(settings, person.id, приёмы.filter((_, i) => i !== index)))}
                  >
                    Убрать
                  </button>
                </div>
              ))}
            </div>

            <div className="row" style={{ marginTop: 'var(--space-4)' }}>
              <button className="btn" onClick={добавитьПриём}>
                Добавить кнопку
              </button>
            </div>

          </div>
        </div>
      </div>

      {/* Объединение — выше удаления и не в красной рамке: это склейка, а не
          снос. Понадобилось оно после того, как приложение само наплодило
          двоих «Я» (починено в 0.25.0), и удалением такое не лечится: записи
          удалённого исчезают отовсюду, потому что искать их по человеку уже
          нечем, а по кнопке прибора — только те, у кого нет пометки. */}
      {другие.length > 0 && (
        <div className="card">
          <div className="card__head">
            <h2>Объединить с другим человеком</h2>
          </div>
          {!сливаемС ? (
            <>
              <p className="muted">
                Если это один и тот же человек, записи и коробки можно свести вместе. Выберите, с кем.
              </p>
              {/* Предупреждение, а не запрет: приложение не вправе запрещать —
                  оно обязано сказать. Объединение необратимо, а телефон со
                  старой сборкой будет и дальше присылать записи на имя,
                  которого в дневнике уже нет. */}
              {familyOutdated > 0 && (
                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <Banner tone="warning">
                    <b>Сначала обновите остальные телефоны</b>
                    <div style={{ marginTop: 4 }}>
                      {familyOutdated === 1
                        ? 'Один телефон семьи прислал файл старой версии. '
                        : `${familyOutdated} телефона семьи прислали файлы старой версии. `}
                      После объединения он будет присылать записи на имя, которого у вас больше не будет.
                    </div>
                  </Banner>
                </div>
              )}
              <ul className="pills">
                {другие.map((p) => (
                  <NavRow
                    key={p.id}
                    title={имя(p)}
                    value={`${записейУ(p.id)} ${plural(записейУ(p.id), 'измерение', 'измерения', 'измерений')}, ${курсовУ(p.id)} ${plural(курсовУ(p.id), 'курс приёма', 'курса приёма', 'курсов приёма')}`}
                    onOpen={() => {
                      setСливаемС(p.id)
                      setГлавный(весомее(p, person).id)
                    }}
                  />
                ))}
              </ul>
            </>
          ) : (
            <>
              <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
                Кто остаётся
              </div>
              <div className="segmented segmented--fill segmented--chips" role="group" aria-label="Кто остаётся">
                {[person, второй!].map((p) => (
                  <button key={p.id} type="button" aria-pressed={главный === p.id} onClick={() => setГлавный(p.id)}>
                    {имя(p)}
                  </button>
                ))}
              </div>

              {/* Выбор появляется только когда есть что терять. Обычно записи
                  переносят — это один и тот же человек. Но прибор дают
                  проверить, и тогда десятки чужих замеров ложатся на лишнего
                  человека: перенести их к себе — испортить свою историю, а
                  вычистить руками нечем (удаление у записи поштучное, а
                  «Удалить все измерения» сносит и чужие). */}
              {записейУ(проигравший!.id) > 0 && (
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
                    Записи {имя(проигравший)}
                  </div>
                  <div
                    className={`segmented segmented--fill segmented--chips${стеретьЗаписи ? ' segmented--danger' : ''}`}
                    role="group"
                    aria-label={`Записи ${имя(проигравший)}`}
                  >
                    <button type="button" aria-pressed={!стеретьЗаписи} onClick={() => setСтеретьЗаписи(false)}>
                      Перенести
                    </button>
                    <button type="button" aria-pressed={стеретьЗаписи} onClick={() => setСтеретьЗаписи(true)}>
                      Стереть
                    </button>
                  </div>
                </div>
              )}

              <Banner tone="warning">
                <b>Останется {имя(выживший)}</b>
                <div style={{ marginTop: 4 }}>
                  {стеретьЗаписи && записейУ(проигравший!.id) > 0 ? (
                    <>
                      <b>
                        Будет стёрто записей: {записейУ(проигравший!.id)}
                      </b>{' '}
                      — насовсем, и на других телефонах семьи тоже.
                      {' '}Курсов приёма перейдёт: {курсовУ(проигравший!.id)}
                    </>
                  ) : (
                    <>Перейдёт записей: {записейУ(проигравший!.id)}, курсов приёма: {курсовУ(проигравший!.id)}</>
                  )}
                  {/* Анализы называем отдельно и только когда они есть: у них
                      с собой снимки бланков, а снимок — единственное в
                      дневнике, чего нет в копии. Человек вправе знать, что
                      переезжает, до нажатия, а не после. */}
                  {анализовУ(проигравший!.id) > 0 && (
                    <>
                      , анализов: {анализовУ(проигравший!.id)} — вместе со снимками бланков
                    </>
                  )}
                  . Сами препараты останутся в аптечке — она общая на дом.
                  {выживший!.deviceUser && проигравший!.deviceUser && выживший!.deviceUser !== проигравший!.deviceUser && (
                    <> Кнопка прибора останется {выживший!.deviceUser}, кнопка {проигравший!.deviceUser} освободится.</>
                  )}{' '}
                  {/* Без имени выжившего в конце: по-русски оно тут требует
                      дательного падежа («достанутся Леониду»), а склонять
                      введённое человеком имя нечем — выходило «будут ложиться
                      Леонид». Имя выжившего и так стоит в заголовке плашки. */}
                  Записи, которые придут с других телефонов на имя {имя(проигравший)}, тоже будут ложиться сюда.{' '}
                  <b>Отменить это нельзя.</b>
                </div>
                {теряют.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    Сейчас записи с прибора показываются ещё{' '}
                    {теряют.length === 1 ? 'в одной карточке' : `в ${теряют.length} карточках`} с той же кнопкой —{' '}
                    {теряют.map(имя).join(', ')}.{' '}
                    {стеретьЗаписи
                      ? `После объединения часть из них будет стёрта, а остальные закрепятся за ${имя(выживший)} и из тех карточек пропадут.`
                      : `После объединения они закрепятся за ${имя(выживший)} и оттуда пропадут.`}
                  </div>
                )}
              </Banner>

              <div className="row row--stack" style={{ marginTop: 'var(--space-3)' }}>
                <button
                  className="btn"
                  onClick={() => {
                    setСливаемС(null)
                    // Опасный выбор не должен пережить «Отмену»: следующий
                    // заход в объединение начинается с безопасного переноса.
                    setСтеретьЗаписи(false)
                  }}
                  disabled={занято}
                >
                  Отмена
                </button>
                <button
                  className="btn btn--primary"
                  disabled={занято}
                  onClick={async () => {
                    setЗанято(true)
                    try {
                      await onMerge(проигравший!.id, выживший!.id, стеретьЗаписи)
                      onBack()
                    } finally {
                      setЗанято(false)
                    }
                  }}
                >
                  {занято ? 'Объединяю…' : `Объединить в ${имя(выживший)}`}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!последний && (
        <div className="card">
          {удаляем ? (
            <Banner tone="critical">
              <b>Удалить {person.name.trim() || 'человека'}?</b>
              <div style={{ marginTop: 4 }}>
                {его.length > 0 ? (
                  <>
                    {его.length} {plural(его.length, 'курс приёма', 'курса приёма', 'курсов приёма')} перейдёт первому
                    человеку в списке. Сами препараты останутся в аптечке — она общая на дом. Измерения давления не
                    тронутся.
                  </>
                ) : (
                  <>Записи не пропадут: у этого человека их нет.</>
                )}
              </div>
              <div className="row" style={{ marginTop: 'var(--space-3)' }}>
                {/* «Отмена» первой: опасное действие не должно подставляться
                    под палец там, где только что была безобидная кнопка. */}
                <button className="btn" onClick={() => setУдаляем(false)}>
                  Отмена
                </button>
                <button
                  className="btn btn--danger"
                  onClick={async () => {
                    const остальные = people.filter((p) => p.id !== person.id)
                    // Курсы переносим до удаления и явно, а не надеясь на
                    // починку при следующем запуске: окно обещает, что они
                    // перейдут первому, и обещание держит тот, кто его дал.
                    await onDelete(person.id, остальные[0].id)
                    onChange({
                      people: остальные,
                      activePerson: settings.activePerson === person.id ? остальные[0].id : settings.activePerson,
                    })
                    onBack()
                  }}
                >
                  Удалить
                </button>
              </div>
            </Banner>
          ) : (
            <div className="row">
              <button className="btn btn--danger" onClick={() => setУдаляем(true)}>
                Удалить человека
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Список людей. */
export function People({
  settings,
  onChange,
  onOpenPerson,
  onBack,
}: {
  settings: SettingsData
  onChange: (next: Partial<SettingsData>) => void
  onOpenPerson: (id: string) => void
  onBack: () => void
}) {
  const { people } = settings
  const тёзки = [
    ...new Set(
      people
        .map((p) => p.name.trim())
        .filter((имя, i, все) => имя !== '' && все.indexOf(имя) !== i),
    ),
  ]

  function добавить() {
    const id = newPersonId(Date.now())
    const свободная = freeDeviceUsers(people)[0]
    onChange({
      people: [...people, { id, name: '', deviceUser: свободная }],
      // Сразу переключаемся на нового: его заводят, чтобы им заняться, и
      // искать переключатель после этого — лишний шаг.
      activePerson: id,
    })
    onOpenPerson(id)
  }

  return (
    <div className="stack">
      <BackBar onBack={onBack} />

      <div className="card">
        <div className="card__head">
          <h2>Люди</h2>
          <span className="muted">настройки и часы приёма</span>
        </div>

        {/* Тёзки — почти всегда один и тот же человек, размноженный обменом:
            до 0.25.0 приложение заводило нового «Я» при каждом запуске. Без
            этой строки кнопку объединения не найдёт никто: она лежит внутри
            карточки человека, а зайти туда незачем. */}
        {тёзки.length > 0 && (
          <Banner tone="info">
            <b>Двое с одинаковым именем: {тёзки.join(', ')}</b>
            <div style={{ marginTop: 4 }}>
              Если это один человек, их можно объединить — откройте любого из них.
            </div>
          </Banner>
        )}

        <ul className="pills">
          {people.map((person, index) => (
            <NavRow
              key={person.id}
              title={person.name.trim() || `Человек ${index + 1}`}
              value={describePerson(person, settings.intakeTimes)}
              onOpen={() => onOpenPerson(person.id)}
            />
          ))}
        </ul>

        <div className="row" style={{ marginTop: 'var(--space-4)' }}>
          <button className="btn" onClick={добавить} disabled={people.length >= MAX_PEOPLE}>
            Добавить человека
          </button>
        </div>
        {people.length >= MAX_PEOPLE ? (
          <div className="muted" style={{ marginTop: 'var(--space-3)' }}>
            Больше {MAX_PEOPLE} человек нельзя.
          </div>
        ) : (
          people.length === 1 && (
            <div className="muted" style={{ marginTop: 'var(--space-3)' }}>
              Пока человек один, переключателя нигде нет. Он появится, как только людей станет двое.
            </div>
          )
        )}
      </div>
    </div>
  )
}

/**
 * Переключатель человека.
 *
 * Показывается, только когда людей больше одного. У того, кто ведёт дневник на
 * себя, лишнего элемента на экране не появляется — а таких большинство.
 */
export function PersonSwitch({
  settings,
  onChange,
}: {
  settings: SettingsData
  onChange: (next: Partial<SettingsData>) => void
}) {
  // Один человек — выбирать не из кого.
  if (settings.people.length <= 1) return null

  const варианты = settings.people.map((person, index) => ({
    id: person.id,
    title: person.name || `Человек ${index + 1}`,
  }))
  return (
    <div className="personbar no-print" data-tour="person">
      <FilterButton
        label="Чей дневник"
        selected={settings.activePerson}
        options={варианты}
        onPick={(id) => onChange({ activePerson: id })}
      />
    </div>
  )
}
