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
import type { Settings } from '../types'
import { parseImportFile, toJson } from '../logic/io'
import { isEncrypted } from '../logic/crypto'
import { emptyMergeLog, mergeChangedAnything, mergeDiary, type MergeLog } from '../logic/merge'
import { platform, type BackupSource } from '../platform/ports'
import { diskFileName, legacyFile, ownFile, parseToken, type DiskFile } from '../logic/yandex'
import {
  getInstallId,
  getAllLabs,
  putLab,
  deleteLab,
  deleteLabPhotosOf,
  deleteMeasurement,
  deleteMedicine,
  getAllMedicines,
  getAllRegimens,
  putRegimen,
  deleteRegimen,
  getAllMeasurements,
  getAllTombstones,
  putMedicine,
  putMeasurements,
  saveTombstones,
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
  onSettings: (next: Settings) => void
  /** Дневник изменился — экранам надо перечитать хранилище. */
  onChanged: () => Promise<void>
}): FamilySyncStatus {
  const port = platform().backup
  const supported = port.canReadSources()
  const [sources, setSources] = useState<BackupSource[]>([])
  const [busy, setBusy] = useState(false)
  const [lastAt, setLastAt] = useState<number | null>(null)
  const [lastLog, setLastLog] = useState<MergeLog | null>(null)
  const [unreadable, setUnreadable] = useState<string[]>([])
  const [freshness, setFreshness] = useState<Record<string, number | null>>({})
  const cloudPort = platform().cloud
  const [cloudOn, setCloudOn] = useState(() => cloudPort.token() !== null)
  const [cloudFiles, setCloudFiles] = useState<DiskFile[]>([])
  const [cloudError, setCloudError] = useState<string | null>(null)
  const [legacy, setLegacy] = useState<string[]>([])
  /** Метка установки: читается один раз, дальше не меняется. */
  const [установка, setУстановка] = useState<string | null>(null)

  /** Настройки и колбэки читаются из ссылки: слияние не должно перезапускаться от них. */
  const latest = useRef({ settings, onSettings, onChanged })
  latest.current = { settings, onSettings, onChanged }

  const идёт = useRef(false)

  const прочитать = useCallback(async () => {
    if (идёт.current) return
    const список = supported ? await port.sources() : []
    setSources(список)
    const облако = cloudPort.token() !== null
    if (список.length === 0 && !облако) return

    идёт.current = true
    setBusy(true)
    const плохие: string[] = []
    const свежесть: Record<string, number | null> = {}
    try {
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
        const текст = await port.readSource(источник.id)
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
        итог.addedMeasurements += слито.log.addedMeasurements
        итог.updatedMeasurements += слито.log.updatedMeasurements
        итог.addedMedicines += слито.log.addedMedicines
        итог.updatedMedicines += слито.log.updatedMedicines
        // Курсы обязаны быть здесь: по этому итогу решается, писать ли вообще
        // (`mergeChangedAnything`). Без них новый курс с другого телефона и
        // всякая правка часов, дозы, ритма и конца молча не доезжали — а в
        // облако при этом уходил файл, где они есть.
        итог.addedRegimens += слито.log.addedRegimens
        итог.updatedRegimens += слито.log.updatedRegimens
        итог.addedIntakes += слито.log.addedIntakes
        итог.removed += слито.log.removed
        итог.addedPeople += слито.log.addedPeople
        итог.stockConflicts.push(...слито.log.stockConflicts)
        // Свежесть — по самой поздней записи в файле. Отличает «облако не
        // донесло» от «человек ничего не вносил»: снаружи это одно и то же.
        const времена = [
          ...разобрано.measurements.map((m) => m.updatedAt ?? m.ts),
          ...разобрано.medicines.map((m) => m.updatedAt ?? 0),
        ]
        свежесть[источник.id] = времена.length ? Math.max(...времена) : null
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
          const файлы = await cloudPort.list()
          файлыДиска = файлы
          setCloudFiles(файлы)
          setLegacy(файлы.filter((f) => legacyFile(f.name)).map((f) => f.name))
          setCloudError(null)
          if (cloudPort.canDownload()) {
            for (const файл of файлы) {
              if (файл.name === моё || ownFile(файл.name, установка)) continue
              const текст = await cloudPort.download(файл.name)
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
              итог.addedMeasurements += слито.log.addedMeasurements
              итог.updatedMeasurements += слито.log.updatedMeasurements
              итог.addedMedicines += слито.log.addedMedicines
              итог.updatedMedicines += слито.log.updatedMedicines
              итог.addedRegimens += слито.log.addedRegimens
              итог.updatedRegimens += слито.log.updatedRegimens
              итог.addedIntakes += слито.log.addedIntakes
              итог.removed += слито.log.removed
              итог.addedPeople += слито.log.addedPeople
              итог.stockConflicts.push(...слито.log.stockConflicts)
              свежесть[файл.name] = файл.modified
            }
          }
        } catch (error) {
          // Сеть, просроченный ключ, лимит Диска — обмен через файлы при этом
          // работает дальше, и валить его из-за облака нельзя.
          setCloudError(error instanceof Error ? error.message : String(error))
        }
      }

      if (mergeChangedAnything(итог)) {
        // Пока читались чужие файлы, человек мог что-то внести. Слепок, снятый
        // до чтения, эти правки не содержит — и записанный поверх, затёр бы их.
        // Поэтому перед записью сливаем результат ещё раз с тем, что в базе сейчас.
        const [сейчасИзм, сейчасЛек, сейчасКурсы, сейчасАнализы, сейчасНадгр] = await Promise.all([
          getAllMeasurements(),
          getAllMedicines(),
          getAllRegimens(),
          getAllLabs(),
          getAllTombstones(),
        ])
        const финал = mergeDiary(
          {
            measurements: сейчасИзм,
            medicines: сейчасЛек,
            regimens: сейчасКурсы,
            labs: сейчасАнализы,
            tombstones: сейчасНадгр,
            people: latest.current.settings.people,
          },
          {
            measurements: своё.measurements,
            medicines: своё.medicines,
            regimens: своё.regimens,
            labs: своё.labs,
            tombstones: своё.tombstones,
            people: своё.people,
          },
          latest.current.settings.mergedPeople,
        )
        try {
          // Отметку времени правки не переставляем: пришедшее сюда уже имеет
          // свою, и пометить его «сейчас» значит сделать чужую правку свежее
          // местной при следующем обмене.
          await saveTombstones(финал.tombstones)
          // Надгробия — не только сохранить, но и применить: слияние выбросило
          // убитые записи из своего списка, а в хранилище они лежали и дальше,
          // и «удалено: 1» в журнале ничего не удаляло.
          const убитые = new Set(финал.tombstones.map((t) => t.id))
          for (const item of сейчасИзм) if (убитые.has(item.id)) await deleteMeasurement(item.id)
          for (const item of сейчасЛек) if (убитые.has(item.id)) await deleteMedicine(item.id)
          for (const item of сейчасКурсы) if (убитые.has(item.id)) await deleteRegimen(item.id)
          for (const item of сейчасАнализы) {
            if (!убитые.has(item.id)) continue
            // Снимки уходят вместе с анализом и здесь тоже: анализ могли
            // удалить на другом телефоне, а мегабайты остались бы на этом — и
            // добраться до них из приложения было бы нечем.
            await deleteLabPhotosOf(item.id).catch(() => undefined)
            await deleteLab(item.id)
          }
          await putMeasurements(финал.measurements, false)
          for (const item of финал.medicines) await putMedicine(item, false)
          for (const item of финал.regimens) await putRegimen(item, false)
          for (const item of финал.labs) await putLab(item, false)
          // Сравнение по составу, а не по длине: длина не умеет заметить
          // замену, и после объединения людей список того же размера с другим
          // содержимым не записался бы.
          const былиКлючи = latest.current.settings.people.map((p) => p.id).join()
          const сталиКлючи = финал.people.map((p) => p.id).join()
          if (былиКлючи !== сталиКлючи) {
            latest.current.onSettings({ ...latest.current.settings, people: финал.people })
          }
        } catch (error) {
          // Запись сорвалась на полпути — молчать нельзя: человек считает, что
          // обмен прошёл. Сообщаем как о нечитаемом источнике, тем же местом.
          плохие.push(`запись не удалась: ${error instanceof Error ? error.message : String(error)}`)
        }
        await latest.current.onChanged()
      }

      // Своё выкладываем всегда, когда облако подключено: даже если чужого не
      // принесли, наши записи могли измениться с прошлого раза.
      if (облако) {
        try {
          const { settings } = latest.current
          const установка = await getInstallId()
          const моё = diskFileName(settings.people.find((p) => p.id === settings.activePerson)?.name, установка)
          const { backupLastAt: _at, backupLastCount: _c, backupLastSignature: _s, pairingKey: _k, ...rest } = settings
          await cloudPort.upload(
            моё,
            toJson({
              measurements: своё.measurements,
              medicines: своё.medicines,
              regimens: своё.regimens,
              labs: своё.labs,
              tombstones: своё.tombstones,
              settings: rest,
            }),
          )

          // Прежнее имя этой же установки убираем — но только после того, как
          // новое записалось. Иначе неудачная загрузка оставит семью вообще
          // без нашего дневника.
          //
          // Только своё, по метке установки. Файл без метки мог писать не один
          // телефон: удалить его значит удалить чужой дневник, и этого не
          // делает никто, кроме человека.
          const список = файлыДиска ?? (await cloudPort.list())
          for (const файл of список) {
            if (файл.name === моё || !ownFile(файл.name, установка)) continue
            try {
              await cloudPort.remove(файл.name)
            } catch (error) {
              // Не удалилось — не беда: лишний файл мешает меньше, чем
              // оборванная синхронизация. Но молчать не будем.
              плохие.push(`${файл.name} (не удаляется: ${error instanceof Error ? error.message : String(error)})`)
            }
          }
        } catch (error) {
          setCloudError(error instanceof Error ? error.message : String(error))
        }
      }

      setLastLog(итог)
      setLastAt(Date.now())
      setUnreadable(плохие)
      setFreshness(свежесть)
    } finally {
      идёт.current = false
      setBusy(false)
    }
  }, [port, supported])

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
      cloudPort.setToken(ключ)
      setCloudOn(true)
      setCloudError(null)
      try {
        // Сразу проверяем ключ делом: молча сохранить неверный значит обещать
        // обмен, которого не будет.
        setCloudFiles(await cloudPort.list())
      } catch (error) {
        cloudPort.setToken('')
        setCloudOn(false)
        setCloudError(error instanceof Error ? error.message : String(error))
        return false
      }
      await прочитать()
      return true
    },
    [cloudPort, прочитать],
  )

  const disconnect = useCallback(() => {
    cloudPort.setToken('')
    setCloudOn(false)
    setCloudFiles([])
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

/** Одной строкой: что принесло последнее чтение. */
export function describeMerge(log: MergeLog | null): string {
  if (!log) return 'ещё не читали'
  if (!mergeChangedAnything(log)) return 'нового не было'
  const части: string[] = []
  const прибавка = log.addedMeasurements + log.updatedMeasurements
  if (прибавка > 0) части.push(`измерений: ${прибавка}`)
  if (log.addedMedicines > 0) части.push(`препаратов: ${log.addedMedicines}`)
  if (log.addedIntakes > 0) части.push(`отметок приёма: ${log.addedIntakes}`)
  if (log.removed > 0) части.push(`удалено: ${log.removed}`)
  if (log.addedPeople > 0) части.push(`людей: ${log.addedPeople}`)
  return части.join(', ')
}
