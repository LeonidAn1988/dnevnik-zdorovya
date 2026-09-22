import { useCallback, useEffect, useRef, useState } from 'react'
import { encryptBackup } from '../logic/crypto'
import type { LabTest, Measurement, Medicine, Regimen, Settings } from '../types'
import { backupTarget, getAllTombstones, requestDurability } from '../db/store'
import { canShareFile, download, shareFile, toJson } from '../logic/io'
import {
  backupFilename,
  backupWarning,
  recordsBehind,
  shouldWriteBackup,
  type BackupWarning,
} from '../logic/backup'
import { diarySignature } from '../logic/merge'

/**
 * Состояние сохранности дневника и всё, что с ним можно сделать.
 *
 * Собрано в одном месте, потому что защита работает только целиком: постоянное
 * хранилище удерживает данные в браузере, копия в файл переживает очистку и
 * смену устройства, а предупреждение нужно ровно тогда, когда ни то ни другое
 * не сработало.
 */

export interface BackupStatus {
  /** Умеет ли платформа писать копии сама. */
  supported: boolean
  /** Имя файла для копий, если он выбран. */
  target: string | null
  /** Защищено ли хранилище от вытеснения браузером. null — вопрос неприменим. */
  durable: boolean | null
  warning: BackupWarning
  /** Сколько записей ещё не в копии — их и потеряем. */
  behind: number
  lastAt: number | null
  count: number
  busy: boolean
  /** Автоматическая запись не прошла: файл удалили или отозвали доступ. */
  failed: boolean
  /** Записать не вышло, но файл на месте: облачная папка недоступна, диск занят. Повторим сами. */
  stalled: boolean
  chooseTarget: () => Promise<void>
  forgetTarget: () => Promise<void>
  saveNow: () => Promise<void>
  /** Умеет ли платформа отдать копию в другое приложение. */
  canShare: boolean
  /** Передать копию в облако, мессенджер или почту — чтобы она пережила устройство. */
  shareNow: () => Promise<void>
  /** Применённый пароль копии — тот, которым закрывается файл. Пустая строка, если пароля нет. */
  password: string
  /** Применить пароль. Не на каждую букву: см. комментарий у `setPassword` в реализации. */
  setPassword: (value: string) => void
  /** Шифрование включено, но пароля нет: копии не делаются вообще, ни сами, ни руками. */
  locked: boolean
  /** Прочитать копию из выбранного файла — короткий путь к восстановлению. `null`, если файла нет. */
  readTarget: () => Promise<string | null>
}

/**
 * Пароль копии живёт на устройстве, и это не небрежность.
 *
 * Он защищает файл **в облаке**, а не телефон: сам дневник и так лежит здесь
 * открытым, и у того, кто получил разблокированный телефон, он уже есть. Держать
 * пароль только в памяти означало бы, что после каждого перезапуска
 * автоматические копии молча перестают идти, — а молчащая копия хуже
 * отсутствующей.
 *
 * В резервную копию он не попадает никогда: копия, в которой лежит пароль от
 * неё же, не защищена ничем.
 */
const PASSWORD_KEY = 'omron.backup-password'

