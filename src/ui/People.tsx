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
import type { IntakeSlot, Measurement, Medicine, Person, Settings as SettingsData } from '../types'
import {
  freeDeviceUsers,
  intakeSlotsOf,
  MAX_PEOPLE,
  newPersonId,
  newSlotId,
  ownerOf,
  readingOwnerId,
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
  medicines,
  measurements,
  onChange,
  onMerge,
  onBack,
}: {
  person: Person
  settings: SettingsData
  /** Нужны, чтобы сказать при удалении, что станет с его коробками. */
  medicines: Medicine[]
  /** Нужны, чтобы показать до объединения, сколько записей перейдёт. */
  measurements: Measurement[]
  onChange: (next: Partial<SettingsData>) => void
  /** Объединить: записи и коробки перейдут к выжившему, лишний уйдёт. */
  onMerge: (loser: string, winner: string) => Promise<void>
  onBack: () => void
}) {
  const [удаляем, setУдаляем] = useState(false)
  /** С кем объединяем. Пусто — выбор ещё не сделан. */
  const [сливаемС, setСливаемС] = useState<string | null>(null)
  /** Кто остаётся главным. */
  const [главный, setГлавный] = useState<string>(person.id)
  const [занято, setЗанято] = useState(false)
  const { people } = settings
  const его = medicines.filter((m) => ownerOf(m, people) === person.id)
  const последний = people.length === 1

  /** Сколько записей числится за человеком — считаем так же, как их ищет экран. */
  const записейУ = (id: string) => {
    const кто = people.find((p) => p.id === id)
    return measurements.filter((m) => (m.person ? m.person === id : кто?.deviceUser != null && m.user === кто.deviceUser))
      .length
  }
  const коробокУ = (id: string) => medicines.filter((m) => ownerOf(m, people) === id).length
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
    if (различает((x) => коробокУ(x.id)))
      return `${своё} (${коробокУ(p.id)} ${plural(коробокУ(p.id), 'коробка', 'коробки', 'коробок')})`
    return `${своё} (№ ${people.findIndex((x) => x.id === p.id) + 1} в списке)`
  }

  /**
   * Кто из двоих главнее по умолчанию.
   *
   * Одних записей мало: у тёзок на настоящем дневнике их поровну — оба сидят
   * на первой кнопке прибора и видят одни и те же. Тогда решают коробки, а
   * если и их поровну — тот, чей дневник открыт. Иначе главным по умолчанию
   * вставал бы пустой, и владельцу пришлось бы это заметить.
   */
  const весомее = (a: Person, b: Person) => {
    const вес = (p: Person) => [записейУ(p.id), коробокУ(p.id), p.id === settings.activePerson ? 1 : 0]
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
              Кнопки приёма
            </div>
            <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
              Подставляются в форме препарата.
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
              <ul className="pills">
                {другие.map((p) => (
                  <NavRow
                    key={p.id}
                    title={имя(p)}
                    value={`${записейУ(p.id)} ${plural(записейУ(p.id), 'измерение', 'измерения', 'измерений')}, ${коробокУ(p.id)} ${plural(коробокУ(p.id), 'коробка', 'коробки', 'коробок')}`}
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

              <Banner tone="warning">
                <b>Останется {имя(выживший)}</b>
                <div style={{ marginTop: 4 }}>
                  Перейдёт записей: {записейУ(проигравший!.id)}, коробок: {коробокУ(проигравший!.id)}.
                  {выживший!.deviceUser && проигравший!.deviceUser && выживший!.deviceUser !== проигравший!.deviceUser && (
                    <> Кнопка прибора останется {выживший!.deviceUser}, кнопка {проигравший!.deviceUser} освободится.</>
                  )}{' '}
                  Записи, которые придут с других телефонов на имя {имя(проигравший)}, тоже будут ложиться{' '}
                  {имя(выживший)}. <b>Отменить это нельзя.</b>
                </div>
                {теряют.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    Сейчас записи с прибора показываются ещё{' '}
                    {теряют.length === 1 ? 'в одной карточке' : `в ${теряют.length} карточках`} с той же кнопкой —{' '}
                    {теряют.map(имя).join(', ')}. После объединения они закрепятся за {имя(выживший)} и оттуда
                    пропадут.
                  </div>
                )}
              </Banner>

              <div className="row row--stack" style={{ marginTop: 'var(--space-3)' }}>
                <button className="btn" onClick={() => setСливаемС(null)} disabled={занято}>
                  Отмена
                </button>
                <button
                  className="btn btn--primary"
                  disabled={занято}
                  onClick={async () => {
                    setЗанято(true)
                    try {
                      await onMerge(проигравший!.id, выживший!.id)
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
                    В аптечке останется {его.length}{' '}
                    {plural(его.length, 'препарат', 'препарата', 'препаратов')} без владельца — они перейдут первому
                    человеку в списке. Измерения давления не тронутся.
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
                  onClick={() => {
                    const остальные = people.filter((p) => p.id !== person.id)
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
          <h2>Пользователи</h2>
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
/** Ключ варианта «все сразу»: людям такой идентификатор не выдаётся. */
const ВСЕ = '\u0000все'

export function PersonSwitch({
  settings,
  onChange,
  extra,
}: {
  settings: SettingsData
  onChange: (next: Partial<SettingsData>) => void
  /**
   * Лишний выбор рядом с людьми — «Все» в аптечке.
   *
   * Он живёт здесь, а не отдельной полосой внутри экрана. Отдельная полоса уже
   * была и оказалась дефектом: на «Аптечке» стояли два одинаковых ряда имён,
   * верхний ничего не менял, а нижний молча уводил в пустой экран. Вопрос
   * «чей это список» на экране один, и кнопка к нему тоже должна быть одна.
   */
  extra?: { title: string; active: boolean; onPick: (active: boolean) => void }
}) {
  // Один человек — выбирать не из кого, и «Все» вместе с ним теряет смысл.
  if (settings.people.length <= 1) return null

  const варианты = [
    ...settings.people.map((person, index) => ({
      id: person.id,
      title: person.name || `Человек ${index + 1}`,
    })),
    // «Все» — не пятый человек, поэтому отделено чертой.
    ...(extra ? [{ id: ВСЕ, title: extra.title, apart: true }] : []),
  ]
  return (
    <div className="personbar no-print" data-tour="person">
      <FilterButton
        label="Чей дневник"
        selected={extra?.active ? ВСЕ : settings.activePerson}
        options={варианты}
        onPick={(id) => {
          if (id === ВСЕ) {
            extra?.onPick(true)
            return
          }
          onChange({ activePerson: id })
          // Выбрали человека — «все» больше не выбрано: иначе на кнопке стояло
          // бы одно, а на экране лежало другое.
          extra?.onPick(false)
        }}
      />
    </div>
  )
}
