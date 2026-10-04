import { useRef, useState } from 'react'
import type { Medicine, QuantityUnit } from '../types'
import { expiryToMonth, monthToExpiry } from '../logic/medicines'
import { formGroup as formGroupOf, FORM_GROUPS, normalize, variantsOf, type Drug, type DrugVariant } from '../logic/drugs'
import { NumberField } from './NumberField'
import { Field } from './bits'
import { DrugPicker, VariantPicker } from './DrugPicker'
import { MenuButton } from './Picker'
import { DROPS_PER_ML, dosesInPack, needsDropSize, unitsOf, stockUnitOf, doseUnitOf, UNIT_LABELS } from '../logic/units'
import { newMedicineUnits, packagingOf } from '../logic/packaging'
import { substanceLabel } from './Medicines'
import { PURPOSE_HINTS, suggestPurpose } from '../logic/cabinet'

/**
 * Заведение и правка коробки: что лежит в шкафу.
 *
 * Вынесено из общего файла аптечки: форма живёт своей жизнью и по объёму равна
 * целому экрану, а рядом с ней в одном файле лежали список, приёмы и покупки.
 *
 * Курса приёма здесь нет с 0.42.0 — он уехал на свой экран
 * (`RegimenForm.tsx`). Коробка отвечает на вопрос «что это и сколько его
 * осталось», курс — на «кто это принимает и когда»; смешанные в одной форме,
 * они заставляли человека, менявшего время приёма, идти через производителя и
 * размер упаковки.
 */

/** Псевдовариант в списке форм: за ним прячется свободный ввод. */
const СВОЯ_ФОРМА = '\u0000своя'

/**
 * Форма коробки. Раскрывается на месте, как и правка измерения: модальное окно
 * на телефоне отбирает весь экран ради четырёх полей.
 */
