import { useEffect, useRef, useState } from 'react'
import { useFormDraft } from './useDraftState'
import { FormDraftNotice } from './FormDraftNotice'
import type { Medicine, QuantityUnit } from '../types'
import { expiryToMonth, monthToExpiry } from '../logic/medicines'
import { FORM_GROUPS, normalize, variantsOf, type Drug, type DrugVariant } from '../logic/drugs'
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
  draftOwner = 'local',
  draftKey,
  initialName = '',
  saveLabel = 'Сохранить',
  onSave,
  onCancel,
}: {
  medicine?: Medicine
  draftOwner?: string
  draftKey?: string
  initialName?: string
  saveLabel?: string
  onSave: (item: Medicine) => Promise<void>
  onCancel: () => void
}) {
  const draft = useFormDraft(`medicine:${draftKey ?? (medicine ? `existing:${medicine.id}` : `new:${draftOwner}`)}`, medicine ?? null)
  const [name, setName] = draft.field('name', medicine?.name ?? initialName)
  const [dose, setDose] = draft.field('dose', medicine?.dose ?? '')
  const [left, setLeft] = draft.field('left', medicine?.left !== null && medicine?.left !== undefined ? String(medicine.left) : '')
  const [month, setMonth] = draft.field('month', medicine?.expires ? expiryToMonth(medicine.expires) : '')
  const [note, setNote] = draft.field('note', medicine?.note ?? '')
  const [inn, setInn] = draft.field('inn', medicine?.inn ?? '')
  const [form, setForm] = draft.field('form', medicine?.form ?? '')
  const [maker, setMaker] = draft.field('maker', medicine?.maker ?? '')
  /**
   * Для чего его держат — полка в шкафу.
   *
   * Подсказка появляется при выборе препарата из реестра и только в пустое
   * поле: в уже заведённую коробку категория не проставляется молча, а то,
   * что человек написал сам, не переписывается. Он назвал полку своими
   * словами, и это вернее любой таблицы.
   */
  const [purpose, setPurpose] = draft.field('purpose', medicine?.purpose ?? '')
  const [rx, setRx] = draft.field('rx', medicine?.rx ?? false)
  /** Человек тронул галку сам — справочник больше не вмешивается. */
  const [rxTouched, setRxTouched] = draft.field('rxTouched', false)
  const [rxSuggestion, setRxSuggestion] = useState(false)
  /** БАД или гомеопатия — из справочника. Обычное лекарство пометки не несёт. */
  const [kind, setKind] = draft.field<Medicine['kind']>('kind', medicine?.kind)
  const [packSize, setPackSize] = draft.field('packSize', medicine?.packSize ? String(medicine.packSize) : '')
  const [dropsPerMl, setDropsPerMl] = draft.field('dropsPerMl', medicine?.dropsPerMl ? String(medicine.dropsPerMl) : '')
  const [packs, setPacks] = draft.field<number[]>('packs', [])
  const [catalogChoicePending, setCatalogChoicePending] = draft.field('catalogChoicePending', false)
  const [searchConfirmed, setSearchConfirmed] = draft.field('searchConfirmed', !!medicine)
  const [packPicked, setPackPicked] = draft.field('packPicked', false)
  const [reviewAfterNameChange, setReviewAfterNameChange] = draft.field('reviewAfterNameChange', false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [purposeOpen, setPurposeOpen] = useState(false)
  const [warningsOpen, setWarningsOpen] = useState(false)
  const [warningFocus, setWarningFocus] = useState<'supply' | 'expiry' | null>(null)
  const supplyWarningRef = useRef<HTMLInputElement>(null)
  const expiryWarningRef = useRef<HTMLInputElement>(null)
  /** Группа формы сужает поиск: человек держит коробку и знает, таблетки это или мазь. */
  const [group, setGroup] = draft.field('group', '')
  /** Варианты выпуска выбранного препарата: форма и её дозировки. */
  const [variants, setVariants] = draft.field<DrugVariant[]>('variants', [])
  /** Человек выбрал «Своя формулировка» — показываем поле вместо списка. */
  const [своя, setСвоя] = draft.field('своя', false)
  // Единицы зависят от формы выпуска: у капель упаковка в миллилитрах, а приём
  // в каплях, и подписи полей обязаны это говорить.
  const формыПрепарата = variants.map((v) => v.form).filter(Boolean)
  const initialUnits = medicine ? { stockUnit: stockUnitOf(medicine), doseUnit: doseUnitOf(medicine) } : { stockUnit: 'piece' as const, doseUnit: 'piece' as const }
  const [stockUnit, setStockUnit] = draft.field<QuantityUnit>('stockUnit', initialUnits.stockUnit)
  const [doseUnit, setDoseUnit] = draft.field<QuantityUnit>('doseUnit', initialUnits.doseUnit)
  const [supplyWarning, setSupplyWarning] = draft.field('supplyWarning', String(medicine?.supplyWarningDays ?? ''))
  const [expiryWarning, setExpiryWarning] = draft.field('expiryWarning', String(medicine?.expiryWarningDays ?? ''))
  const [unitConfirmed, setUnitConfirmed] = draft.field('unitConfirmed', false)
  const unitsChanged = !!medicine && (stockUnit !== initialUnits.stockUnit || doseUnit !== initialUnits.doseUnit)
  const chosenVariant = variants.find((variant) => variant.form === form)
  const knownDoses = chosenVariant?.doses ?? (variants.length === 1 ? variants[0].doses : [])
  const requiresPackChoice = packs.length > 0 && ['piece', 'sachet', 'ampoule'].includes(stockUnit)
  const variantChoiceReady = (!variants.length || !!form) && (!knownDoses.length || !!dose.trim()) && (!requiresPackChoice || packPicked)
  const canShowMedicineFields = !!medicine || searchConfirmed
  const canSubmit = !catalogChoicePending && (!!medicine || (canShowMedicineFields && variantChoiceReady))
  useEffect(() => {
    if (!warningFocus || !purposeOpen || !warningsOpen) return
    const input = warningFocus === 'supply' ? supplyWarningRef.current : expiryWarningRef.current
    input?.focus()
    setWarningFocus(null)
  }, [warningFocus, purposeOpen, warningsOpen])
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
    event.stopPropagation()
    if (draft.conflict) return
    if (name.trim() === '') {
      setError('Без названия препарат не найти в списке.')
      return
    }
    if (unitsChanged && !unitConfirmed) { setError('Подтвердите единицы и заново проверьте остаток и размер упаковки. Старые курсы сохранят прежние единицы; проверьте их отдельно.'); return }
    if (doseUnit === 'drop' && !(Number(dropsPerMl) > 0)) { setError('Укажите число капель в 1 мл из инструкции к этому препарату.'); return }
    const invalidWarning = (value: string) => value.trim() !== '' && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 365)
    const invalidSupplyWarning = invalidWarning(supplyWarning)
    const invalidExpiryWarning = invalidWarning(expiryWarning)
    if (invalidSupplyWarning || invalidExpiryWarning) {
      setPurposeOpen(true)
      setWarningsOpen(true)
      setWarningFocus(invalidSupplyWarning ? 'supply' : 'expiry')
      setError('Срок предупреждения: целое число от 0 до 365 дней.')
      return
    }
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
      draft.clear()
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
        <button type="submit" className="btn btn--primary" disabled={busy || draft.conflict || !canSubmit}>
          {saveLabel}
        </button>
        <button type="button" className="btn" onClick={() => { draft.clear(); onCancel() }} disabled={busy}>
          Отмена
        </button>
      </div>
      <FormDraftNotice conflict={draft.conflict} onReload={draft.clear} onKeep={draft.keep} />
      <DrugPicker
        group={group}
        onGroupChange={setGroup}
        groupOptions={FORM_GROUPS.map(({ key, title }) => ({ key, title }))}
        compactSearch
        manualChosen={!medicine && searchConfirmed && variants.length === 0}
        onManual={() => { setCatalogChoicePending(false); setSearchConfirmed(true); setVariants([]); setPacks([]); setRxSuggestion(false) }}
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

          // Отсутствие rx у старой карточки — сохранённое состояние. Для новой
          // карточки только показываем предложение: решение должно быть явным.
          if (medicine || rxTouched) return
          setRxSuggestion(найдено?.r === 1)
        }}
        onChange={(next) => {
          setRxSuggestion(false)
          if (!medicine && variants.length > 0) setReviewAfterNameChange(true)
          setName(next)
          // Правка названия руками отвязывает карточку от реестра: варианты
          // могли относиться к другому препарату. Сами поля не трогаем —
          // теперь они видимые и заполнены человеком либо справочником, и
          // стирать их за спиной нельзя: опечатку в названии правят чаще, чем
          // меняют сам препарат.
          setKind(undefined)
          setVariants([])
          setPacks([])
          setCatalogChoicePending(false)
          setSearchConfirmed(false)
          setPackPicked(false)
        }}
        onPick={(drug: Drug, picked: DrugVariant[], drugMakers: string[]) => {
          setName(drug.n)
          setInn(drug.i ?? '')
          // Выбор из реестра не должен молча менять скрытую настройку. Для
          // новой коробки предложим рецептурность рядом с краткой сводкой.
          if (!medicine && !rxTouched) setRxSuggestion(drug.r === 1)
          setVariants(picked)
          setMaker(drugMakers[0] ?? '')
          setKind(drug.k)
          // Категорию предлагаем только в пустое поле: своё название полки
          // дороже подсказанного.
          setPurpose((было) => было || (suggestPurpose({ name: drug.n, inn: drug.i }) ?? ''))
          // Even a single known match is confirmed explicitly against the pack.
          setForm('')
          setDose('')
          setPackSize('')
          setPackPicked(false)
          setPacks([])
          setCatalogChoicePending(picked.length > 0)
          setSearchConfirmed(picked.length === 0)
        }}
      />

      {catalogChoicePending && (
        <section className="medicine-variant-choice" aria-label="Уточните препарат">
          <p className="muted">Сверьте с упаковкой. Даже если вариант один, подтвердите форму, дозировку и размер пачки.</p>
          <VariantPicker variants={variants} form={form} dose={dose} requireExplicit
            onForm={(next) => {
              chooseForm(next)
              setDose('')
              setPackPicked(false)
              setPacks(variants.find((variant) => variant.form === next)?.packs ?? [])
            }}
            onDose={setDose}
          />
          {requiresPackChoice && <div>
            <div className="tile__label" style={{ marginBottom: 'var(--space-2)' }}>Размер упаковки</div>
            <div className="chips" role="group" aria-label="Размеры упаковки из реестра">
              {packs.map(size => <button key={size} type="button" className="chip" aria-pressed={packPicked && Number(packSize) === size} onClick={() => { setPackSize(String(size)); setPackPicked(true) }}>{size} {единицы.pack}</button>)}
            </div>
          </div>}
          <button type="button" className="btn btn--primary" disabled={!variantChoiceReady} onClick={() => { setCatalogChoicePending(false); setSearchConfirmed(true) }}>
            Продолжить
          </button>
        </section>
      )}

      {canShowMedicineFields && <>
      <div className="medicine-selected-summary" role="status">
        <strong>{name}</strong>{dose.trim() && <> · {dose}</>}{form && <> · {form}</>}{packSize && <> · упаковка {packSize} {единицы.pack}</>}
        {medicine && <span className="muted"> · препарат уже в аптечке</span>}
      </div>
      {rxSuggestion && <p className="muted" role="note">В справочнике препарат отмечен как рецептурный. <button type="button" className="btn btn--small" onClick={() => { setRx(true); setRxTouched(true); setRxSuggestion(false); setPurposeOpen(true); setWarningsOpen(true) }}>Подтвердить</button></p>}
      {reviewAfterNameChange && <p className="muted" role="note">Название изменено. Проверьте форму, дозировку, единицы, упаковку и остаток перед сохранением.</p>}
      <details className="medicine-extra-details" open={detailsOpen} onToggle={event => setDetailsOpen(event.currentTarget.open)}>
      <summary>Сведения о препарате</summary>
      <div className="stack" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
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
          setPackPicked(false)
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
                setDose('')
                setPackPicked(false)
                setPacks([])
                return
              }
              chooseForm(id)
              setDose('')
              setPackPicked(false)
              setPacks(variants.find((v) => v.form === id)?.packs ?? [])
            }}
          />
        ) : (
          <input value={form} onChange={(e) => {
            chooseForm(e.target.value)
            setDose('')
            setPackPicked(false)
            setPacks([])
          }} placeholder="Таблетки" />
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
      </div>
      </details>

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
                onClick={() => { setPackSize(String(size)); setPackPicked(true) }}
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

      <Field label="Годен до — месяц с упаковки">
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      </Field>

      <details className="medicine-extra-details" open={purposeOpen} onToggle={event => setPurposeOpen(event.currentTarget.open)}>
      <summary>Назначение и напоминания</summary>
      <div className="stack" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
      <div>
        <label className="badge">
          <input
            type="checkbox"
            checked={rx}
            onChange={(e) => {
              setRxTouched(true)
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

      <details open={warningsOpen} onToggle={event => setWarningsOpen(event.currentTarget.open)}>
        <summary>Когда предупреждать об этом препарате</summary>
        <p className="muted">Пустое поле — общая настройка. 0 — в день окончания. Предупреждение о покупке появляется при наличии действующего курса.</p>
        <div className="grid grid--two">
          <NumberField inputRef={supplyWarningRef} label="До конца запаса, дней" value={supplyWarning} onChange={setSupplyWarning} min={0} max={365} start={7} placeholder="Общее" />
          <NumberField inputRef={expiryWarningRef} label="До конца годности, дней" value={expiryWarning} onChange={setExpiryWarning} min={0} max={365} start={7} placeholder="Общее" />
        </div>
      </details>
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
      </div>
      </details>

      {error && (
        <div className="pill__alert pill__alert--critical" role="alert">
          {error}
        </div>
      )}
      </>}
    </form>
  )
}
