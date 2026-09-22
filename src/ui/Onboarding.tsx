/**
 * Знакомство при первом запуске.
 *
 * Два вопроса, оба пропускаемые, и оба — про предпочтения, а не про человека.
 * Ни имени, ни возраста здесь нет и не будет: на отсутствии персональных данных
 * держится правовое положение приложения, а подстройка «по возрасту» промахнётся
 * чаще, чем попадёт — плохо видеть можно в тридцать, а в семьдесят пять работать
 * программистом.
 *
 * Первый вопрос убирает лишнее: человеку, которому нужны только лекарства, не
 * нужны три экрана про давление. Второй — про размер текста, потому что найти
 * его потом в настройках догадается не всякий, а увидев образец, человек решает
 * за секунду.
 *
 * Показывается один раз и только на пустом дневнике: тому, кто обновился с
 * записями, знакомиться уже не с чем.
 */

import { useState } from 'react'
import { PURPOSE } from '../logic/disclaimer'
import type { Settings as SettingsData, TextScale } from '../types'

const ЧТО_ВЕСТИ = [
  { key: 'bp', title: 'Давление', hint: 'записи с тонометра и вручную, графики, отчёт врачу' },
  { key: 'meds', title: 'Лекарства', hint: 'расписание приёма, напоминания, запас и сроки годности' },
  { key: 'glucose', title: 'Сахар крови', hint: 'если ведёте дневник при диабете' },
] as const

type Что = (typeof ЧТО_ВЕСТИ)[number]['key']

const РАЗМЕРЫ: { key: TextScale; title: string }[] = [
  { key: 'small', title: 'Мельче' },
  { key: 'normal', title: 'Обычный' },
  { key: 'large', title: 'Крупный' },
  { key: 'xlarge', title: 'Очень крупный' },
]

export function Onboarding({
  settings,
  onApply,
  шаг,
  onШаг,
}: {
  settings: SettingsData
  /** Сохранить выбор и уйти в приложение. */
  onApply: (patch: Partial<SettingsData>) => void
  /**
   * Какой шаг показывать. Снаружи, а не своим состоянием: аппаратная «Назад»
   * на втором шаге должна возвращать на первый, а знает о ней только то место,
   * где живёт вся глубина приложения.
   */
  шаг: 1 | 2
  onШаг: (next: 1 | 2) => void
}) {
  const [выбрано, setВыбрано] = useState<Set<Что>>(new Set(['bp', 'meds']))
  const [размер, setРазмер] = useState<TextScale>(settings.textScale)

  function переключить(key: Что) {
    const next = new Set(выбрано)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setВыбрано(next)
  }

  function завершить(применять: boolean) {
    // «Пропустить» на втором шаге не должно отменять первый: человек уже
    // ответил, что вести, и уже выбрал размер — он пропускает остаток, а не
    // отказывается от сделанного. Размер к тому же уже применён к экрану:
    // не сохранив его, приложение показывало бы одно, а помнило другое.
    if (!применять && шаг === 1) {
      // На первом шаге пропускать нечего: ответов ещё нет.
      onApply({ onboarded: true, textScale: размер })
      return
    }

    const bp = выбрано.has('bp')
    const meds = выбрано.has('meds')
    const glucose = выбрано.has('glucose')

    // Хотя бы один раздел обязан остаться: приложение без разделов — пустой
    // экран без объяснений. Ничего не выбрал — оставляем всё как было.
    const пусто = !bp && !meds && !glucose
    onApply({
      onboarded: true,
      textScale: размер,
      ...(пусто
        ? {}
        : {
            sections: { overview: bp, bp, glucose, intake: meds, cabinet: meds },
            trackGlucose: glucose,
            startTab: bp ? 'overview' : 'intake',
          }),
    })
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__title">
          <h1>Дневник здоровья</h1>
          <span className="topbar__sub">давление, сахар и лекарства</span>
        </div>
      </header>

      <div className="card">
        <div className="card__head">
          <h2>{шаг === 1 ? 'Что будете вести?' : 'Каким размером читать?'}</h2>
          <span className="muted">шаг {шаг} из 2</span>
        </div>

        {шаг === 1 ? (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Лишние разделы уберём с глаз. Всё это меняется потом в настройках.
            </p>
            <div className="stack" style={{ gap: 'var(--space-2)' }}>
              {ЧТО_ВЕСТИ.map((item) => (
                <label key={item.key} className="optrow__label">
                  <input type="checkbox" checked={выбрано.has(item.key)} onChange={() => переключить(item.key)} />
                  <span className="optrow__title">
                    {item.title}
                    <span className="fact__note">{item.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Выберите так, чтобы читалось без усилий. Образец меняется сразу.
            </p>
            <div className="segmented segmented--fill segmented--stack" role="group" aria-label="Размер текста">
              {РАЗМЕРЫ.map((item) => (
                <button
                  key={item.key}
                  aria-pressed={размер === item.key}
                  onClick={() => {
                    setРазмер(item.key)
                    // Показываем размер на всём экране сразу, а не в одном
                    // блоке: выбирать по кусочку текста — гадание.
                    const root = document.documentElement
                    if (item.key === 'normal') delete root.dataset.text
                    else root.dataset.text = item.key
                  }}
                >
                  {item.title}
                </button>
              ))}
            </div>
            <div className="sample">
              <div style={{ fontSize: 'var(--fs-3)', fontWeight: 600 }}>Утренний приём — 08:00</div>
              <div style={{ fontSize: 'var(--fs-2)', marginTop: 'var(--space-2)' }}>Периндоприл 5 мг, до еды</div>
              <div className="muted" style={{ marginTop: 'var(--space-1)' }}>так будет выглядеть текст</div>
            </div>
          </>
        )}

        <div className="row" style={{ marginTop: 'var(--space-5)' }}>
          {шаг === 1 ? (
            <button className="btn btn--primary" onClick={() => onШаг(2)}>
              Дальше
            </button>
          ) : (
            <button className="btn btn--primary" onClick={() => завершить(true)}>
              Готово
            </button>
          )}
          <button className="btn" onClick={() => завершить(false)}>
            Пропустить
          </button>
        </div>

        {/* Назначение — на первом же экране, одной строкой. Человек должен
            узнать, с чем имеет дело, до того как начнёт вносить давление, а не
            найти это в «О приложении» через полгода. */}
        <div className="muted" style={{ marginTop: 'var(--space-5)' }}>
          {PURPOSE}
        </div>
      </div>
    </div>
  )
}