export function MedicineForm({
  medicine,
  onSave,
  onCancel,
}: {
  medicine?: Medicine
  onSave: (item: Medicine) => Promise<void>
  onCancel: () => void
}) {
  const [name, setName] = useState(medicine?.name ?? '')
  const [dose, setDose] = useState(medicine?.dose ?? '')
  const [left, setLeft] = useState(medicine?.left !== null && medicine?.left !== undefined ? String(medicine.left) : '')
  const [month, setMonth] = useState(medicine?.expires ? expiryToMonth(medicine.expires) : '')
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
  // Единицы зависят от формы выпуска: у капель упаковка в миллилитрах, а приём
  // в каплях, и подписи полей обязаны это говорить.
  const формыПрепарата = variants.map((v) => v.form).filter(Boolean)
  // Группы сужаются до тех, что есть у выбранного препарата. Ничего не
  // подтянулось — показываем все: домашняя аптечка шире реестра.
  const доступныеГруппы =
    формыПрепарата.length > 0
      ? FORM_GROUPS.filter((g) => формыПрепарата.some((f) => formGroupOf(f) === g.key))
      : FORM_GROUPS
  const initialUnits = medicine ? { stockUnit: stockUnitOf(medicine), doseUnit: doseUnitOf(medicine) } : { stockUnit: 'piece' as const, doseUnit: 'piece' as const }
  const [stockUnit, setStockUnit] = useState<QuantityUnit>(initialUnits.stockUnit)
  const [doseUnit, setDoseUnit] = useState<QuantityUnit>(initialUnits.doseUnit)
  const [supplyWarning, setSupplyWarning] = useState(String(medicine?.supplyWarningDays ?? ''))
  const [expiryWarning, setExpiryWarning] = useState(String(medicine?.expiryWarningDays ?? ''))
  const [unitConfirmed, setUnitConfirmed] = useState(false)
  const unitsChanged = !!medicine && (stockUnit !== initialUnits.stockUnit || doseUnit !== initialUnits.doseUnit)
  const chooseForm = (next: string, drugName = name) => {
    setForm(next)
    if (medicine) return
    const inferred = newMedicineUnits(drugName,next)
    setStockUnit(inferred.stockUnit); setDoseUnit(inferred.doseUnit)
    setPackSize('')
  }
  const единицы = unitsOf({ form, stockUnit, doseUnit })
  const капельВоФлаконе = dosesInPack({
    form, stockUnit, doseUnit,
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
    if (unitsChanged && !unitConfirmed) { setError('Подтвердите единицы и заново проверьте остаток и размер упаковки. Старые курсы сохранят прежние единицы; проверьте их отдельно.'); return }
    if (doseUnit === 'drop' && !(Number(dropsPerMl) > 0)) { setError('Укажите число капель в 1 мл из инструкции к этому препарату.'); return }
    if ([supplyWarning, expiryWarning].some(v => v.trim() && (!Number.isInteger(Number(v)) || Number(v) < 0 || Number(v) > 365))) { setError('Срок предупреждения: целое число от 0 до 365 дней.'); return }
    setBusy(true)
    setError(null)
    try {
      const коробка: Medicine = {
        ...medicine,
        stockUnit, doseUnit,
        manualDeductions: unitsChanged || numberOrNull(left) !== (medicine?.left ?? null) ? undefined : medicine?.manualDeductions,
        stockLedgerVersion: unitsChanged || numberOrNull(left) !== (medicine?.left ?? null) ? undefined : medicine?.stockLedgerVersion,
        stockUpdatedAt: unitsChanged || numberOrNull(left) !== (medicine?.left ?? null) ? Date.now() : medicine?.stockUpdatedAt,
        supplyWarningDays: supplyWarning.trim() ? Number(supplyWarning) : undefined,
        expiryWarningDays: expiryWarning.trim() ? Number(expiryWarning) : undefined,
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
        dropsPerMl: Number(dropsPerMl) > 0 ? Number(dropsPerMl) : medicine?.dropsPerMl,
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
        leftAt: !unitsChanged && numberOrNull(left) === (medicine?.left ?? null) ? medicine?.leftAt : Date.now(),
      }

      await onSave(коробка)
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
          chooseForm(only?.form ?? '', drug.n)
          setPacks(only?.packs ?? [])
          if (only?.doses.length === 1) setDose(only.doses[0])
        }}
      />

      <VariantPicker
        variants={variants}
        form={form}
        dose={dose}
        onForm={(next) => {
          chooseForm(next)
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
              chooseForm(id)
              setPacks(variants.find((v) => v.form === id)?.packs ?? [])
            }}
          />
        ) : (
          <input value={form} onChange={(e) => chooseForm(e.target.value)} placeholder="Таблетки" />
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

      <div className="grid grid--two">
        <Field label="Запас измеряется в">
          <select aria-label="Запас измеряется в" value={stockUnit} onChange={e => { const next = e.target.value as QuantityUnit; setStockUnit(next); setDoseUnit(next); setLeft(''); setPackSize(''); setUnitConfirmed(false) }}>
            {Object.entries(UNIT_LABELS).filter(([u]) => u !== 'drop').map(([u,label]) => <option value={u} key={u}>{label}</option>)}
          </select>
        </Field>
        <Field label="Расход за приём в">
          <select aria-label="Расход за приём в" value={doseUnit} onChange={e => { setDoseUnit(e.target.value as QuantityUnit); setUnitConfirmed(false) }}>
            {[stockUnit, ...(stockUnit === 'ml' ? ['drop' as const] : [])].map(u => <option value={u} key={u}>{UNIT_LABELS[u]}</option>)}
          </select>
        </Field>
      </div>
      {packagingOf(name,form) && <p className="muted">{packagingOf(name,form)!.description}</p>}
      {unitsChanged && <label className="unit-confirmation"><input type="checkbox" checked={unitConfirmed} onChange={e => setUnitConfirmed(e.target.checked)} /><span>Проверил новые единицы, остаток и упаковку. Проверю единицы старых курсов отдельно.</span></label>}
      <div>
        <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>
          Сколько в упаковке
        </div>
        {packs.length > 0 && ['piece','sachet','ampoule'].includes(stockUnit) && (
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
            min={0.1}
            step={0.1}
            decimals={2}
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
        {needsDropSize({ form, stockUnit, doseUnit }) && (
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
              Число зависит от препарата и капельницы. Возьмите его из инструкции; без него перевод в миллилитры не рассчитывается.
              {капельВоФлаконе !== null && <> Во флаконе выйдет около {капельВоФлаконе} капель.</>}
            </div>
          </div>
        )}
      </div>

      {/* Единица рядом с числом: «10» у флакона капель это миллилитры, а у
          пачки таблеток штуки, и по самому полю не догадаться. Расход в день
          спрашивает курс приёма — он же знает расписание. */}
      <div style={{ maxWidth: '11rem' }}>
        <NumberField
          label="Осталось"
          value={left}
          onChange={setLeft}
          placeholder="30"
          min={0}
          step={0.1}
          decimals={2}
          max={999}
          start={30}
          unit={единицы.pack}
          size="compact"
        />
      </div>

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
            ? 'Срок предупреждения можно настроить ниже.'
            : 'Срок предупреждения берётся из настроек или задаётся ниже.'}
        </p>
      </div>

      <details>
        <summary>Когда предупреждать об этом препарате</summary>
        <p className="muted">Пустое поле — общая настройка. 0 — в день окончания. Предупреждение о покупке появляется при наличии действующего курса.</p>
        <div className="grid grid--two">
          <NumberField label="До конца запаса, дней" value={supplyWarning} onChange={setSupplyWarning} min={0} max={365} start={7} placeholder="Общее" />
          <NumberField label="До конца годности, дней" value={expiryWarning} onChange={setExpiryWarning} min={0} max={365} start={7} placeholder="Общее" />
        </div>
      </details>
      <Field label="Годен до — месяц с упаковки">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
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
