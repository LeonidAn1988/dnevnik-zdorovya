/**
 * Прогон тестов: собирает нужные модули из TypeScript в tests/build и запускает наборы.
 *   npm test
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const testsDir = dirname(fileURLToPath(import.meta.url))
const root = join(testsDir, '..')
const buildDir = join(testsDir, 'build')

rmSync(buildDir, { recursive: true, force: true })
mkdirSync(buildDir, { recursive: true })

// Один бандл на все наборы: реестр платформы хранит состояние в модуле,
// и при раздельных бандлах установленная платформа была бы не видна.
execFileSync(
  'npx',
  [
    'esbuild',
    'tests/api.ts',
    '--bundle',
    '--format=esm',
    '--external:fake-indexeddb',
    `--outfile=${join(buildDir, 'api.mjs')}`,
    '--log-level=error',
  ],
  { cwd: root, stdio: 'inherit' },
)

const suites = [
  ['Разбор записи прибора (сверка с omblepy)', await import('./parse-record.test.mjs')],
  ['Экспорт и импорт файлов', await import('./io.test.mjs')],
  ['Миграция хранилища с версии 1 на версию 2', await import('./migration.test.mjs')],
  ['Профиль глюкометра (пакеты по спецификации)', await import('./glucose-profile.test.mjs')],
  ['Сохранность дневника', await import('./backup.test.mjs')],
  ['Аптечка: остатки и сроки', await import('./medicines.test.mjs')],
  ['Память прибора', await import('./memory.test.mjs')],
  ['Одно вещество в двух коробках', await import('./duplicates.test.mjs')],
  ['Молчание в чужом дневнике', await import('./silence.test.mjs')],
  ['Памятка на холодильник', await import('./memo.test.mjs')],
  ['Дневник по дням для врача', await import('./diary.test.mjs')],
  ['События и сравнение до/после', await import('./events.test.mjs')],
  ['Расписание измерений и курс', await import('./course.test.mjs')],
  ['Ритм приёма: не каждый день', await import('./rhythm.test.mjs')],
  ['Гайд-курс по приложению', await import('./tour.test.mjs')],
  ['Справочник лекарств', await import('./drugs.test.mjs')],
  ['Расписание в календарь', await import('./calendar.test.mjs')],
  ['Напоминания о приёме', await import('./reminders.test.mjs')],
  ['Шифрование копии', await import('./crypto.test.mjs')],
  ['Люди в дневнике', await import('./people.test.mjs')],
  ['Стек экранов', await import('./nav.test.mjs')],
  ['Правила настроек', await import('./settings.test.mjs')],
  ['Слияние дневников', await import('./merge.test.mjs')],
  ['Аптеки', await import('./pharmacies.test.mjs')],
  ['Пороги давления и сахара', await import('./classify.test.mjs')],
  ['Статистика для отчёта', await import('./stats.test.mjs')],
  ['Схема приёма', await import('./plan.test.mjs')],
  ['Яндекс.Диск', await import('./yandex.test.mjs')],
  ['Следы удалений', await import('./tombstones.test.mjs')],
  ['Свёрнутая история приёма', await import('./history.test.mjs')],
  ['История изменений', await import('./changelog.test.mjs')],
  ['Переносимость ядра', await import('./portability.test.mjs')],
]

let failures = 0
for (const [name, suite] of suites) {
  console.log(`\n${name}`)
  failures += await suite.run()
}

rmSync(buildDir, { recursive: true, force: true })

console.log(failures === 0 ? '\nВсе тесты пройдены.\n' : `\nПРОВАЛЕНО ПРОВЕРОК: ${failures}\n`)
process.exit(failures === 0 ? 0 : 1)
