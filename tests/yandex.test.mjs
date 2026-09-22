/**
 * Обмен через Яндекс.Диск — то, что можно проверить без сети.
 *
 * Ошибка в адресе или в разборе ключа означает, что обмен не заработает вовсе,
 * а человек будет думать, что настроил. Поэтому каждая ссылка сторожится.
 */
import { authUrl, parseToken, authHeader, listUrl, uploadUrl, downloadUrl, deleteUrl, diskFileName, installSuffix, ownFile, legacyFile, fileLabel, parseListing, parseHref, DISK_FOLDER, YANDEX_CLIENT_ID } from './build/api.mjs'

export function run() {
  let failures = 0
  const check = (name, condition, detail = '') => {
    if (condition) console.log(`  ok   ${name}`)
    else {
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
      failures++
    }
  }

  // ── вход ─────────────────────────────────────────────────────────────────
  check('страница входа просит ключ сразу', authUrl().includes('response_type=token'))
  check('и называет наше приложение', authUrl().includes(YANDEX_CLIENT_ID))
  check('идентификатор приложения на месте', /^[0-9a-f]{32}$/.test(YANDEX_CLIENT_ID))

  // ── ключ ─────────────────────────────────────────────────────────────────
  const ключ = 'y0__wgBEOqp_gsGAAAAAADrfAAAAAD3q7yourfaketokenvalue'
  check('голый ключ принимается', parseToken(ключ) === ключ)
  check('ключ из адреса', parseToken(`https://oauth.yandex.ru/verification_code#access_token=${ключ}&token_type=bearer`) === ключ)
  check('ключ из строки с подписью', parseToken(`  access_token=${ключ}  `) === ключ)
  check('пустая строка — ничего', parseToken('   ') === null)
  check('случайный текст — ничего', parseToken('не знаю что вставить') === null)
  check('слишком короткое — ничего', parseToken('abc123') === null)
  check('заголовок в формате Яндекса', authHeader(ключ).Authorization === `OAuth ${ключ}`)

  // ── адреса ───────────────────────────────────────────────────────────────
  check('папка приложения, а не весь Диск', DISK_FOLDER === 'app:/')
  check('список идёт в папку приложения', decodeURIComponent(listUrl()).includes('path=app:/'))
  check('загрузка перезаписывает файл', uploadUrl('дневник.json').includes('overwrite=true'))
  check('в адресе загрузки закодировано имя', uploadUrl('дневник-Отец.json').includes(encodeURIComponent('дневник-Отец.json')))
  check('скачивание берёт тот же путь', decodeURIComponent(downloadUrl('дневник.json')).includes('app:/дневник.json'))
  check('все адреса — к API Диска', [listUrl(), uploadUrl('a.json'), downloadUrl('a.json')].every((u) => u.startsWith('https://cloud-api.yandex.net/v1/disk/')))

  check('удаление идёт в корзину, а не насовсем', deleteUrl('дневник.json').includes('permanently=false'))
  check('удаление — по тому же пути', decodeURIComponent(deleteUrl('дневник.json')).includes('app:/дневник.json'))

  // ── имя файла ────────────────────────────────────────────────────────────
  // Ради чего всё: два телефона, у обоих человек по умолчанию «Я». До метки
  // установки у них выходил один «дневник.json» — они затирали друг друга при
  // записи и пропускали файл как свой при чтении. Обмен между двумя
  // неназванными телефонами не работал вовсе, и каждая запись стоила чужой.
  const телефонА = 'im3k2p9xq7b4z2'
  const телефонБ = 'im3k2p9zzz1a9f'
  check(
    'два неназванных телефона пишут в разные файлы',
    diskFileName('Я', телефонА) !== diskFileName('Я', телефонБ),
    `${diskFileName('Я', телефонА)} и ${diskFileName('Я', телефонБ)}`,
  )
  check('и два тёзки тоже', diskFileName('Отец', телефонА) !== diskFileName('Отец', телефонБ))
  check('имя человека осталось в названии', diskFileName('Отец', телефонА) === 'дневник-Отец-q7b4z2.json',
    diskFileName('Отец', телефонА))
  check('«Я» в название по-прежнему не идёт', diskFileName('Я', телефонА) === 'дневник-q7b4z2.json',
    diskFileName('Я', телефонА))
  check('одна установка — одно имя, сколько ни спрашивай',
    diskFileName('Отец', телефонА) === diskFileName('Отец', телефонА))
  check('косые из имени вычищены', !diskFileName('а/б:в', телефонА).includes('/'))

  // Метка — случайный хвост, а не начало: начало идентификатора это время
  // установки, и у двух телефонов, настроенных в один день, оно совпадает
  // почти целиком.
  check('метка берётся с хвоста', installSuffix(телефонА) === 'q7b4z2', installSuffix(телефонА))
  check('одинаковое начало не мешает', installSuffix(телефонА) !== installSuffix(телефонБ))
  check('мусор из метки вычищен', installSuffix('AB-cd_EF!gh') === 'cdefgh', installSuffix('AB-cd_EF!gh'))
  // Без метки лучше старое имя, чем «дневник-.json».
  check('нет идентификатора — нет метки', installSuffix('') === '' && diskFileName('Отец', '') === 'дневник-Отец.json')
  check('огрызок идентификатора тоже не метка', installSuffix('ab') === '')

  // ── чьё и какого образца ─────────────────────────────────────────────────
  check('свой файл узнаётся по метке', ownFile('дневник-Отец-q7b4z2.json', телефонА))
  check('и прежнее своё имя тоже', ownFile('дневник-q7b4z2.json', телефонА))
  check('чужой не узнаётся', !ownFile(diskFileName('Я', телефонБ), телефонА))
  // Главное про уборку: без метки не своё, и трогать нельзя — под таким именем
  // может лежать дневник другого телефона.
  check('файл старого образца своим не считается', !ownFile('дневник.json', телефонА))
  check('и без идентификатора ничего не своё', !ownFile('дневник-q7b4z2.json', ''))
  check('старый образец виден', legacyFile('дневник.json') && legacyFile('дневник-Отец.json'))
  check('новый — нет', !legacyFile('дневник-q7b4z2.json') && !legacyFile('дневник-Отец-q7b4z2.json'))
  check('чужой файл в папке не наш и не старого образца', !legacyFile('заметки.json'))

  // ── подпись для человека ─────────────────────────────────────────────────
  check('свой называется прямо', fileLabel('дневник-q7b4z2.json', true) === 'этот телефон')
  check('чужой — по имени человека', fileLabel('дневник-Отец-q7b4z2.json') === 'Отец')
  check('метка человеку не показывается', !fileLabel('дневник-Отец-q7b4z2.json').includes('q7b4z2'))
  check('чужой неназванный — без имени', fileLabel('дневник-zzz1a9.json') === 'дневник без имени',
    fileLabel('дневник-zzz1a9.json'))
  check('старый образец подписывается как прежде', fileLabel('дневник-Отец.json') === 'Отец')
  check('имя из шести знаков не съедается', fileLabel('дневник-Anna12-q7b4z2.json') === 'Anna12',
    fileLabel('дневник-Anna12-q7b4z2.json'))

  // ── разбор ответов ───────────────────────────────────────────────────────
  const ответ = { _embedded: { items: [
    { type: 'file', name: 'дневник-Отец.json', modified: '2026-09-05T10:00:00+00:00', size: 1200 },
    { type: 'file', name: 'фото.jpg', modified: '2026-09-05T10:00:00+00:00', size: 90 },
    { type: 'dir', name: 'папка' },
    { type: 'file', name: 'дневник.json', size: 900 },
    null,
  ] } }
  const файлы = parseListing(ответ)
  check('в списке только дневники', файлы.map((f) => f.name).join() === 'дневник-Отец.json,дневник.json')
  check('дата разобрана', файлы[0].modified === Date.parse('2026-09-05T10:00:00+00:00'))
  check('без даты — null, а не NaN', файлы[1].modified === null)
  check('мусор не роняет разбор', parseListing({}).length === 0 && parseListing(null).length === 0)

  check('ссылка берётся', parseHref({ href: 'https://uploader1.disk.yandex.net/upload?x=1' }) === 'https://uploader1.disk.yandex.net/upload?x=1')
  check('не-https ссылка отвергается', parseHref({ href: 'http://злоумышленник/' }) === null)
  check('нет ссылки — null', parseHref({}) === null)

  return failures
}
