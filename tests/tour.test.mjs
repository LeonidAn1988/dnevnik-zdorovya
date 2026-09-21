/**
 * Гайд-курс: какие курсы и шаги показывать.
 *
 * Проверяется главное правило — курс не зовёт туда, чего в этой сборке нет:
 * ни в выключенный раздел, ни к напоминаниям в браузере, ни к кнопке выбора
 * человека, когда человек один.
 *
 * И второе правило, появившееся дорогой ценой: **курс обязан сходиться с
 * разметкой**. Курс живёт в одном файле, кнопки — в другом, связи между ними
 * нет никакой, и однажды они разошлись молча: в шапку добавили четвёртую
 * кнопку, а курс продолжал говорить «Три кнопки сверху». Заметил владелец.
 * Поэтому здесь есть сканер исходников — по образцу `portability.test.mjs`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tours, tourByKey, toolLabels } from './build/api.mjs'

const корень = join(fileURLToPath(import.meta.url).slice(0, fileURLToPath(import.meta.url).lastIndexOf('/')), '..')

/** Все якоря, расставленные в разметке: три способа их задать. */
function якоряИзРазметки() {
  const найдено = new Set()
  const обойти = (dir) => {
    for (const имя of readdirSync(dir)) {
      const путь = join(dir, имя)
      if (statSync(путь).isDirectory()) {
        обойти(путь)
        continue
      }
      if (!/\.tsx?$/.test(имя)) continue
      const текст = readFileSync(путь, 'utf8')
      // data-tour="X" в разметке, tour="X" у NavRow, tour: 'X' в списке кнопок.
      for (const re of [/data-tour="([^"]+)"/g, /\btour="([^"]+)"/g, /\btour: '([^']+)'/g]) {
        // Пропускаем шаблонные подстановки: в `Tour.tsx` селектор собирается
        // строкой `[data-tour="${target}"]`, и это не якорь, а его поиск.
        for (const m of текст.matchAll(re)) if (!m[1].includes('${')) найдено.add(m[1])
      }
    }
  }
  обойти(join(корень, 'src'))
  return найдено
}

/**
 * Якоря, которые намеренно не покрыты ни одним курсом. Пустой список лучше
 * длинного: каждая строка здесь — раздел, о котором приложение не рассказывает.
 */
const БЕЗ_КУРСА = new Set([
  // «О приложении» — версии и история правок, помощи там нет.
  'set-about',
])

const базовые = {
  sections: { overview: true, bp: true, intake: true, cabinet: true },
  trackGlucose: false,
  people: [{ id: 'a', name: 'Я' }],
}

export function run() {
  let failures = 0
  const check = (name, condition, detail = '') => {
    if (condition) console.log(`  ok   ${name}`)
    else {
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
      failures++
    }
  }

  const всё = tours(базовые)
  check('курсов четыре', всё.length === 4, `их ${всё.length}`)
  check('ключи не повторяются', new Set(всё.map((к) => к.key)).size === всё.length)
  check(
    'у каждого курса есть шаги и они не длиннее шести',
    всё.every((к) => к.steps.length > 0 && к.steps.length <= 6),
    всё.map((к) => `${к.key}:${к.steps.length}`).join(' '),
  )
  check(
    'у каждого шага есть цель, заголовок и текст',
    всё.every((к) => к.steps.every((ш) => ш.target && ш.title && ш.text)),
  )

  const один = всё.find((к) => к.key === 'basics')
  check('при одном человеке шага про выбор человека нет', !один.steps.some((ш) => ш.target === 'person'))

  const семья = tours({ ...базовые, people: [{ id: 'a' }, { id: 'b' }] })
  const сСемьёй = семья.find((к) => к.key === 'basics')
  check('в семье шаг про выбор человека появляется', сСемьёй.steps.some((ш) => ш.target === 'person'))

  const безНапоминаний = tours(базовые, { reminders: false })
  check(
    'без напоминаний шага про них нет',
    !безНапоминаний.some((к) => к.steps.some((ш) => ш.target === 'set-reminders')),
  )
  check(
    'с напоминаниями шаг про них есть',
    tours(базовые, { reminders: true }).some((к) => к.steps.some((ш) => ш.target === 'set-reminders')),
  )

  const безДавления = tours({ ...базовые, sections: { ...базовые.sections, bp: false } })
  check('без раздела давления курса про давление нет', !безДавления.some((к) => к.key === 'bp'))
  check(
    'и ни один шаг не зовёт на выключенную вкладку',
    !безДавления.some((к) => к.steps.some((ш) => ш.tab === 'bp')),
  )

  const толькоАптечка = tours({
    sections: { overview: false, bp: false, intake: false, cabinet: true },
    trackGlucose: false,
    people: [{ id: 'a' }],
  })
  check('с одной аптечкой курсы остаются', толькоАптечка.length >= 2, `их ${толькоАптечка.length}`)
  check(
    'и не зовут ни на «Обзор», ни на «Приём»',
    !толькоАптечка.some((к) => к.steps.some((ш) => ш.tab === 'overview' || ш.tab === 'intake')),
  )

  check('курс по ключу находится', tourByKey('meds', базовые)?.key === 'meds')
  check('несуществующий ключ даёт null', tourByKey('нет такого', базовые) === null)
  check('выключенный курс по ключу не отдаётся', tourByKey('bp', { ...базовые, sections: { ...базовые.sections, bp: false } }) === null)

  // ── курс сходится с разметкой ───────────────────────────────────────────
  {
    const якоря = якоряИзРазметки()
    const все = tours({ ...базовые, people: [{ id: 'a' }, { id: 'b' }] }, { reminders: true })
    const цели = new Set(все.flatMap((к) => к.steps.map((ш) => ш.target)))

    check('якоря в разметке вообще нашлись', якоря.size > 5, `найдено ${якоря.size}`)

    const впустоту = [...цели].filter((t) => !якоря.has(t))
    check('ни один шаг не показывает в пустоту', впустоту.length === 0, впустоту.join(', '))

    const заброшенные = [...якоря].filter((a) => !цели.has(a) && !БЕЗ_КУРСА.has(a))
    check('ни один якорь не заброшен курсами', заброшенные.length === 0, заброшенные.join(', '))

    // Тот самый дефект: кнопок стало четыре, а текст остался про три.
    const шаг = все.flatMap((к) => к.steps).find((ш) => ш.target === 'tools')
    check('шаг про шапку есть', !!шаг)
    const непроизнесённые = toolLabels().filter((l) => !шаг.text.includes(l))
    check('шаг про шапку называет все кнопки', непроизнесённые.length === 0, непроизнесённые.join(', '))
    check('и не называет их число словом', !/\bтри\b|\bчетыре\b/i.test(шаг.title + шаг.text), шаг.title)
  }

  return failures
}
