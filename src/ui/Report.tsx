import { useState } from 'react'
import { platform } from '../platform/ports'
import { GLUCOSE_CONTEXT_LABELS, type BpReading, type GlucoseContext, type GlucoseReading, type MeasurePlan } from '../types'
import type { Dosing } from '../logic/regimen'
import { PERIODS, type GlucoseSummary, type PeriodKey, type Summary } from '../logic/stats'
import { DAY_PART_LABELS, classify, classifyGlucose, glucoseCeiling, type DayPart, type GlucoseTargets } from '../logic/classify'
import { diaryByDays, daysMissed, SERIES_RULE } from '../logic/diary'
import { courseReport, courseReportText, planTimes } from '../logic/course'
import { describeRhythm } from '../logic/rhythm'
import { Readings } from './Readings'
import { GlucoseList } from './Glucose'
import { Banner, CategoryBadge } from './bits'
import { adherence, historyTotal, KEEP_INTAKES_DAYS, perDayOf, startOfDay } from '../logic/medicines'
import { KIND_LABEL } from '../logic/drugs'
import { monthYear, plural } from '../logic/plural'

const DATE = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const DAY_MONTH = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
const DAY_MS = 24 * 60 * 60 * 1000
const DAY_PART_ORDER: DayPart[] = ['morning', 'day', 'evening', 'night']
const GLUCOSE_ORDER: GlucoseContext[] = ['fasting', 'before-meal', 'after-meal', 'bedtime', 'night']

/** Колонки дневника: тот же порядок, что у суток. */
const ЧАСТИ = ['morning', 'day', 'evening', 'night'] as const
const ЧАСТЬ_КРАТКО: Record<(typeof ЧАСТИ)[number], string> = {
  morning: 'Утро',
  day: 'День',
  evening: 'Вечер',
  night: 'Ночь',
}
const ДЕНЬ_МЕСЯЦ = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', weekday: 'short' })

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td style={{ color: 'var(--text-muted)' }}>{label}</td>
      <td className="wrap">{children}</td>
    </tr>
  )
}

const MEAL_NOTE: Record<'before' | 'after' | 'any', string> = {
  before: ', до еды',
  after: ', после еды',
  any: '',
}

/**
 * Соблюдение режима приёма.
 *
 * Врач видит, что человек принимает, но не видит, принимает ли на самом деле.
 * Отметки о приёме дают ответ, и он часто важнее самого списка: давление
 * держится плохо не потому, что таблетка слабая, а потому, что её пьют через
 * раз.
 *
 * Цифра подаётся вместе с оговорками, а не после них: врач может изменить
 * лечение, прочитав «56%», поэтому в том же абзаце сказано, что неотмеченная
 * доза не значит непринятая, и с какого дня вообще шёл счёт.
 */
