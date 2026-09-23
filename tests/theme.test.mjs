/**
 * Тёмная тема живёт в двух местах, и они обязаны совпадать.
 *
 * Их действительно два: `@media (prefers-color-scheme: dark)` — когда тему
 * выбрал телефон, и `:root[data-theme='dark']` — когда человек выбрал её
 * руками в настройках. Второй сильнее первого и применяется у всех, кто
 * однажды переключил тему сам.
 *
 * Список уже дважды расходился, и оба раза молча:
 *
 * - `--good-text` и `--warning-text` из 0.29.0 в ручной блок не попали, и
 *   починка контраста галочки «принято» не дошла ровно до владельца;
 * - `--field` не попал следом, и барабаны ввода на его телефоне стали белыми
 *   посреди тёмного экрана.
 *
 * Оба раза это увидел живой телефон, а не прогон: браузерные проверки ставят
 * `colorScheme`, то есть идут первым путём и второго не касаются.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const здесь = fileURLToPath(import.meta.url)
const root = join(здесь.slice(0, здесь.lastIndexOf('/')), '..')

export function run() {
  let failures = 0
  const check = (name, condition, detail = '') => {
    if (condition) console.log(`  ok   ${name}`)
    else {
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
      failures++
    }
  }

  const css = readFileSync(join(root, 'src/app.css'), 'utf8')

  const медиаОт = css.indexOf('@media (prefers-color-scheme: dark)')
  const выборОт = css.indexOf(":root[data-theme='dark'] {")
  check('оба блока тёмной темы на месте', медиаОт > 0 && выборОт > медиаОт)

  const медиа = css.slice(медиаОт, выборОт)
  const выбор = css.slice(выборОт, выборОт + css.slice(выборОт).indexOf('\n}'))

  const токены = (кусок) => new Set([...кусок.matchAll(/--([\w-]+):\s*var\(--dark--/g)].map((m) => m[1]))
  const вМедиа = токены(медиа)
  const вВыборе = токены(выбор)

  // Без этого молчание значило бы «разбор перестал их узнавать».
  check('токенов в блоках достаточно', вМедиа.size >= 15, `нашлось ${вМедиа.size}`)

  const нетВВыборе = [...вМедиа].filter((t) => !вВыборе.has(t)).sort()
  const нетВМедиа = [...вВыборе].filter((t) => !вМедиа.has(t)).sort()
  check('ручная тёмная тема не отстаёт от системной', нетВВыборе.length === 0, нетВВыборе.join(', '))
  check('и не убегает вперёд', нетВМедиа.length === 0, нетВМедиа.join(', '))

  // Каждому `--dark--*` есть применение: заведённый и не подставленный токен
  // выглядит как сделанная работа, а не как забытая.
  const заведены = new Set([...css.matchAll(/^\s*--dark--([\w-]+):/gm)].map((m) => m[1]))
  const забыты = [...заведены].filter((t) => !вМедиа.has(t)).sort()
  check('все тёмные токены подставлены', забыты.length === 0, забыты.join(', '))

  return failures
}
