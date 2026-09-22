/**
 * Держит системные напоминания в согласии с аптечкой и слушает нажатия по ним.
 *
 * Живёт рядом с данными, а не на экране настроек: расписание правится в
 * аптечке, отметки о приёме ставятся на экране приёма, а настройки в это время
 * закрыты. Если бы пересборкой занимался раздел настроек, отмеченный приём
 * продолжал бы напоминать о себе до следующего захода в настройки.
 *
 * Набор переписывается целиком при каждом изменении. Это и есть механизм
 * «повторять, пока не отмечено»: сборщик просто не ставит напоминаний на уже
 * отмеченный приём, поэтому отметка снимает оставшиеся повторы сама.
 */

import { useEffect, useRef, useState } from 'react'
import type { MeasureSubject } from '../logic/course'
import { MAX_LABS_PER_PERSON, planReminders, type LabSubject } from '../logic/reminders'
import { platform } from '../platform/ports'
import type { Dosing } from '../logic/regimen'
import type { LabTest, Person, Regimen } from '../types'

export interface RemindersInput {
  medicines: Dosing[]
  /**
   * Кому напоминать измерить давление. Пусто — расписаний нет.
   *
   * Считается снаружи: этот хук о настройках и людях знает ровно столько,
   * сколько ему передали, и расписание измерений — не исключение.
   */
  subjects: MeasureSubject[]
  /**
   * Анализы — все, а не только выбранного человека.
   *
   * Они входят в тот же набор и тот же бюджет: напоминания ставятся одним
   * вызовом, и второй стёр бы первый.
   */
  labs: LabTest[]
  /** Курсы приёма — для анализов, привязанных к концу курса. */
  regimens: Regimen[]
  enabled: boolean
  /** Люди в дневнике: по ним уведомление решает, называть ли владельца. */
  people: Person[]
  sound: string
  /** Повторять, пока приём не отмечен. */
  repeat: boolean
  /** Данные загружены: до этого пустая аптечка ничего не значит. */
  ready: boolean
  /** Человек нажал на уведомление — ждёт экран, где ставится отметка. */
  onOpen: (day: number) => void
  /** Человек нажал «Принял» прямо в уведомлении. */
  onTaken: (day: number, slot: string, person?: string) => void
}

