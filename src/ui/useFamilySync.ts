/**
 * Семейная синхронизация: читать чужие копии при каждом открытии приложения.
 *
 * Сервера нет. Свой дневник телефон и так пишет в файл при каждом изменении —
 * это обычная автокопия. Синхронизация добавляет вторую половину: приложение
 * знает файлы других телефонов семьи и читает их, когда его открывают.
 *
 * Отсюда и обещание, которое можно дать честно: «жена внесла у себя, я открыл
 * приложение — и увидел». Не «увидел мгновенно»: между двумя телефонами стоит
 * облачный клиент, который сам решает, когда синхронизировать папку. И не «пока
 * приложение закрыто»: в закрытом приложении наш код не выполняется вовсе —
 * фоновая работа потребовала бы отдельного нативного рабочего.
 *
 * Читаем при запуске и при каждом возвращении на экран. Чаще незачем: между
 * двумя взглядами на телефон ничего не меняется.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Person, Settings } from '../types'
import { parseImportFile, peerIsOutdated, toJson } from '../logic/io'
import { isEncrypted } from '../logic/crypto'
import { familyUnset } from '../logic/people'
import { accumulateMergeLog, emptyMergeLog, mergeChangedAnything, mergeDiary, type MergeLog } from '../logic/merge'
import { platform, type BackupSource } from '../platform/ports'
import { diskFileName, legacyFile, ownFile, parseToken, type DiskFile } from '../logic/yandex'
import {
  getInstallId,
  getAllLabs,
  getAllMedicines,
  getAllRegimens,
  getAllMeasurements,
  getAllTombstones,
} from '../db/store'

export interface FamilySyncStatus {
  /** Держит ли платформа чужие файлы между запусками. В браузере — нет. */
  supported: boolean
  sources: BackupSource[]
  busy: boolean
  /** Когда читали в последний раз. */
  lastAt: number | null
  /** Что принесло последнее чтение. `null` — ещё не читали. */
  lastLog: MergeLog | null
  /** Файлы, которые не прочитались: удалены, переименованы, отозван доступ. */
  unreadable: string[]
  /** Когда в чужом файле сделана самая свежая запись. Ключ — id источника. */
  freshness: Record<string, number | null>
  /**
   * Файл снят сборкой, не знающей про курсы приёма. Ключ — тот же.
   *
   * Ключа нет вовсе, если файл не прочитан: «не знаем» и «всё в порядке» — не
   * одно и то же, и показывать по незнанию нечего.
   */
  outdated: Record<string, boolean>
  /** Обмен через Яндекс.Диск: подключён ли и что там лежит. */
  cloud: {
    connected: boolean
    /** Умеет ли эта платформа читать чужие дневники. В браузере — нет. */
    canRead: boolean
    files: DiskFile[]
    /**
     * Файлы без метки установки — наследие версий до 0.30.0.
     *
     * Их мог писать не один телефон сразу, поэтому сами не трогаем: показываем
     * и объясняем, чтобы человек убрал их, когда обновятся все.
     */
    legacy: string[]
    /**
     * Имя файла этого телефона. `null` — метка установки ещё не прочитана.
     *
     * Нужно экрану: в папке лежит несколько дневников, и человек вправе знать,
     * который из них его. Без этого два неназванных телефона выглядят
     * одинаково.
     */
    mine: string | null
    /** Ключ, которым подключён этот телефон: его же вставляют на остальных. */
    key: string | null
    error: string | null
    connect: (pasted: string) => Promise<boolean>
    disconnect: () => void
  }
  addSource: () => Promise<void>
  removeSource: (id: string) => Promise<void>
  /** Прочитать сейчас — кнопкой, не дожидаясь следующего открытия. */
  syncNow: () => Promise<void>
}

