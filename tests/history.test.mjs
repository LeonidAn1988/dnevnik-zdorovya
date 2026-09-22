/**
 * Свёрнутая история приёма: ответ врачу за годы, а не за два месяца.
 *
 * Отметки живут шестьдесят дней и дальше выбрасываются. Свёртка складывает их в
 * месячные итоги до того, как они пропадут. Проверяется главное её свойство —
 * повторный вызов не должен пересчитывать одни и те же дни: граница хранения
 * сдвигается каждый день, месяц уходит за неё по кусочку, и наивная реализация
 * насчитала бы назначенные дозы по нескольку раз.
 */
import { foldHistory, historyTotal, monthKey } from './build/api.mjs'

const DAY = 24 * 60 * 60 * 1000

function startOfDayTs(ts) {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
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

  const now = new Date(2026, 8, 1, 12, 0, 0).getTime()
  const день = (сдвиг) => {
    const d = new Date(startOfDayTs(now))
    d.setDate(d.getDate() - сдвиг)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }

  check('ключ месяца локальный', monthKey(new Date(2026, 6, 15, 9, 0, 0).getTime()) === '2026-07')

  // Препарат заведён 120 дней назад, два приёма в день, отмечали через раз.
  const отметки = []
  for (let i = 120; i >= 0; i--) if (i % 2 === 0) отметки.push(день(i) + 8 * 60 * 60 * 1000)

  const препарат = { id: 'm1', name: 'Периндоприл', times: ['08:00', '20:00'], since: день(120), taken: отметки }

  const свёрнут = foldHistory(препарат, now)
  check('граница свёртки проставлена', typeof свёрнут.foldedUntil === 'number')
  check('свежие отметки остались', свёрнут.taken.length > 0 && свёрнут.taken.every((t) => t >= свёрнут.foldedUntil))
  check('старые отметки убраны', !свёрнут.taken.some((t) => t < свёрнут.foldedUntil))
  check('история появилась', Object.keys(свёрнут.history).length >= 2, JSON.stringify(свёрнут.history))

  const итог = historyTotal(свёрнут)
  // За горизонт ушло 120 − 59 = 61 день по два приёма.
  check('назначенные посчитаны по расписанию', итог.planned === 61 * 2, `planned=${итог.planned}`)
  check('принятые посчитаны по отметкам', итог.taken === отметки.filter((t) => t < свёрнут.foldedUntil).length, `taken=${итог.taken}`)
  check('принятых меньше назначенных', итог.taken < итог.planned)

  // Главное: второй вызов в тот же день ничего не добавляет.
  const дважды = foldHistory(свёрнут, now)
  const итог2 = historyTotal(дважды)
  check('повторная свёртка не удваивает', итог2.planned === итог.planned && итог2.taken === итог.taken,
    `было ${итог.planned}/${итог.taken}, стало ${итог2.planned}/${итог2.taken}`)

  // А на следующий день добавляет ровно один день.
  const завтра = foldHistory(свёрнут, now + DAY)
  check('на следующий день прибавился один день', historyTotal(завтра).planned === итог.planned + 2,
    `${historyTotal(завтра).planned} против ${итог.planned + 2}`)

  // Препарат без расписания сворачивать нечего, но отметки за горизонтом
  // держать тоже незачем.
  const без = foldHistory({ id: 'm2', name: 'Без расписания', taken: [день(100), день(1)] }, now)
  check('без расписания история не заводится', без.history === undefined)
  check('без расписания старые отметки всё равно отброшены', без.taken.length === 1)

  // Свежий препарат: сворачивать нечего вовсе.
  const свежий = foldHistory({ id: 'm3', name: 'Свежий', times: ['09:00'], since: день(3), taken: [день(2)] }, now)
  check('свежий препарат не трогается', свежий.history === undefined && свежий.taken.length === 1)

  return failures
}
