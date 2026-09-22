/**
 * Анализы: когда сдавать и что получилось.
 *
 * **Чего здесь нет и не будет.** Ни цвета по значению, ни стрелок, ни слов
 * «норма», «повышен», «понижен». Приложение записывает числа со слов человека и
 * напоминает сдать; сравнение с нормой и вывод из него — это медицинское
 * изделие, а не дневник (письмо Росздравнадзора 02И-297/20, `BACKLOG.md` §11).
 * Про сроки говорить можно: «сдать сегодня» — факт о списке самого человека.
 *
 * Экран один, а не список плюс карточка: анализов у человека единицы, и второй
 * уровень навигации здесь дороже, чем стоит. Форма раскрывается на месте.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LabPhoto, LabResult, LabTest, Regimen } from '../types'
import {
  DEFAULT_LAB_TIME,
  describeDue,
  describeFrozen,
  formatDay,
  formatValue,
  labsOf,
  lastResult,
  newLabId,
  newResultId,
  sortLabs,
} from '../logic/labs'
import { BackBar, Banner, Field } from './bits'
import { getLabPhotoBytes, getLabPhotos } from '../db/store'
import { platform } from '../platform/ports'
import { formatBytes } from './photo'

/** Дата в поле ввода: «2026-10-05». */
function toInput(ts: number): string {
  const d = new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Обратно в местную полночь. Не `new Date(строка)`: та читает UTC. */
function fromInput(value: string): number | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime()
}

const ПОВТОРЫ = [
  { label: 'Один раз', months: 0, days: 0 },
  { label: 'Раз в месяц', months: 1, days: 0 },
  { label: 'Раз в 3 месяца', months: 3, days: 0 },
  { label: 'Раз в полгода', months: 6, days: 0 },
  { label: 'Раз в год', months: 12, days: 0 },
] as const

function LabForm({
  test,
  regimens,
  person,
  now,
  onSave,
  onDelete,
  onCancel,
}: {
  test: LabTest | null
  regimens: Regimen[]
  person: string
  now: number
  onSave: (next: LabTest) => void
  onDelete: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(test?.name ?? '')
  const [удаляем, setУдаляем] = useState(false)
  const [unit, setUnit] = useState(test?.unit ?? '')
  const [note, setNote] = useState(test?.note ?? '')
  const [хочуСрок, setХочуСрок] = useState(!!test?.schedule)
  const [due, setDue] = useState(toInput(test?.schedule?.due ?? now))
  const [time, setTime] = useState(test?.schedule?.time ?? DEFAULT_LAB_TIME)
  const [повтор, setПовтор] = useState(() => {
    const m = test?.schedule?.everyMonths ?? 0
    return ПОВТОРЫ.findIndex((p) => p.months === m) >= 0 ? ПОВТОРЫ.findIndex((p) => p.months === m) : 0
  })
  const [курс, setКурс] = useState(test?.schedule?.afterRegimen ?? '')
  const [черезДней, setЧерезДней] = useState(String(test?.schedule?.afterDays ?? 14))
  const [ошибка, setОшибка] = useState<string | null>(null)

  // Привязать анализ можно только к курсу с концом: от бессрочного считать
  // нечего, и предлагать его значит обещать то, чего не будет.
  const скурсом = regimens.filter((r) => r.endsAt !== undefined)

  const сохранить = () => {
    if (!name.trim()) {
      setОшибка('Назовите анализ — иначе его не найти в списке')
      return
    }
    const день = fromInput(due)
    if (хочуСрок && день === null) {
      setОшибка('Проверьте дату сдачи')
      return
    }
    const next: LabTest = {
      id: test?.id ?? newLabId(now),
      name: name.trim(),
      owner: test?.owner ?? person,
      unit: unit.trim() || undefined,
      note: note.trim() || undefined,
      results: test?.results ?? [],
      schedule: хочуСрок
        ? {
            due: день as number,
            everyMonths: ПОВТОРЫ[повтор].months || undefined,
            afterRegimen: курс || undefined,
            afterDays: курс ? Math.max(0, Number(черезДней) || 0) : undefined,
            time: time || undefined,
          }
        : undefined,
    }
    onSave(next)
  }

  return (
    <div className="tile">
      <h2>{test ? 'Изменить анализ' : 'Новый анализ'}</h2>
      <Field label="Что сдаём">
        <input
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ТТГ, общий анализ крови"
          autoFocus
        />
      </Field>
      <Field label="Единица измерения — не обязательно">
        <input className="input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="мкМЕ/мл" />
      </Field>
      <Field label="Заметка — не обязательно">
        <input
          className="input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="натощак, в той же лаборатории"
        />
      </Field>

      <label className="optrow__label" style={{ marginTop: 'var(--space-4)' }}>
        <input type="checkbox" checked={хочуСрок} onChange={(e) => setХочуСрок(e.target.checked)} />
        <span>Напоминать сдать</span>
      </label>

      {хочуСрок && (
        <>
          <Field label="Когда сдавать">
            <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </Field>
          <Field label="Во сколько напомнить">
            <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>Повторять</div>
          <div className="segmented segmented--chips" role="group" aria-label="Повторять">
            {ПОВТОРЫ.map((p, i) => (
              <button key={p.label} aria-pressed={повтор === i} onClick={() => setПовтор(i)}>
                {p.label}
              </button>
            ))}
          </div>

          {скурсом.length > 0 && (
            <>
              <Field label="Или считать от конца курса приёма">
                <select className="input" value={курс} onChange={(e) => setКурс(e.target.value)}>
                  <option value="">Не привязывать</option>
                  {скурсом.map((r) => (
                    <option key={r.id} value={r.id}>
                      Курс до {formatDay(r.endsAt as number)}
                    </option>
                  ))}
                </select>
              </Field>
              {курс && (
                <Field label="Через сколько дней после курса">
                  <input
                    className="input"
                    inputMode="numeric"
                    value={черезДней}
                    onChange={(e) => setЧерезДней(e.target.value.replace(/\D/g, ''))}
                  />
                </Field>
              )}
            </>
          )}

          <div className="muted" style={{ marginTop: 'var(--space-2)' }}>
            Напомним трижды: накануне вечером, в день сдачи и через два дня, если результата нет. Дальше — молча:
            просроченный анализ видно здесь и на «Обзоре».
          </div>
        </>
      )}

      {ошибка && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Banner tone="warning">{ошибка}</Banner>
        </div>
      )}

      <div className="row row--stack" style={{ marginTop: 'var(--space-4)' }}>
        <button className="btn btn--primary" onClick={сохранить}>
          Сохранить
        </button>
        <button className="btn" onClick={onCancel}>
          Отмена
        </button>
      </div>

      {test && !удаляем && (
        <div className="row" style={{ marginTop: 'var(--space-4)' }}>
          <button className="btn btn--sm" onClick={() => setУдаляем(true)}>
            Удалить анализ
          </button>
        </div>
      )}
      {test && удаляем && (
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Banner tone="warning">
            <div>
              Удалить «{test.name}»
              {test.results.length > 0
                ? ` вместе с ${test.results.length === 1 ? 'записанным результатом' : 'записанными результатами'}?`
                : '?'}
            </div>
            <div className="row" style={{ marginTop: 'var(--space-2)' }}>
              <button className="btn btn--sm btn--danger" onClick={onDelete}>
                Удалить
              </button>
              <button className="btn btn--sm" onClick={() => setУдаляем(false)}>
                Оставить
              </button>
            </div>
          </Banner>
        </div>
      )}
    </div>
  )
}