export function useFamilySync({
  ready,
  settings,
  onSettings,
  onChanged,
}: {
  ready: boolean
  settings: Settings
  /** Люди добавляются слиянием: у жены мог появиться человек, которого здесь нет. */
  onSettings: (next: Settings | ((prev: Settings) => Settings)) => void
  /** Дневник изменился — экранам надо перечитать хранилище. */
  /**
   * Перечитать дневник после обмена — всё и разом.
   *
   * Новый состав людей передаётся сюда же, а не отдельным вызовом `onSettings`
   * перед этим: иначе между ними живёт рендер, где люди уже новые, а курсы ещё
   * старые. Стартовая загрузка ставит всё одним блоком после `Promise.all` —
   * здесь должно быть так же, и по той же причине (`BACKLOG.md` §24и).
   */
  onChanged: (people?: Person[]) => Promise<void>
}): FamilySyncStatus {
  const port = platform().backup
  const supported = port.canReadSources()
  const [sources, setSources] = useState<BackupSource[]>([])
  const [busy, setBusy] = useState(false)
  const [lastAt, setLastAt] = useState<number | null>(null)
  const [lastLog, setLastLog] = useState<MergeLog | null>(null)
  const [unreadable, setUnreadable] = useState<string[]>([])
  const [freshness, setFreshness] = useState<Record<string, number | null>>({})
  const [outdated, setOutdated] = useState<Record<string, boolean>>({})
  const cloudPort = platform().cloud
  const [cloudOn, setCloudOn] = useState(() => cloudPort.token() !== null)
  const cloudConnection = useRef(0)
  const [cloudFiles, setCloudFiles] = useState<DiskFile[]>([])
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [legacy, setLegacy] = useState<string[]>([])
  /** Метка установки: читается один раз, дальше не меняется. */
  const [установка, setУстановка] = useState<string | null>(null)

  /** Настройки и колбэки читаются из ссылки: слияние не должно перезапускаться от них. */
  const latest = useRef({ settings, onSettings, onChanged })
  latest.current = { settings, onSettings, onChanged }

  const идёт = useRef(false)
  const повторитьПослеПодключения = useRef(false)
  const отменитьОжидание = useRef<(() => void) | null>(null)
  // Detaching an IO wait cannot undo a PUT/DELETE already sent to the server.
  // Keep all writes serialized even across cancelled read cycles: different
  // OAuth tokens can still refer to the same Disk account.
  const облачнаяЗапись = useRef<Promise<void> | null>(null)

  const прочитать = useCallback(async function readFamily(): Promise<void> {
    if (идёт.current) return
    // Acquire before the first await: two foreground/manual reads must not
    // both pass the guard while the source list is still loading.
    идёт.current = true
    setBusy(true)
    const подключение = cloudConnection.current
    const ключ = cloudPort.token()
    const тоЖеПодключение = () => подключение === cloudConnection.current && ключ === cloudPort.token()
    // Cancel only waiting on external IO. Local persistence keeps the lock
    // until complete so a new cycle cannot interleave writes across stores.
    const прервано = Symbol('cloud connection changed')
    let отменить!: () => void
    const отмена = new Promise<void>((resolve) => { отменить = resolve })
    отменитьОжидание.current = отменить
    const ждать = async <T,>(task: Promise<T>): Promise<T> => {
      const result = await Promise.race([task.then((value) => ({ value })), отмена.then(() => null)])
      if (result === null) throw прервано
      return result.value
    }
    const записать = async (task: () => Promise<void>): Promise<void> => {
      if (!ключ) throw прервано
      const previous = облачнаяЗапись.current
      if (previous) await ждать(previous.catch(() => undefined))
      if (!тоЖеПодключение()) throw прервано
      const pending = task()
      облачнаяЗапись.current = pending
      void pending.finally(() => {
        if (облачнаяЗапись.current === pending) облачнаяЗапись.current = null
      }).catch(() => undefined)
      await ждать(pending)
    }
    const плохие: string[] = []
    const свежесть: Record<string, number | null> = {}
    const устарели: Record<string, boolean> = {}
    try {
      const список = supported ? await ждать(port.sources()) : []
      if (!тоЖеПодключение()) return
      setSources(список)
      const облако = ключ !== null
      if (список.length === 0 && !облако) return
      const [measurements, medicines, regimens, labs, tombstones] = await Promise.all([
        getAllMeasurements(),
        getAllMedicines(),
        getAllRegimens(),
        getAllLabs(),
        getAllTombstones(),
      ])
      let своё = { measurements, medicines, regimens, labs, tombstones, people: latest.current.settings.people }
      const итог: MergeLog = emptyMergeLog()

      for (const источник of список) {
        const текст = await ждать(port.readSource(источник.id))
        if (!тоЖеПодключение()) return
        if (текст === null) {
          плохие.push(источник.name)
          continue
        }
        // Закрытую паролем копию читать нечем: пароль знает её владелец, а не
        // мы. Молчать об этом нельзя — человек считает, что обмен идёт.
        if (isEncrypted(текст)) {
          плохие.push(`${источник.name} (закрыт паролем)`)
          continue
        }
        let разобрано
        try {
          разобрано = parseImportFile(источник.name.endsWith('.json') ? источник.name : `${источник.name}.json`, текст)
        } catch {
          плохие.push(`${источник.name} (не читается)`)
          continue
        }
        const слито = mergeDiary(своё, {
          measurements: разобрано.measurements,
          medicines: разобрано.medicines,
          regimens: разобрано.regimens,
          labs: разобрано.labs,
          tombstones: разобрано.tombstones,
          people: разобрано.settings?.people,
        }, latest.current.settings.mergedPeople)
        своё = {
          measurements: слито.measurements,
          medicines: слито.medicines,
          regimens: слито.regimens,
          labs: слито.labs,
          tombstones: слито.tombstones,
          people: слито.people,
        }
        accumulateMergeLog(итог, слито.log)
        // Свежесть — по самой поздней записи в файле. Отличает «облако не
        // донесло» от «человек ничего не вносил»: снаружи это одно и то же.
        const времена = [
          ...разобрано.measurements.map((m) => m.updatedAt ?? m.ts),
          ...разобрано.medicines.map((m) => m.updatedAt ?? 0),
        ]
        свежесть[источник.id] = времена.length ? Math.max(...времена) : null
        устарели[источник.id] = peerIsOutdated(разобрано.peer)
      }

      // Папку перечисляем один раз за проход: список нужен и чтению, и уборке
      // прежнего своего файла после записи, а лишний запрос с телефона — это
      // трафик.
      let файлыДиска: DiskFile[] | null = null

      // Дневники семьи из папки на Диске. Своё имя пропускаем: сливать файл
      // сам с собой незачем.
      if (облако) {
        try {
          const установка = await getInstallId()
          const моё = diskFileName(
            latest.current.settings.people.find((p) => p.id === latest.current.settings.activePerson)?.name,
            установка,
          )
          const файлы = await ждать(cloudPort.list())
          if (!тоЖеПодключение()) return
          файлыДиска = файлы
          setCloudFiles(файлы)
          setLegacy(файлы.filter((f) => legacyFile(f.name)).map((f) => f.name))
          setCloudError(null)
          if (cloudPort.canDownload()) {
            for (const файл of файлы) {
              if (файл.name === моё || ownFile(файл.name, установка)) continue
              const текст = await ждать(cloudPort.download(файл.name))
              if (!тоЖеПодключение()) return
              if (текст === null) {
                плохие.push(`${файл.name} (не читается)`)
                continue
              }
              let разобрано
              try {
                разобрано = parseImportFile(файл.name, текст)
              } catch {
                плохие.push(`${файл.name} (не разбирается)`)
                continue
              }
              const слито = mergeDiary(своё, {
                measurements: разобрано.measurements,
                medicines: разобрано.medicines,
                regimens: разобрано.regimens,
                labs: разобрано.labs,
                tombstones: разобрано.tombstones,
                people: разобрано.settings?.people,
              }, latest.current.settings.mergedPeople)
              своё = {
                measurements: слито.measurements,
                medicines: слито.medicines,
                regimens: слито.regimens,
                labs: слито.labs,
                tombstones: слито.tombstones,
                people: слито.people,
              }
              accumulateMergeLog(итог, слито.log)
              свежесть[файл.name] = файл.modified
              устарели[файл.name] = peerIsOutdated(разобрано.peer)
            }
          }
        } catch (error) {
          if (!тоЖеПодключение()) return
          // Сеть, просроченный ключ, лимит Диска — обмен через файлы при этом
          // работает дальше, и валить его из-за облака нельзя.
          setCloudError(error instanceof Error ? error.message : String(error))
        }
      }

      if (!тоЖеПодключение()) return
      if (mergeChangedAnything(итог)) {
        try {
          const финал = await platform().storage.mergeFamily(своё, latest.current.settings, тоЖеПодключение)
          if (!финал) return
          Object.assign(итог, финал.log)
          // Even if the connection changed after commit, refresh committed data.
          await latest.current.onChanged(финал.people)
        } catch (error) {
          плохие.push(`запись не удалась: ${error instanceof Error ? error.message : String(error)}`)
          // Never upload an incoming snapshot whose transaction failed.
          if (тоЖеПодключение()) setUnreadable(плохие)
          return
        }
      }

      if (!тоЖеПодключение()) return
      // Новый браузер пока не умеет получить семью с Диска. Не публикуем в
      // неё пустого местного «Я»: телефон принял бы его за ещё одного человека,
      // хотя владелец всего лишь хотел открыть существующий дневник.
      // Названные люди, любые записи и платформы с чтением работают как раньше.
      const пустойНовыйБраузер = platform().kind === 'web' && !cloudPort.canDownload() && familyUnset(latest.current.settings.people) &&
        своё.measurements.length + своё.medicines.length + своё.regimens.length + своё.labs.length + своё.tombstones.length === 0
      if (облако && !пустойНовыйБраузер) {
        try {
          const установка = await getInstallId()
          let моё = ''
          await записать(async () => {
            // Чтение источников и очередь записи могут занять секунды. Перед отправкой
            // перечитываем локальную базу: если человек что-то добавил за это
            // время, в облако должен уйти актуальный снимок вместе с уже слитыми
            // чужими данными, а не состояние на начало обмена.
            const { settings } = latest.current
            const дляОтправки = await platform().storage.readDiary(settings)
            if (!тоЖеПодключение()) return
            моё = diskFileName(settings.people.find((p) => p.id === settings.activePerson)?.name, установка)
            const { backupLastAt: _at, backupLastCount: _c, backupLastSignature: _s, pairingKey: _k, ...rest } = settings
            await cloudPort.upload(
              моё,
              toJson({
                measurements: дляОтправки.measurements,
                medicines: дляОтправки.medicines,
                regimens: дляОтправки.regimens,
                labs: дляОтправки.labs,
                tombstones: дляОтправки.tombstones,
                settings: { ...rest, people: дляОтправки.people },
              }),
            )
          })
          if (!тоЖеПодключение()) return

          // Прежнее имя этой же установки убираем — но только после того, как
          // новое записалось. Иначе неудачная загрузка оставит семью вообще
          // без нашего дневника.
          //
          // Только своё, по метке установки. Файл без метки мог писать не один
          // телефон: удалить его значит удалить чужой дневник, и этого не
          // делает никто, кроме человека.
          const список = файлыДиска ?? (await ждать(cloudPort.list()))
          for (const файл of список) {
            if (!тоЖеПодключение()) return
            if (файл.name === моё || !ownFile(файл.name, установка)) continue
            try {
              await записать(() => cloudPort.remove(файл.name))
            } catch (error) {
              if (!тоЖеПодключение()) return
              // Не удалилось — не беда: лишний файл мешает меньше, чем
              // оборванная синхронизация. Но молчать не будем.
              плохие.push(`${файл.name} (не удаляется: ${error instanceof Error ? error.message : String(error)})`)
            }
          }
        } catch (error) {
          if (!тоЖеПодключение()) return
          setCloudError(error instanceof Error ? error.message : String(error))
        }
      }

      if (!тоЖеПодключение()) return
      setLastLog(итог)
      setLastAt(Date.now())
      setUnreadable(плохие)
      setFreshness(свежесть)
      setOutdated(устарели)
    } catch (error) {
      if (тоЖеПодключение()) setUnreadable([...плохие, `обмен не удался: ${error instanceof Error ? error.message : String(error)}`])
    } finally {
      if (отменитьОжидание.current === отменить) отменитьОжидание.current = null
      идёт.current = false
      setBusy(false)
      // A successful new connection may have arrived while the old read was
      // pending. Cancel its external wait and coalesce into one fresh cycle.
      if (повторитьПослеПодключения.current) {
        повторитьПослеПодключения.current = false
        void readFamily()
      }
    }
  }, [port, supported, cloudPort])

  // Метка установки нужна экрану до первого обмена: по ней он показывает, чей
  // файл в папке — этого телефона.
  useEffect(() => {
    void getInstallId().then(setУстановка)
  }, [])

  // Список источников нужен экрану и до первого чтения.
  useEffect(() => {
    if (!supported) return
    void port.sources().then(setSources)
  }, [port, supported])

  // При запуске и при каждом возвращении на экран.
  useEffect(() => {
    if (!ready || (!supported && !cloudOn)) return
    void прочитать()
    const проснулись = () => {
      if (document.visibilityState === 'visible') void прочитать()
    }
    document.addEventListener('visibilitychange', проснулись)
    return () => document.removeEventListener('visibilitychange', проснулись)
  }, [ready, supported, cloudOn, прочитать])

  const addSource = useCallback(async () => {
    let added: BackupSource | null
    try {
      added = await port.addSource()
    } catch (error) {
      setUnreadable([error instanceof Error ? error.message : String(error)])
      return
    }
    if (!added) return
    // Проверяем сразу: непригодный файл иначе навсегда останется в списке
    // «телефоны семьи», а человек будет ждать от него записей.
    const текст = await port.readSource(added.id)
    const беда =
      текст === null
        ? 'файл не читается'
        : isEncrypted(текст)
          ? 'файл закрыт паролем — телефоны семьи его не прочтут'
          : (() => {
              try {
                parseImportFile(added.name.endsWith('.json') ? added.name : `${added.name}.json`, текст)
                return null
              } catch {
                return 'это не копия дневника'
              }
            })()
    if (беда) {
      await port.removeSource(added.id)
      setUnreadable([`${added.name}: ${беда}`])
      return
    }
    setSources(await port.sources())
    await прочитать()
  }, [port, прочитать])

  const removeSource = useCallback(
    async (id: string) => {
      await port.removeSource(id)
      setSources(await port.sources())
      setUnreadable([])
    },
    [port],
  )

  const connect = useCallback(
    async (pasted: string) => {
      const ключ = parseToken(pasted)
      if (!ключ) {
        setCloudError('Это не похоже на ключ. Скопируйте его целиком со страницы Яндекса.')
        return false
      }
      const request = ++cloudConnection.current
      отменитьОжидание.current?.()
      cloudPort.setToken(ключ)
      setCloudError(null)
      try {
        // Сразу проверяем ключ делом: молча сохранить неверный значит обещать
        // обмен, которого не будет.
        const files = await cloudPort.list()
        if (request !== cloudConnection.current) return false
        setCloudFiles(files)
      } catch (error) {
        if (request !== cloudConnection.current) return false
        cloudPort.setToken('')
        setCloudOn(false)
        setCloudError(error instanceof Error ? error.message : String(error))
        return false
      }
      // Не размонтируем форму до проверки: при сетевом отказе введённый
      // ключ должен остаться на месте для повторной попытки.
      setCloudOn(true)
      if (идёт.current) повторитьПослеПодключения.current = true
      await прочитать()
      return request === cloudConnection.current && cloudPort.token() === ключ
    },
    [cloudPort, прочитать],
  )

  const disconnect = useCallback(() => {
    cloudConnection.current++
    отменитьОжидание.current?.()
    cloudPort.setToken('')
    if (идёт.current) повторитьПослеПодключения.current = true
    setCloudOn(false)
    setCloudFiles([])
    setLegacy([])
    setCloudError(null)
  }, [cloudPort])

  return {
    supported,
    sources,
    busy,
    lastAt,
    lastLog,
    unreadable,
    freshness,
    outdated,
    cloud: {
      connected: cloudOn,
      canRead: cloudPort.canDownload(),
      files: cloudFiles,
      legacy,
      mine: установка
        ? diskFileName(settings.people.find((p) => p.id === settings.activePerson)?.name, установка)
        : null,
      key: cloudPort.token(),
      error: cloudError,
      connect,
      disconnect,
    },
    addSource,
    removeSource,
    syncNow: прочитать,
  }
}

export { describeMerge } from '../logic/merge'