export function useReminders({
  medicines,
  subjects,
  labs,
  regimens,
  enabled,
  people,
  sound,
  repeat,
  ready,
  onOpen,
  onTaken,
}: RemindersInput) {
  /**
   * Чьи это таблетки. Пока человек один — `null`, и уведомления выглядят как
   * прежде; при нескольких людях каждому ставится своё, с именем в заголовке.
   */
  // Человек берётся из самого курса: коробка с 0.27.0 ничья.
  const personOf = (приём: Dosing): string | null => (people.length <= 1 ? null : приём.person)
  const personName = (id: string): string | null => people.find((p) => p.id === id)?.name?.trim() || null
  // Слепок последнего применённого состояния: React вызывает эффект и когда
  // ничего по сути не изменилось (новая ссылка на тот же список), а каждая
  // пересборка — это поход в системный планировщик.
  const applied = useRef<string | null>(null)

  /**
   * Горизонт напоминаний конечен, и время его подъедает. Пересобираем при
   * каждом возвращении к приложению — этого достаточно, потому что запас
   * измеряется неделями, а приложение открывают ради самих напоминаний.
   */
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const проснулись = () => {
      if (document.visibilityState === 'visible') setTick((n) => n + 1)
    }
    document.addEventListener('visibilitychange', проснулись)
    return () => document.removeEventListener('visibilitychange', проснулись)
  }, [])

  // Обработчики держим в ссылке: подписка на уведомления должна пережить
  // перерисовку, а не пересоздаваться на каждый новый замыкающий колбэк.
  const handlers = useRef({ onOpen, onTaken })
  handlers.current = { onOpen, onTaken }

  useEffect(() => {
    const reminders = platform().reminders
    if (!reminders.isSupported()) return
    return reminders.onAction((action) => {
      if (action.kind === 'taken') handlers.current.onTaken(action.day, action.slot, action.person)
      else handlers.current.onOpen(action.day)
    })
  }, [])

  useEffect(() => {
    // До загрузки аптечки список пуст не потому, что препаратов нет, а потому
    // что их ещё не прочитали. Пересборка в этот момент сняла бы все
    // напоминания — и вернула бы их только через мгновение, а при неудачном
    // стечении обстоятельств не вернула бы вовсе.
    if (!ready) return

    const reminders = platform().reminders
    if (!reminders.isSupported()) return

    // Оба рода — одним набором и одним бюджетом. Раздельно ставить нельзя:
    // плагин снимает всё, чего нет в поданном массиве, и второй вызов стёр бы
    // первый. Напоминания об измерении включаются своим переключателем, а не
    // общим: курс измерений бывает у того, кто таблеток не пьёт вовсе.
    // Анализы идут вместе с приёмами и меряются тем же переключателем: он
    // называется «напоминания», а не «напоминания о таблетках».
    const анализы: LabSubject[] = []
    const счётчик = new Map<string, number>()
    for (const test of labs) {
      const место = people.findIndex((p) => p.id === test.owner)
      const номер = счётчик.get(test.owner) ?? 0
      счётчик.set(test.owner, номер + 1)
      // Больше восьми на человека не ставим: в номере уведомления под анализ
      // отведено три разряда, и девятый получил бы номер первого — одно
      // напоминание сняло бы другое. Молча путать напоминания хуже, чем не
      // поставить их вовсе; сам анализ при этом виден на своём экране.
      if (номер >= MAX_LABS_PER_PERSON) continue
      анализы.push({
        test,
        person: test.owner,
        name: people.length <= 1 ? null : (people.find((p) => p.id === test.owner)?.name ?? null),
        index: место >= 0 ? место : 0,
        testIndex: номер,
      })
    }

    const wanted = planReminders({
      medicines: enabled ? medicines : [],
      subjects,
      labs: enabled ? анализы : [],
      regimens,
      now: Date.now(),
      options: { repeat, personOf, personName },
    })
    // Из слепка исключены сами моменты показа: они сдвигаются с каждым
    // пересчётом, и сравнение по ним всегда давало бы «изменилось».
    const снимок = JSON.stringify([
      enabled,
      sound,
      repeat,
      // Расписания измерений — часть слепка: без них включение курса не
      // считалось бы изменением, и напоминания не появились бы до следующей
      // правки аптечки.
      subjects.map((s) => [s.person, s.index, s.plan.times.join(','), s.plan.days, s.plan.from, s.readings.length]),
      // Смещение часового пояса — часть слепка. Иначе после перелёта или
      // перевода часов набор считался бы неизменным: состав препаратов тот же,
      // а моменты показа съехали на час и больше.
      new Date().getTimezoneOffset(),
      // Подробный текст обязан входить в слепок: смена дозировки не меняет ни
      // идентификатор, ни короткую строку с названиями, и без этого в
      // уведомлении осталась бы старая цифра.
      wanted.map((item) => [item.id, item.title, item.body, item.details]),
    ])
    if (applied.current === снимок) return

    let живо = true
    void (async () => {
      try {
        if (!wanted.length) {
          await reminders.cancelAll()
        } else {
          if ((await reminders.permission()) !== 'granted') return
          await reminders.schedule(wanted, sound)
        }
        if (живо) applied.current = снимок
      } catch {
        // Планировщик мог отказать — например, разрешение отозвали в настройках
        // телефона, пока приложение работало. Слепок не запоминаем, чтобы
        // следующая попытка была настоящей, а не пропущенной по совпадению.
      }
    })()

    return () => {
      живо = false
    }
  }, [medicines, subjects, labs, regimens, enabled, people, sound, repeat, ready, tick])
}