function ResultForm({
  test,
  now,
  onSave,
  onCancel,
}: {
  test: LabTest
  now: number
  onSave: (next: LabResult) => void
  onCancel: () => void
}) {
  const [day, setDay] = useState(toInput(now))
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [ошибка, setОшибка] = useState<string | null>(null)

  const сохранить = () => {
    const день = fromInput(day)
    if (день === null) {
      setОшибка('Проверьте дату сдачи')
      return
    }
    // Запятая — то, как число набирают на русской раскладке.
    const число = Number(value.replace(',', '.'))
    const есть = value.trim() !== '' && Number.isFinite(число)
    if (!есть && !note.trim()) {
      setОшибка('Запишите число или перепишите бланк в заметку — иначе записывать нечего')
      return
    }
    onSave({
      id: newResultId(now),
      day: день,
      values: есть ? [число] : [],
      note: note.trim() || undefined,
    })
  }

  return (
    <div className="tile">
      <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>Результат: {test.name}</div>
      <Field label="Когда сдали">
        <input className="input" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </Field>
      <Field label={test.unit ? `Число, ${test.unit}` : 'Число'}>
        <input
          className="input"
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="2,1"
          autoFocus
        />
      </Field>
      <Field label="Из бланка — своими словами">
        <textarea
          className="input"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Гемоглобин 138, лейкоциты 6,2…"
        />
      </Field>
      {ошибка && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <Banner tone="warning">{ошибка}</Banner>
        </div>
      )}
      <div className="row row--stack" style={{ marginTop: 'var(--space-3)' }}>
        <button className="btn btn--primary" onClick={сохранить}>
          Записать
        </button>
        <button className="btn" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  )
}

/**
 * Снимки бланка у одного анализа.
 *
 * Обещание здесь одно и оно прямое: снимок остаётся на этом телефоне. В копию
 * дневника он не уезжает — копия переписывается при каждой отметке приёма, и
 * двадцать бланков превратили бы её в загрузку сорока мегабайт.
 */