export function backupPassword(): string {
  try {
    return localStorage.getItem(PASSWORD_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setBackupPassword(value: string): void {
  try {
    if (value) localStorage.setItem(PASSWORD_KEY, value)
    else localStorage.removeItem(PASSWORD_KEY)
  } catch {
    // Без памяти под пароль шифрование в этой сессии просто не включится.
  }
}

export function useBackup(
  measurements: Measurement[],
  medicines: Medicine[],
  regimens: Regimen[],
  labs: LabTest[],
  settings: Settings,
  onSettings: (next: Settings) => void,
  ready: boolean,
): BackupStatus {
  const [target, setTarget] = useState<string | null>(null)
  const [durable, setDurable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [stalled, setStalled] = useState(false)
  /**
   * Пароль, **применённый** к копиям, — не то же самое, что набранный в поле.
   *
   * Разница не косметическая. Запись копии запускается изменением данных, а
   * дневник почти всегда разошёлся с файлом; если бы сюда попадала каждая
   * нажатая клавиша, первая же буква ушла бы в файл как ключ шифрования, копия
   * отметилась бы сохранённой, и настоящий пароль в файл уже не попал бы —
   * `shouldAutoBackup` больше не сработал бы. В облаке осталась бы копия,
   * закрытая одной буквой.
   *
   * Поэтому экран держит черновик у себя и применяет его целиком.
   */
  const [password, setPasswordState] = useState(backupPassword)

  const setPassword = useCallback((value: string) => {
    setBackupPassword(value)
    setPasswordState(value)
  }, [])

  const locked = settings.backupEncrypt && !password

  /**
   * Каким замком закрыт файл.
   *
   * Смена замка старит файл сама по себе, сколько бы записей в дневнике ни
   * было. Без этого включение шифрования при сошедшихся счётчиках не
   * перезаписывало файл вовсе: экран говорил «сохраняется, закрытый паролем», а
   * в файле лежал открытый дневник.
   */
  const lock = settings.backupEncrypt ? `on:${password}` : 'off'
  const writtenLock = useRef<string | null>(null)

  /**
   * Записать при первой же возможности, не спрашивая счётчиков.
   *
   * Нужно после выбора файла: файл только что создан и пуст, а счётчики могут
   * сойтись — тогда `shouldAutoBackup` вернул бы `false` и человек остался бы с
   * пустым файлом при надписи «сохраняется само».
   */
  const force = useRef(false)

  const supported = backupTarget.isSupported()
  /**
   * Считаем и измерения, и препараты. Иначе внесённая аптечка не сдвигала
   * счётчик, копия не обновлялась и не предупреждала — а введена она руками и
   * теряется так же безвозвратно, как измерение.
   */
  const count = measurements.length + medicines.length + regimens.length + labs.length

  /**
   * Слепок содержимого: он и решает, писать ли копию.
   *
   * Надгробия в него не входят — они читаются из хранилища, а не из состояния
   * экрана, и ради слепка лезть в базу на каждую отрисовку незачем. Удаление
   * при этом всё равно меняет число записей, так что незамеченным не остаётся.
   */
  const signature = diarySignature(measurements, medicines, regimens, labs, [])

  /**
   * Настройки читаются из ссылки, а не из замыкания: автокопия срабатывает по
   * изменению данных, и если бы она зависела ещё и от настроек, то запускалась
   * бы повторно от собственной же отметки о времени.
   */
  const latest = useRef({ settings, measurements, medicines, regimens, labs, onSettings })
  latest.current = { settings, measurements, medicines, regimens, labs, onSettings }

  /**
   * Что уходит в копию. Одних измерений мало: аптечка и настройки тоже введены
   * руками и теряются так же безвозвратно. Служебные поля про сами копии из
   * снимка исключены — они описывают устройство, а не данные.
   */
  const snapshot = async (): Promise<string> => {
    const { measurements: items, medicines: pills, regimens: курсы, labs: анализы, settings: current } = latest.current
    // Ключ сопряжения — связь этого телефона с этим тонометром; в чужом
    // дневнике ему делать нечего, а в общей семейной папке — тем более.
    const { backupLastAt: _at, backupLastCount: _count, backupLastSignature: _sig, pairingKey: _key, ...rest } = current
    // Надгробия читаются из хранилища, а не из состояния экрана: в интерфейсе
    // их нет и быть не должно — удалённого человек видеть не хочет.
    const tombstones = await getAllTombstones().catch(() => [])
    return toJson({ measurements: items, medicines: pills, regimens: курсы, labs: анализы, tombstones, settings: rest })
  }

  /**
   * Что уходит наружу — открытый дневник или конверт.
   *
   * Одна на все три пути: автокопию, «сохранить в файл» и «поделиться».
   * Раздельно это уже разошлось — конверт готовила только автокопия, а кнопка
   * «поделиться» при включённом шифровании отправляла в облако открытый
   * дневник. Молча и ровно туда, от чего пароль и защищает.
   *
   * `null` означает «не пишем»: шифрование включено, а пароля нет.
   */
  const envelope = useCallback(async (): Promise<string | null> => {
    const plain = await snapshot()
    if (!latest.current.settings.backupEncrypt) return plain
    const пароль = backupPassword()
    if (!пароль) return null
    return encryptBackup(plain, пароль).catch(() => null)
  }, [])

  useEffect(() => {
    void requestDurability().then(setDurable)
    void backupTarget.current().then(setTarget)
  }, [])

  const markDone = useCallback((saved: number, слепок: string) => {
    const { settings: current, onSettings: save } = latest.current
    save({ ...current, backupLastAt: Date.now(), backupLastCount: saved, backupLastSignature: слепок })
  }, [])

  // Автоматическая копия: пишем, как только дневник разошёлся с файлом.
  useEffect(() => {
    if (!ready || !target) return
    const { settings: current, measurements: items, medicines: pills } = latest.current
    const total = items.length + pills.length

    const надо = shouldWriteBackup(
      { lastAt: current.backupLastAt, lastCount: current.backupLastCount, lastSignature: current.backupLastSignature },
      total,
      { written: writtenLock.current, current: lock },
      force.current,
      signature,
    )
    // Замок запоминаем и когда не пишем: молчание означает «в файле уже то,
    // чем его закрывали», и следующая смена пароля должна это заметить.
    if (!надо) {
      writtenLock.current = lock
      return
    }

    let cancelled = false
    void (async () => {
      const содержимое = await envelope()
      // Пароля нет — молчим и цель не сбрасываем: это не пропавший файл, а
      // незаконченная настройка, и о ней экран говорит своими словами. Замок
      // при этом не запоминаем: в файле по-прежнему прежнее содержимое.
      if (содержимое === null) return
      const result = await backupTarget.write(содержимое)
      if (cancelled) return
      if (result === 'ok') {
        force.current = false
        writtenLock.current = lock
        setFailed(false)
        setStalled(false)
        markDone(total, signature)
      } else if (result === 'retry') {
        // Файл на месте, доступ цел — недоступна сама папка. Отвязывать её
        // из-за выключенной сети нельзя: человек будет искать файл заново.
        setStalled(true)
      } else {
        // Цель пропала. Молчать нельзя: человек считает, что копии идут.
        setFailed(true)
        setStalled(false)
        setTarget(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [ready, target, signature, settings.backupLastSignature, settings.backupLastAt, lock, markDone, envelope])

  const readTarget = useCallback(() => backupTarget.read(), [])

  const chooseTarget = useCallback(async () => {
    setBusy(true)
    try {
      const name = await backupTarget.choose(backupFilename(Date.now(), latest.current.settings.people.find((p) => p.id === latest.current.settings.activePerson)?.name))
      if (name) {
        setTarget(name)
        setFailed(false)
        setStalled(false)
        // Новый файл пуст. Пишем в него сразу, не глядя на счётчики: иначе он
        // так и останется пустым под надписью «сохраняется само».
        writtenLock.current = null
        force.current = true
      }
    } finally {
      setBusy(false)
    }
  }, [])

  const forgetTarget = useCallback(async () => {
    await backupTarget.forget()
    setTarget(null)
    setFailed(false)
    setStalled(false)
  }, [])

  /** Ручное сохранение — работает везде, в том числе там, где автокопий нет. */
  const saveNow = useCallback(async () => {
    setBusy(true)
    try {
      const содержимое = await envelope()
      if (содержимое === null) return
      const saved = await download(backupFilename(Date.now()), содержимое, 'application/json')
      // Отметку ставим только при подтверждённом сохранении — ровно как в
      // shareNow ниже. На телефоне «сохранить» проходит через системное окно, и
      // отказ от него означает, что копии нет.
      if (saved) {
        const { measurements: м, medicines: л, regimens: к, labs: а } = latest.current
        markDone(м.length + л.length + к.length + а.length, diarySignature(м, л, к, а, []))
      }
    } finally {
      setBusy(false)
    }
  }, [markDone, envelope])

  /**
   * Передача копии наружу. На телефоне это важнее скачивания: скачанный файл
   * лежит в той же памяти, что и дневник, и пропадает вместе с телефоном.
   */
  const shareNow = useCallback(async () => {
    setBusy(true)
    try {
      const содержимое = await envelope()
      if (содержимое === null) return
      const sent = await shareFile(backupFilename(Date.now()), содержимое, 'application/json')
      // Отметку ставим только при подтверждённой передаче: закрытое окно
      // «поделиться» означает, что копии нет, и делать вид иначе нельзя.
      if (sent) {
        const { measurements: м, medicines: л, regimens: к, labs: а } = latest.current
        markDone(м.length + л.length + к.length + а.length, diarySignature(м, л, к, а, []))
      }
    } finally {
      setBusy(false)
    }
  }, [markDone, envelope])

  return {
    supported,
    target,
    durable,
    warning: backupWarning(
      { lastAt: settings.backupLastAt, lastCount: settings.backupLastCount },
      count,
      Date.now(),
    ),
    behind: recordsBehind({ lastAt: settings.backupLastAt, lastCount: settings.backupLastCount }, count),
    lastAt: settings.backupLastAt,
    count,
    busy,
    failed,
    stalled,
    chooseTarget,
    forgetTarget,
    saveNow,
    canShare: canShareFile(),
    shareNow,
    password,
    setPassword,
    locked,
    readTarget,
  }
}
