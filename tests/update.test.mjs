/**
 * Обновление без магазина: сравнение версий и разбор выпуска.
 *
 * Приложение раздаётся файлом, и решение «есть ли что ставить» принимается
 * здесь. Ошибка стоит либо предложения поставить то, что уже стоит, либо
 * молчания о вышедшем обновлении — а устаревший телефон ломает семейный обмен
 * (BACKLOG §24б).
 */
import {
  compareVersions, newerThan, apkFrom, пораПроверять, ПРОВЕРЯТЬ_РАЗ_В,
  trimPartial, chunkCovers, КУСОК_ИСТОРИИ, publishedUpdates, releaseAddress,
} from './build/api.mjs'

const выпуск = (version) => ({ version, date: '24 сентября 2026', items: ['что-то'] })

export function run() {
  let failures = 0
  const check = (name, condition, detail = '') => {
    if (condition) console.log(`  ok   ${name}`)
    else {
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
      failures++
    }
  }

  // ── сравнение версий ─────────────────────────────────────────────────────
  //
  // Главная ловушка: строкой «0.9.0» больше «0.10.0», и приложение считало бы
  // девятую версию новее десятой. До 0.10.0 проекту осталось меньше десяти
  // выпусков, так что ошибка выстрелила бы почти сразу.
  check('десятая новее девятой', compareVersions('0.10.0', '0.9.0') > 0, 'строкой было бы наоборот')
  check('и сороковая новее девятой', compareVersions('0.40.0', '0.9.0') > 0)
  check('равные равны', compareVersions('0.41.0', '0.41.0') === 0)
  check('старая старше', compareVersions('0.40.0', '0.41.0') < 0)
  check('разная длина номера', compareVersions('1.0', '1.0.0') === 0)
  check('патч учитывается', compareVersions('0.41.1', '0.41.0') > 0)
  // Из чужого файла может прийти что угодно; падать на этом незачем.
  check('мусор не роняет', compareVersions('проба', '0.41.0') < 0)

  // ── что показывать как новое ─────────────────────────────────────────────
  const история = [выпуск('0.41.0'), выпуск('0.40.0'), выпуск('0.39.0'), выпуск('0.38.0')]
  const новое = newerThan(история, '0.39.0')
  check('берутся только те, что вышли после', новое.map((r) => r.version).join() === '0.41.0,0.40.0')
  check('своя версия не предлагается', newerThan(история, '0.41.0').length === 0)
  check('будущая версия своя — тоже ничего', newerThan(история, '0.99.0').length === 0)
  // Человек мог пропустить три выпуска: «что изменилось» для него — все три.
  check('пропущенные выпуски не теряются', newerThan(история, '0.38.0').length === 3)
  check('свежий первым', newerThan(история, '0.38.0')[0].version === '0.41.0')

  // ── файл обновления в ответе GitHub ──────────────────────────────────────
  const выпускJson = {
    assets: [
      { name: 'заметки.txt', browser_download_url: 'https://x/notes', size: 10 },
      { name: 'dnevnik-zdorovya_v0.41.0_2026-09-26.apk', browser_download_url: 'https://x/app.apk', size: 8_254_357 },
    ],
  }
  const файл = apkFrom(выпускJson)
  check('APK найден среди прочих файлов', файл?.url === 'https://x/app.apk', JSON.stringify(файл))
  check('и его размер взят', файл?.bytes === 8_254_357)
  check('выпуск без APK — обновлять нечем', apkFrom({ assets: [{ name: 'a.txt', browser_download_url: 'u' }] }) === null)
  check('пустой ответ не роняет', apkFrom(null) === null && apkFrom({}) === null)
  // Ссылки без адреса быть не должно, но GitHub отдаёт чужие поля, и брать
  // «файл без адреса» значит потом скачивать `undefined`.
  check('файл без адреса не берётся', apkFrom({ assets: [{ name: 'x.apk' }] }) === null)

  // main и releases/latest могут расходиться. Предлагаем и скачиваем один тег.
  const published = version => ({tag_name:`v${version}`,draft:false,prerelease:false,published_at:'2026-10-03T12:00:00Z',body:'- Исправление',assets:[{name:`dnevnik-zdorovya_v${version}_2026-10-03.apk`,state:'uploaded',size:100, browser_download_url:`https://github.com/LeonidAn1988/dnevnik-zdorovya/releases/download/v${version}/app.apk`}]})
  const stable = publishedUpdates([published('0.44.0'),published('0.45.0'),{...published('0.46.0'),assets:[]},{...published('0.47.0'),draft:true},{...published('0.48.0'),prerelease:true}])
  check('самый новый готовый APK выбирается по версии, а не по порядку',stable.map(r=>r.version).join()==='0.45.0,0.44.0')
  check('заметки принадлежат тому же выпуску',stable[0]?.items.join()==='Исправление')
  check('установщик проверяет конкретный тег',releaseAddress(stable[0].tag).endsWith('/releases/tags/v0.45.0'))
  const wrongAsset={...published('0.45.0'),assets:published('0.44.0').assets}
  check('APK другого тега не предлагается',publishedUpdates([wrongAsset]).length===0)
  const wrongName=published('0.45.0');wrongName.assets[0].name='dnevnik-zdorovya_v0.44.0_2026-10-03.apk'
  check('имя APK со старой версией не предлагается',publishedUpdates([wrongName]).length===0)
  const incomplete=published('0.45.0');incomplete.assets[0].state='new'
  check('незавершённая загрузка APK не предлагается',publishedUpdates([incomplete]).length===0)
  let malformedRejected=false;try {publishedUpdates({message:'rate limit'})} catch {malformedRejected=true}
  check('ответ-ошибка не означает последнюю установленную версию',malformedRejected)

  // ── как часто проверять, вернувшись в приложение ────────────────────────
  const сейчас = Date.UTC(2026, 8, 26, 12)
  check('ни разу не проверяли — пора', пораПроверять(undefined, сейчас))
  check('проверяли только что — не пора', !пораПроверять(сейчас - 1000, сейчас))
  check('срок вышел — пора', пораПроверять(сейчас - ПРОВЕРЯТЬ_РАЗ_В, сейчас))
  check('без пяти минут срок — ещё нет', !пораПроверять(сейчас - ПРОВЕРЯТЬ_РАЗ_В + 300_000, сейчас))
  // Час, а не сутки: возвращение на экран случается десятки раз в день, а
  // выпуск должен замечаться в тот же день, а не на следующий.
  check('срок — час', ПРОВЕРЯТЬ_РАЗ_В === 60 * 60 * 1000, String(ПРОВЕРЯТЬ_РАЗ_В))

  // ── неполный кусок файла ────────────────────────────────────────────────
  //
  // История версий выросла до девяноста килобайт, и читать её целиком на
  // каждый вход — трафик впустую: нужны верхние записи. Кусок обрывается
  // посреди выпуска, и обрезанный список изменений показывать нельзя.
  {
    const кусок = [
      '# Что изменилось', '',
      '## 0.43.0 — 1 октября 2026', '', '- третье', '',
      '## 0.42.0 — 1 октября 2026', '', '- второе', '',
      '## 0.41.0 — 26 сентября 2026', '', '- первое, обор',
    ].join('\n')
    const целый = trimPartial(кусок)
    check('оборванная запись отрезана', !целый.includes('0.41.0'), целый.slice(-40))
    check('целые записи остались', целый.includes('0.43.0') && целый.includes('0.42.0'))

    // Одной записи не набралось — вызывающему придётся дочитать файл.
    check('на одну запись куска мало', trimPartial('# Что изменилось\n\n## 0.43.0 — 1 октября 2026\n\n- обор') === '')
    check('без записей вовсе — тоже пусто', trimPartial('# Что изменилось\n\nпояснение') === '')

    // Хватило ли прочитанного, чтобы перечислить всё пропущенное.
    const прочитано = [выпуск('0.43.0'), выпуск('0.42.0')]
    check('своя версия в куске — хватило', chunkCovers(прочитано, '0.42.0'))
    check('в куске есть постарше — хватило', chunkCovers(прочитано, '0.41.0') === false)
    check('весь кусок новее своей — надо дочитать', !chunkCovers(прочитано, '0.40.0'))
    check('стоит свежее верхушки — тоже хватило', chunkCovers(прочитано, '0.44.0'))
    check('кусок размером в восемь килобайт', КУСОК_ИСТОРИИ === 8192, String(КУСОК_ИСТОРИИ))
  }

  return failures
}
