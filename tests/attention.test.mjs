/**
 * Цепочка пометок: подсвечено сверху — подсвечено и внутри.
 *
 * Правило владельца: если точка горит в шапке или на вкладке, то и в самом
 * разделе нужный пункт обязан гореть, иначе человек знает, что где-то есть
 * дело, но не знает где. До этого цепочка рвалась молча — просроченная копия
 * зажигала шапку «Настроек», а внутри все девять строк выглядели одинаково.
 *
 * Поэтому здесь проверяется не каждое условие по отдельности, а само правило:
 * у любого дела есть место, и место это находится с обоих концов.
 */
import { attentionOf, attentionIn, attentionAt, attentionOn } from './build/api.mjs'

const пусто = { backup: null, namesakes: [], updates: 0, alerts: 0, restock: 0, pending: 0 }

export function run() {
  let failures = 0
  const check = (name, condition, detail = '') => {
    if (condition) console.log(`  ok   ${name}`)
    else {
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
      failures++
    }
  }

  check('в чистом дневнике не горит ничего', attentionOf(пусто).length === 0)

  // ── главное правило: у каждого дела есть место, и оно находится ─────────
  const всё = attentionOf({
    backup: 'stale',
    namesakes: ['Я'],
    updates: 2,
    alerts: 3,
    restock: 1,
    pending: 4,
  })
  check('все шесть дел названы', всё.length === 6, String(всё.length))
  check('у каждого есть раздел', всё.every((a) => typeof a.tab === 'string' && a.tab !== ''))
  check('у каждого есть, что сказать словами', всё.every((a) => a.title.trim() !== ''))
  // Дело либо лежит на подэкране, либо в части экрана, либо прямо в разделе —
  // но в любом случае находится по тому же ключу, по которому его помечают.
  check(
    'каждое дело находится там, куда указывает',
    всё.every((a) => {
      const поРазделу = attentionIn(всё, a.tab) !== null
      const поПодэкрану = a.sub ? attentionAt(всё, a.sub)?.sub === a.sub : true
      const поЧасти = a.section ? attentionOn(всё, a.section)?.section === a.section : true
      return поРазделу && поПодэкрану && поЧасти
    }),
  )

  // ── шапка «Настроек» и её строки ───────────────────────────────────────
  {
    const копия = attentionOf({ ...пусто, backup: 'stale' })
    check('копия зажигает «Настройки»', attentionIn(копия, 'settings') !== null)
    check('и именно строку копии', attentionAt(копия, 'backup')?.key === 'backup')
    check('а не строку людей', attentionAt(копия, 'people') === null)
    check('словами сказано, что не так', attentionAt(копия, 'backup')?.title === 'копия устарела')

    check('копии не было вовсе — свои слова', attentionOf({ ...пусто, backup: 'never' })[0].title === 'копии дневника ещё не было')
    check('копия отстала — свои', attentionOf({ ...пусто, backup: 'behind' })[0].title === 'в копию не попали свежие записи')
  }

  // ── обновление: до этой правки оно не зажигало ничего ──────────────────
  {
    const один = attentionOf({ ...пусто, updates: 1 })
    check('обновление зажигает «Настройки»', attentionIn(один, 'settings')?.key === 'update')
    check('и строку «О приложении»', attentionAt(один, 'about')?.key === 'update')
    check('про один выпуск — в единственном числе', один[0].title === 'вышла новая версия')
    check('про несколько — числом', attentionOf({ ...пусто, updates: 3 })[0].title === 'вышло 3 обновления')
  }

  // ── тёзки ──────────────────────────────────────────────────────────────
  {
    const тёзки = attentionOf({ ...пусто, namesakes: ['Я', 'Оля'] })
    check('тёзки ведут в «Пользователи»', attentionAt(тёзки, 'people')?.key === 'namesakes')
    check('и названы поимённо', тёзки[0].title === 'двое с одним именем: Я, Оля')
  }

  // ── аптечка: два разных дела в двух разных разделах полосы ─────────────
  {
    const оба = attentionOf({ ...пусто, alerts: 2, restock: 1 })
    check('аптечка зажигается', attentionIn(оба, 'cabinet') !== null)
    check('предупреждения — в «Коробках»', attentionOn(оба, 'boxes')?.key === 'stock')
    check('покупки — в «Купить»', attentionOn(оба, 'buy')?.key === 'restock')
    // Ровно та щель, ради которой раздел и назван: точка на вкладке вела в
    // «Коробки», а купить надо было в «Купить».
    const только = attentionOf({ ...пусто, restock: 2 })
    check('одни покупки — «Коробки» чисты', attentionOn(только, 'boxes') === null)
    check('а «Купить» горит', attentionOn(только, 'buy')?.title === 'купить: 2')
  }

  // ── приём: дело лежит прямо в разделе, подэкрана у него нет ────────────
  {
    const приём = attentionOf({ ...пусто, pending: 2 })
    check('приём зажигает свою вкладку', attentionIn(приём, 'intake')?.key === 'intake')
    check('и говорит, сколько осталось', приём[0].title === 'осталось отметить: 2')
    check('подэкрана у него нет', приём[0].sub === undefined)
  }

  // ── порядок: дороже — выше ─────────────────────────────────────────────
  {
    const вместе = attentionOf({ ...пусто, backup: 'never', updates: 1 })
    check('потерянный дневник важнее непрочитанного выпуска', вместе[0].key === 'backup')
  }

  return failures
}