function Adherence({ medicines, from, now }: { medicines: Dosing[]; from: number; now: number }) {
  const report = adherence(medicines, from, now)
  if (report.rows.length === 0 && report.unmarked.length === 0) return null

  const percent = report.rate === null ? null : Math.round(report.rate * 100)

  return (
    <div className="card">
      <div className="card__head">
        <h2>Соблюдение режима приёма</h2>
        <span className="muted">по отметкам в приложении</span>
      </div>

      {percent !== null && (
        <table className="report-facts">
          <tbody>
            <Row label="Отмечено">
              <b>{percent}%</b> — {report.taken} {plural(report.taken, 'приём', 'приёма', 'приёмов')} из{' '}
              {report.planned} по расписанию
            </Row>
            <Row label="Учтено с">
              {DAY_MONTH.format(report.from)}
              {report.clipped &&
                ` · отметки хранятся ${KEEP_INTAKES_DAYS} ${plural(KEEP_INTAKES_DAYS, 'день', 'дня', 'дней')}, поэтому срок короче периода отчёта`}
            </Row>
          </tbody>
        </table>
      )}

      {/* Три колонки, а не четыре. Отдельный столбец пропусков не влезал:
          заголовок «Пропущено» рвался посреди слова — «Пропу/щено». Само число
          при этом никуда не делось, оно читается из «39 из 41» и продублировано
          подписью. */}
      {report.rows.length > 0 && (
        <table className="report-adherence" style={{ marginTop: 'var(--space-4)' }}>
          <thead>
            <tr>
              <th>Препарат</th>
              <th>Принято</th>
              <th>Доля</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.intake.regimenId}>
                <td>
                  {row.intake.name}
                  {/* Две разные даты, и путать их нельзя.
                      «Отметки с» — с какого дня есть данные о соблюдении: это
                      первая отметка, и раньше она стояла просто как «с», а врач
                      читает такое как «начал принимать тогда-то».
                      «В дневнике с» — день, когда препарат завели. Ни та, ни
                      другая не отвечают на вопрос «сколько лет принимаете»:
                      до приложения человек мог пить его годами, и честного
                      ответа у нас пока нет. */}
                  {/* «Принимает с» — со слов человека, и это единственная из
                      трёх дат, которая отвечает на вопрос врача «как давно».
                      Стоит первой и без оговорок. Остальные две про дневник, а
                      не про лечение, и названы своими именами. */}
                  {row.intake.startedAt !== undefined && (
                    <div>принимает с {monthYear(row.intake.startedAt)}</div>
                  )}
                  <div className="muted">отметки с {DAY_MONTH.format(row.from)}</div>
                  {/* Ответ на вопрос «а раньше как принимали». Отметки живут
                      шестьдесят дней, дальше остаётся свёрнутый месячный итог —
                      и он единственное, чем можно ответить про курс длиной в
                      год. Отдельной строкой, а не в столбце с недавним: смешать
                      их значило бы выдать разные периоды за один. */}
                  {(() => {
                    const было = historyTotal(row.intake)
                    if (было.planned === 0) return null
                    return (
                      <div className="muted">
                        до этого {было.taken} из {было.planned} за {было.months}{' '}
                        {plural(было.months, 'месяц', 'месяца', 'месяцев')}
                      </div>
                    )
                  })()}
                  {row.intake.since !== undefined && startOfDay(row.intake.since) < row.from && (
                    <div className="muted">в дневнике с {DAY_MONTH.format(row.intake.since)}</div>
                  )}
                </td>
                <td>
                  {row.taken} из {row.planned}
                  {row.planned > row.taken && <div className="muted">пропущено {row.planned - row.taken}</div>}
                </td>
                <td>{row.planned > 0 ? `${Math.round((row.taken / row.planned) * 100)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="muted" style={{ marginTop: 'var(--space-4)', lineHeight: 1.6 }}>
        {report.unmarked.length > 0 && (
          <>
            Без отметок за срок: {report.unmarked.map((m) => m.name).join(', ')} — в долю не{' '}
            {plural(report.unmarked.length, 'вошёл', 'вошли', 'вошли')}: не принимали или не отмечали, приложению это
            неразличимо.{' '}
          </>
        )}
        {report.skipped > 0 && (
          <>
            Не {plural(report.skipped, 'учтён', 'учтены', 'учтены')} {report.skipped}{' '}
            {plural(report.skipped, 'препарат', 'препарата', 'препаратов')} без расписания или со списанием по
            расписанию.{' '}
          </>
        )}
        Счёт по каждому препарату идёт со дня первой отметки. Пропуск означает неотмеченную дозу, а не доказанно
        непринятую.
      </div>
    </div>
  )
}

/** Десятичный разделитель по-русски — запятая. */

const десятичная = (value: number) => value.toFixed(1).replace('.', ',')

export function Report({
  readings,
  summary,
  glucoseReadings,
  glucoseSummary,
  glucoseTargets,
  patient,
  periodLabel,
  targetSys,
  targetDia,
  period,
  onPeriodChange,
  medicines,
  measurePlan,
}: {
  readings: BpReading[]
  summary: Summary | null
  glucoseReadings: GlucoseReading[]
  glucoseSummary: GlucoseSummary | null
  glucoseTargets: GlucoseTargets
  patient: string
  periodLabel: string
  targetSys: number
  targetDia: number
  period: PeriodKey
  onPeriodChange: (next: PeriodKey) => void
  /** Аптечка попадает в отчёт: на приёме врачу нужен список того, что человек принимает. */
  medicines: Dosing[]
  /** Курс измерений, если он был: врачу важно, по какой схеме вёлся дневник. */
  measurePlan?: MeasurePlan
}) {
  /** Системная печать не открылась — на нестандартной прошивке так бывает. */
  const [printFailed, setPrintFailed] = useState(false)

  // Дневник по дням — то, в какой форме врач читает самоконтроль. Плоский
  // список остаётся ниже, под «Подробнее»: исходные цифры не прячем.
  const дневник = diaryByDays(readings, medicines)
  const курс = measurePlan
    ? courseReportText(courseReport(measurePlan, readings.map((r) => r.ts), Date.now()), planTimes(measurePlan))
    : null
  const пропущено = daysMissed(дневник)

  // Период — орган управления отчётом, поэтому стоит рядом с кнопкой печати,
  // а не в общей шапке приложения. Ограничений по периоду нет: «Всё время»
  // доступно всегда и бесплатно.
  const picker = (
    <div className="segmented segmented--fill no-print" role="group" aria-label="Период отчёта">
      {PERIODS.map((item) => (
        <button key={item.key} aria-pressed={period === item.key} onClick={() => onPeriodChange(item.key)}>
          {item.label}
        </button>
      ))}
    </div>
  )

  if (!summary && !glucoseSummary) {
    return (
      <div className="stack">
        <div className="row no-print">{picker}</div>
        <div className="chart__empty">За выбранный период нет записей — отчёт формировать не из чего.</div>
      </div>
    )
  }

  const span = summary ?? glucoseSummary!
  // Начало периода отчёта. «Всё время» отдаём нулём — соблюдение режима само
  // урежет срок до горизонта хранения отметок и об этом скажет.
  const periodDays = PERIODS.find((p) => p.key === period)?.days ?? null
  const periodFrom = periodDays === null ? 0 : Date.now() - periodDays * DAY_MS

  return (
    <div className="stack">
      <div className="row no-print">
        {/* Отказ печати больше не уходит в никуда: на нестандартной прошивке
            системного диалога может не быть вовсе, и кнопка, которая молча
            ничего не делает, хуже отсутствующей. */}
        <button
          className="btn btn--primary"
          data-tour="report-print"
          onClick={() => void platform().files.print('Отчёт врачу').then((ok) => setPrintFailed(!ok))}
        >
          Печать или сохранение в PDF
        </button>
        {picker}
      </div>
      {printFailed && (
        <div className="no-print" style={{ marginTop: 'var(--space-3)' }} role="alert">
          <Banner tone="warning">
            <b>Телефон не открыл печать</b>
            <div style={{ marginTop: 4 }}>
              Сохраните отчёт иначе: снимок экрана или «Поделиться» в настройках. Отчёт при этом остаётся на экране.
            </div>
          </Banner>
        </div>
      )}

      <div className="muted no-print" style={{ marginTop: 'calc(var(--space-3) * -1)' }}>
        В диалоге печати выберите «Сохранить как PDF», чтобы отправить отчёт врачу файлом.
      </div>

      <div className="card">
        <div className="card__head">
          <h2>Дневник самоконтроля</h2>
          <span className="muted">составлен {DATE.format(Date.now())}</span>
        </div>
        <table className="report-facts">
          <tbody>
            <Row label="Кого касается">
              {/* «Пользователь 1» — это подпись кнопки прибора, а не имя
                  человека. В документе, который несут врачу, она выглядит так,
                  будто дневник вели не глядя. Подставлять что-то за человека
                  нельзя, поэтому здесь прямая просьба — и она видна до печати. */}
              {/^(Пользовател[ья]( \d)?|Я|Человек \d+)$/.test(patient.trim()) || !patient.trim() ? (
                <span className="critical-text">имя не указано — впишите его в настройках</span>
              ) : (
                patient
              )}
            </Row>
            <Row label="Период">
              {/* Раньше стояло «30 дней — с 10 по 22 августа», и подпись спорила
                  с датами: за тридцать дней записей может быть на двенадцать.
                  Теперь видно, что первое — запрошенный срок, второе — то, что
                  в нём нашлось. */}
              за {periodLabel.toLowerCase()}, записи с&nbsp;{DATE.format(span.firstTs)} по&nbsp;
              {DATE.format(span.lastTs)}
            </Row>
            {/* Курс: врачу важно, велись измерения по назначенной схеме или как
                придётся. Без этой строки он видит россыпь и не знает, о чём
                договаривались в кабинете. */}
            {курс && <Row label="Схема измерений">{курс}</Row>}
          </tbody>
        </table>
      </div>

      {summary && (
        <>
          <div className="card">
            <div className="card__head">
              <h2>Артериальное давление</h2>
            </div>
            <table className="report-facts">
              <tbody>
                <Row label="Измерений">{summary.count}</Row>
                <Row label="Среднее давление">
                  <b>
                    {Math.round(summary.avgSys)}/{Math.round(summary.avgDia)}
                  </b>
                  &nbsp;мм&nbsp;рт.&nbsp;ст.{' '}
                  <span className="nowrap">
                    · <CategoryBadge sys={Math.round(summary.avgSys)} dia={Math.round(summary.avgDia)} />
                  </span>
                </Row>
                <Row label="Средний пульс">
                  {summary.avgBpm ? <span className="nowrap">{Math.round(summary.avgBpm)}&nbsp;уд/мин</span> : 'нет данных'}
                </Row>
                <Row label="Разброс">
                  {/* Разброс разъезжался на четыре строки: «(от» дважды
                      повисало в конце, а «62 до 77)» оставалось сиротой.
                      Диапазон — неразрывный кусок, и десятичный разделитель по
                      русским правилам запятая, а не точка. */}
                  систолическое <span className="nowrap">±{десятичная(summary.sdSys)}</span>{' '}
                  <span className="nowrap">
                    (от {summary.minSys} до {summary.maxSys})
                  </span>
                  , диастолическое <span className="nowrap">±{десятичная(summary.sdDia)}</span>{' '}
                  <span className="nowrap">
                    (от {summary.minDia} до {summary.maxDia})
                  </span>
                </Row>
                <Row label="В целевом диапазоне">
                  {Math.round(summary.withinTarget * 100)}% измерений ниже {targetSys}/{targetDia}
                </Row>
                <Row label="Отметки прибора">
                  нерегулярное сердцебиение — {summary.ihbCount}, движение при измерении — {summary.movCount}
                </Row>
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card__head">
              <h2>Давление по времени суток</h2>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Время суток</th>
                    <th>Измерений</th>
                    <th>САД/ДАД</th>
                    <th>Категория</th>
                    <th>Пульс</th>
                  </tr>
                </thead>
                <tbody>
                  {DAY_PART_ORDER.filter((part) => summary.byDayPart[part]).map((part) => {
                    const agg = summary.byDayPart[part]!
                    const sys = Math.round(agg.sys)
                    const dia = Math.round(agg.dia)
                    return (
                      <tr key={part}>
                        <td>{DAY_PART_LABELS[part]}</td>
                        <td>{agg.count}</td>
                        <td className="num">
                          {sys}/{dia}
                        </td>
                        <td className="wrap">{classify(sys, dia).label}</td>
                        <td>{agg.bpm ? Math.round(agg.bpm) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {glucoseSummary && (
        <>
          <div className="card">
            <div className="card__head">
              <h2>Уровень глюкозы крови</h2>
            </div>
            <table className="report-facts">
              <tbody>
                <Row label="Замеров">{glucoseSummary.count}</Row>
                <Row label="Средний сахар">
                  {/* Десятичный разделитель по-русски запятая. Раньше сахар
                      печатался через точку рядом с разбросом давления через
                      запятую — в одном документе два разных правила. */}
                  <b>{десятичная(glucoseSummary.avg)}</b>&nbsp;ммоль/л{' '}
                  <span className="nowrap">
                    (от {десятичная(glucoseSummary.min)} до {десятичная(glucoseSummary.max)})
                  </span>
                </Row>
                <Row label="Разброс">
                  <span className="nowrap">±{десятичная(glucoseSummary.sd)}&nbsp;ммоль/л</span>
                </Row>
                <Row label="В целевом диапазоне">
                  {Math.round(glucoseSummary.withinTarget * 100)}% замеров — с учётом момента замера: ниже{' '}
                  {десятичная(glucoseTargets.fastingMax)} натощак и {десятичная(glucoseTargets.postMealMax)} через два
                  часа
                  после еды
                </Row>
                <Row label="Ниже порога">
                  {glucoseSummary.lowCount} {plural(glucoseSummary.lowCount, 'раз', 'раза', 'раз')} ниже{' '}
                  {десятичная(glucoseTargets.low)} ммоль/л
                </Row>
                <Row label="Выше цели">
                  {glucoseSummary.highCount} {plural(glucoseSummary.highCount, 'раз', 'раза', 'раз')}
                </Row>
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card__head">
              <h2>Сахар по моменту замера</h2>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Момент замера</th>
                    <th>Замеров</th>
                    <th>Средний</th>
                    <th>Разброс</th>
                    <th>Оценка среднего</th>
                  </tr>
                </thead>
                <tbody>
                  {GLUCOSE_ORDER.filter((context) => glucoseSummary.byContext[context]).map((context) => {
                    const stats = glucoseSummary.byContext[context]!
                    return (
                      <tr key={context}>
                        <td className="wrap">{GLUCOSE_CONTEXT_LABELS[context]}</td>
                        <td>{stats.count}</td>
                        <td className="num">{stats.avg.toFixed(1)}</td>
                        <td>±{stats.sd.toFixed(1)}</td>
                        <td className="wrap">
                          {classifyGlucose(stats.avg, context, glucoseTargets).label} при норме ниже{' '}
                          {glucoseCeiling(context, glucoseTargets).toFixed(1)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {medicines.length > 0 && (
        <div className="card">
          <div className="card__head">
            <h2>Что принимает</h2>
            <span className="muted">со слов пациента</span>
          </div>
          {/* Три колонки, а не четыре: на узком экране четвёртая давала
              горизонтальную прокрутку. Действующее вещество ушло под название —
              на бумаге так тоже читается лучше. */}
          <table className="report-drugs">
            <thead>
              <tr>
                <th>Препарат</th>
                <th>Дозировка</th>
                <th>Схема приёма</th>
              </tr>
            </thead>
            <tbody>
              {[...medicines]
                .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
                .map((item) => {
                  const perDay = perDayOf(item, Date.now())
                  const inn = item.inn && item.inn.toLowerCase() !== item.name.toLowerCase() ? item.inn : null
                  return (
                    <tr key={item.regimenId}>
                      <td>
                        {item.name}
                        {/* Врачу это нужнее всех: список «что принимает» без
                            пометки уравнивает назначенный препарат с добавкой
                            из аптеки у дома. */}
                        {item.kind && <span className="kind-tag">{KIND_LABEL[item.kind]}</span>}
                        {inn && <div className="muted">{inn}</div>}
                      </td>
                      <td>
                        {item.dose || '—'}
                        {item.form && <div className="muted">{item.form.toLowerCase()}</div>}
                      </td>
                      <td>
                        {item.times?.length
                          ? `${item.times.join(', ')}${describeRhythm(item.rhythm) ? `, ${describeRhythm(item.rhythm)}` : ''}${MEAL_NOTE[item.meal ?? 'any']}`
                          : perDay !== null
                            ? `${perDay} ${plural(perDay, 'раз', 'раза', 'раз')} в сутки`
                            : 'по потребности'}
                        {item.note && <div className="muted">{item.note}</div>}
                      </td>
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      )}

      {medicines.length > 0 && <Adherence medicines={medicines} from={periodFrom} now={Date.now()} />}

      {summary && (
        <div className="card">
          <div className="card__head">
            <h2>Измерения по дням</h2>
            <span className="muted">
              дней с записями: {дневник.length}
              {пропущено > 0 && ` · без записей: ${пропущено}`}
            </span>
          </div>

          {/* На телефоне таблица шире экрана — прокручивается сама, а не
              растягивает страницу. На бумаге ширины хватает, и там обёртка
              ничего не меняет. */}
          <div className="diary__wrap">
          <table className="diary">
            <thead>
              <tr>
                <th scope="col">День</th>
                {ЧАСТИ.map((part) => (
                  <th key={part} scope="col">
                    {ЧАСТЬ_КРАТКО[part]}
                  </th>
                ))}
                {дневник.some((день) => день.intake !== null) && <th scope="col">Приём</th>}
              </tr>
            </thead>
            <tbody>
              {дневник.map((день) => (
                <tr key={день.day}>
                  <th scope="row" className="diary__day">
                    {ДЕНЬ_МЕСЯЦ.format(день.day)}
                  </th>
                  {ЧАСТИ.map((part) => {
                    const cell = день.cells[part]
                    return (
                      <td key={part} className="diary__cell">
                        {cell ? (
                          <>
                            <span className="diary__value">
                              {cell.sys}/{cell.dia}
                            </span>
                            <span className="diary__note">
                              {cell.time}
                              {cell.bpm !== null && ` · ${cell.bpm}`}
                              {cell.count > 1 && ` · ${cell.count} замера`}
                            </span>
                          </>
                        ) : (
                          <span className="diary__empty">—</span>
                        )}
                      </td>
                    )
                  })}
                  {день.intake !== null && <td className="diary__intake">{день.intake ? 'да' : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {/* Правило свёртки печатается рядом с таблицей, а не прячется в
              коде: это обработка данных, и врач вправе знать, что за одной
              строкой стоят три замера. */}
          {дневник.some((день) => Object.values(день.cells).some((c) => c && c.count > 1)) && (
            <p className="muted" style={{ marginTop: 'var(--space-3)' }}>
              {SERIES_RULE}
            </p>
          )}

          <details style={{ marginTop: 'var(--space-4)' }}>
            <summary>Все измерения по одному</summary>
            <div style={{ marginTop: 'var(--space-3)' }}>
              <Readings readings={readings} />
            </div>
          </details>
        </div>
      )}

      {glucoseSummary && (
        <div className="card">
          <div className="card__head">
            <h2>Все замеры сахара за период</h2>
          </div>
          <GlucoseList readings={glucoseReadings} targets={glucoseTargets} />
        </div>
      )}

      <div className="muted" style={{ lineHeight: 1.6 }}>
        {medicines.length > 0 && (
          <>
            Перечень препаратов внесён пациентом самостоятельно и не является выпиской из назначений.{' '}
            {medicines.some((m) => m.kind) && (
              <>
                Пометкой «БАД» отмечены биологически активные добавки к пище, пометкой «гомеопатия» — гомеопатические
                средства; сведения взяты из государственных реестров по названию препарата.{' '}
              </>
            )}
          </>
        )}
        Дневник самоконтроля, ведёт пациент. Не медицинское заключение и не замена осмотру врача.
        <details style={{ marginTop: 'var(--space-2)' }}>
          <summary>Как получены данные</summary>
          <div style={{ marginTop: 'var(--space-2)' }}>
        Данные давления выгружены из тонометра Omron RS7 Intelli IT (HEM-6232T) и дополнены записями, внесёнными
        вручную; даты и время соответствуют часам прибора. Категории давления приведены по классификации ESC/ESH для
        измерений в кабинете, порогом нормы для домашних измерений принято {targetSys}/{targetDia} мм рт. ст. Оценка
        сахара дана относительно целевых значений {glucoseTargets.fastingMax.toFixed(1)} ммоль/л натощак и{' '}
        {glucoseTargets.postMealMax.toFixed(1)} ммоль/л через два часа после еды.
          </div>
        </details>
      </div>
    </div>
  )
}