function Photos({
  labId,
  onAdd,
  onDelete,
}: {
  labId: string
  onAdd: (file: File) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [снимки, setСнимки] = useState<LabPhoto[]>([])
  const [ссылки, setСсылки] = useState<Record<string, string>>({})
  const [занято, setЗанято] = useState(false)
  const [ошибка, setОшибка] = useState<string | null>(null)
  const [крупно, setКрупно] = useState<string | null>(null)
  const вход = useRef<HTMLInputElement>(null)
  // В браузере камеры нет, и обещать съёмку там нельзя — там выбирают файл.
  const умеетСнимать = platform().camera.canCapture()

  const перечитать = useCallback(async () => {
    const список = await getLabPhotos(labId)
    setСнимки(список)
  }, [labId])

  useEffect(() => {
    void перечитать()
  }, [перечитать])

  // Ссылки на сами картинки заводим и отпускаем вместе со списком: `objectURL`
  // живёт до конца страницы, и без отзыва память течёт на каждом открытии.
  useEffect(() => {
    const свежие: Record<string, string> = {}
    for (const снимок of снимки) свежие[снимок.id] = URL.createObjectURL(снимок.blob)
    setСсылки(свежие)
    return () => {
      for (const url of Object.values(свежие)) URL.revokeObjectURL(url)
    }
  }, [снимки])

  const снять = async () => {
    setЗанято(true)
    setОшибка(null)
    try {
      const снимок = await platform().camera.take()
      // `null` — человек закрыл окно или отказал в разрешении. Это не ошибка,
      // и баннер здесь только напугал бы.
      if (снимок) {
        await onAdd(new File([снимок], 'blank.jpg', { type: снимок.type || 'image/jpeg' }))
        await перечитать()
      }
    } catch (caught) {
      setОшибка(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setЗанято(false)
    }
  }

  const выбрали = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    // Поле сбрасываем сразу: без этого второй выбор того же файла не сработает.
    event.target.value = ''
    if (!file) return
    setЗанято(true)
    setОшибка(null)
    try {
      await onAdd(file)
      await перечитать()
    } catch (caught) {
      setОшибка(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setЗанято(false)
    }
  }

  return (
    <div style={{ marginTop: 'var(--space-2)' }}>
      {снимки.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {снимки.map((снимок) => (
            <button
              key={снимок.id}
              className="photo-thumb"
              onClick={() => setКрупно(снимок.id)}
              aria-label={`Снимок от ${formatDay(снимок.day)}, открыть крупно`}
            >
              {ссылки[снимок.id] && <img src={ссылки[снимок.id]} alt="" />}
            </button>
          ))}
        </div>
      )}

      <div className="row" style={{ marginTop: снимки.length > 0 ? 'var(--space-2)' : 0 }}>
        <button
          className="btn btn--sm"
          disabled={занято}
          onClick={() => (умеетСнимать ? void снять() : вход.current?.click())}
        >
          {занято
            ? 'Готовим снимок…'
            : снимки.length > 0
              ? 'Добавить снимок'
              : умеетСнимать
                ? 'Снять бланк'
                : 'Выбрать снимок'}
        </button>
      </div>
      <input
        ref={вход}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => void выбрали(e)}
      />
      {снимки.length === 0 && (
        <div className="muted" style={{ marginTop: 'var(--space-1)' }}>
          Снимок останется только на этом телефоне: в копию дневника он не уезжает.
        </div>
      )}

      {ошибка && (
        <div style={{ marginTop: 'var(--space-2)' }}>
          <Banner tone="warning">{ошибка}</Banner>
        </div>
      )}

      {крупно && ссылки[крупно] && (
        <div className="photo-view" role="dialog" aria-label="Снимок бланка">
          <img src={ссылки[крупно]} alt="Снимок бланка" />
          <div className="row" style={{ marginTop: 'var(--space-3)' }}>
            <button className="btn" onClick={() => setКрупно(null)}>
              Закрыть
            </button>
            <button
              className="btn btn--sm"
              onClick={() => {
                const id = крупно
                setКрупно(null)
                void onDelete(id).then(перечитать)
              }}
            >
              Удалить снимок
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function Labs({
  labs,
  regimens,
  person,
  personName,
  now,
  onSave,
  onDelete,
  onAddPhoto,
  onDeletePhoto,
  onBack,
}: {
  labs: LabTest[]
  regimens: Regimen[]
  person: string
  personName: string | null
  now: number
  onSave: (next: LabTest) => void
  onDelete: (id: string) => void
  /** Добавить снимок бланка: уменьшение и запись — снаружи. */
  onAddPhoto: (test: LabTest, file: File) => Promise<void>
  onDeletePhoto: (id: string) => Promise<void>
  onBack: () => void
}) {
  const [форма, setФорма] = useState<{ kind: 'test' | 'result'; id: string | null } | null>(null)
  /** Счётчик, который дёргают снимки: по нему пересчитывается занятая память. */
  const [обновление, setОбновление] = useState(0)

  const мои = useMemo(() => sortLabs(labsOf(labs, person), regimens, now), [labs, regimens, person, now])

  /**
   * Сколько занято снимками. Пока их нет — строки нет: пустое «0 Б» только
   * шумит. Телефон отца не новый, и молчать про занятую память нельзя.
   */
  const [занято, setЗанято] = useState(0)
  useEffect(() => {
    void getLabPhotoBytes().then(setЗанято).catch(() => undefined)
  }, [labs, обновление])
  const правим = форма?.kind === 'test' && форма.id ? (мои.find((t) => t.id === форма.id) ?? null) : null
  const кому = форма?.kind === 'result' ? (мои.find((t) => t.id === форма.id) ?? null) : null

  return (
    <div className="stack">
      <BackBar onBack={onBack} />

      <div className="tile">
        <h2>Анализы{personName ? ` · ${personName}` : ''}</h2>
        <div className="muted">
          Приложение записывает числа с ваших слов и напоминает сдать. Норму оно не знает и результат не оценивает —
          это дело врача.
        </div>
      </div>

      {форма?.kind === 'test' && (
        <LabForm
          test={правим}
          regimens={regimens}
          person={person}
          now={now}
          onSave={(next) => {
            onSave(next)
            setФорма(null)
          }}
          onDelete={() => {
            if (правим) onDelete(правим.id)
            setФорма(null)
          }}
          onCancel={() => setФорма(null)}
        />
      )}

      {кому && форма?.kind === 'result' && (
        <ResultForm
          test={кому}
          now={now}
          onSave={(результат) => {
            onSave({ ...кому, results: [...кому.results, результат] })
            setФорма(null)
          }}
          onCancel={() => setФорма(null)}
        />
      )}

      {мои.length === 0 && форма === null && (
        <div className="tile">
          <div className="muted">
            Пока ничего не заведено. Заведите анализ, если врач попросил сдавать его регулярно, — приложение напомнит.
          </div>
        </div>
      )}

      {мои.length > 0 && (
        <ul className="pills">
          {мои.map((test) => {
            const срок = describeDue(test, regimens, now)
            const последний = lastResult(test)
            const разрыв = describeFrozen(test, regimens)
            return (
              <li className="pill" key={test.id}>
                <div className="pill__head">
                  <span className="pill__title">
                    <span className="pill__name">{test.name}</span>
                  </span>
                  {срок && <span className="pill__why">{срок}</span>}
                </div>
                {test.note && <div className="muted">{test.note}</div>}
                {последний ? (
                  <div className="muted">
                    Последний — {formatDay(последний.day, now)}
                    {последний.values.length > 0
                      ? `: ${последний.values.map(formatValue).join('; ')}${test.unit ? ' ' + test.unit : ''}`
                      : ''}
                    {последний.note ? ` · ${последний.note}` : ''}
                  </div>
                ) : (
                  <div className="muted">Результатов пока нет</div>
                )}
                {разрыв && (
                  <div style={{ marginTop: 'var(--space-2)' }}>
                    <Banner tone="info">{разрыв}</Banner>
                  </div>
                )}
                <Photos
                  labId={test.id}
                  onAdd={async (file) => {
                    await onAddPhoto(test, file)
                    setОбновление((n) => n + 1)
                  }}
                  onDelete={async (id) => {
                    await onDeletePhoto(id)
                    setОбновление((n) => n + 1)
                  }}
                />
                <div className="row" style={{ marginTop: 'var(--space-2)' }}>
                  <button className="btn btn--sm" onClick={() => setФорма({ kind: 'result', id: test.id })}>
                    Записать результат
                  </button>
                  <button className="btn btn--sm" onClick={() => setФорма({ kind: 'test', id: test.id })}>
                    Изменить
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {форма === null && (
        <div className="row row--stack" style={{ marginTop: 'var(--space-4)' }}>
          <button className="btn btn--primary" onClick={() => setФорма({ kind: 'test', id: null })}>
            Добавить анализ
          </button>
        </div>
      )}

      {занято > 0 && (
        <div className="muted" style={{ marginTop: 'var(--space-3)' }}>
          Снимки занимают {formatBytes(занято)} на этом телефоне. В копию дневника они не уезжают — если телефон
          потеряется, останутся только числа и даты.
        </div>
      )}
    </div>
  )
}
