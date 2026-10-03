import { useCallback, useEffect, useRef, useState } from 'react'
import { encryptBackup } from '../logic/crypto'
import type { LabTest, Measurement, Medicine, Regimen, Settings, Tombstone } from '../types'
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

function savedSettings(settings: Settings) {
  const { backupLastAt: _at, backupLastCount: _count, backupLastSignature: _sig, pairingKey: _key, ...rest } = settings
  return rest
}

function signatureOf(data: { measurements: Measurement[]; medicines: Medicine[]; regimens: Regimen[]; labs: LabTest[]; settings: Settings; tombstones: Tombstone[] | null }): string {
  return `${diarySignature(data.measurements, data.medicines, data.regimens, data.labs, data.tombstones ?? [])}|${JSON.stringify(savedSettings(data.settings))}`
}

interface GraveSnapshot {
  measurements: Measurement[]
  medicines: Medicine[]
  regimens: Regimen[]
  labs: LabTest[]
  items: Tombstone[]
}

function sameRecords(a: Omit<GraveSnapshot, 'items'>, b: Omit<GraveSnapshot, 'items'>): boolean {
  return a.measurements === b.measurements && a.medicines === b.medicines && a.regimens === b.regimens && a.labs === b.labs
}

const sortGraves = (items: Tombstone[]) => [...items].sort((a, b) => a.id.localeCompare(b.id))

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
  const [graveSnapshot, setGraveSnapshot] = useState<GraveSnapshot | null>(null)
  // Прежнее успешное чтение не подтверждает новый набор записей. Уже во время
  // рендера блокируем копию, пока для этого набора не прочитаны следы удаления.
  const records = { measurements, medicines, regimens, labs }
  const tombstones = ready && graveSnapshot && sameRecords(graveSnapshot, records) ? graveSnapshot.items : null
  useEffect(() => {
    if (!ready) return
    let current = true
    void getAllTombstones().then(items => {
      if (!current) return
      setGraveSnapshot({ measurements, medicines, regimens, labs, items: sortGraves(items) })
    }).catch(() => { if (current) setStalled(true) })
    return () => { current = false }
  }, [ready, measurements, medicines, regimens, labs])
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
   * Считаем измерения, коробки, курсы и анализы. Иначе внесённая аптечка не сдвигала
   * счётчик, копия не обновлялась и не предупреждала — а введена она руками и
   * теряется так же безвозвратно, как измерение.
   */
  const count = measurements.length + medicines.length + regimens.length + labs.length

  /**
   * Слепок содержимого: он и решает, писать ли копию.
   *
   * Входят и следы удаления: семейный обмен может привезти только их, без
   * изменения числа видимых записей. Такой обмен тоже должен обновить копию.
   */
  const signature = signatureOf({ measurements, medicines, regimens, labs, settings, tombstones })
  const writes = useRef<Promise<void>>(Promise.resolve())

  /**
   * При начале записи захватываем данные и настройки вместе. Служебная
   * отметка о сохранении исключена из слепка и не запускает новую копию.
   */
  const latest = useRef({ settings, measurements, medicines, regimens, labs, tombstones, onSettings })
  latest.current = { settings, measurements, medicines, regimens, labs, tombstones, onSettings }

  /**
   * Что уходит в копию. Одних измерений мало: аптечка и настройки тоже введены
   * руками и теряются так же безвозвратно. Служебные поля про сами копии из
   * снимка исключены — они описывают устройство, а не данные.
   */
  const snapshot = async (captured = latest.current) => {
    const { measurements: items, medicines: pills, regimens: курсы, labs: анализы, settings: current } = captured
    // Ключ сопряжения — связь этого телефона с этим тонометром; в чужом
    // дневнике ему делать нечего, а в общей семейной папке — тем более.
    const rest = savedSettings(current)
    // Надгробия читаются из хранилища, а не из состояния экрана: в интерфейсе
    // их нет и быть не должно — удалённого человек видеть не хочет.
    // Каждый файл, включая ручной, требует нового успешного чтения. Кэш нужен
    // только для решения «пора ли писать», а не как запасной источник копии.
    const graves = sortGraves(await getAllTombstones())
    if (sameRecords(captured, latest.current)) {
      setGraveSnapshot(old => old && sameRecords(old, captured) && JSON.stringify(old.items) === JSON.stringify(graves)
        ? old : { ...captured, items: graves })
    }
    return {
      plain: toJson({ measurements: items, medicines: pills, regimens: курсы, labs: анализы, tombstones: graves, settings: rest }),
      signature: signatureOf({ ...captured, tombstones: graves }),
      count: items.length + pills.length + курсы.length + анализы.length,
    }
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
  const envelope = useCallback(async (captured = latest.current) => {
    const пароль = backupPassword()
    const prepared = await snapshot(captured).catch(() => { setStalled(true); return null })
    if (prepared === null) return null
    if (!captured.settings.backupEncrypt) return { ...prepared, content: prepared.plain }
    if (!пароль) return null
    const content = await encryptBackup(prepared.plain, пароль).catch(() => null)
    return content === null ? null : { ...prepared, content }
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
    if (!ready || !target || tombstones === null) return
    const captured = latest.current
    const { settings: current } = captured
    const total = captured.measurements.length + captured.medicines.length + captured.regimens.length + captured.labs.length

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
    writes.current = writes.current.catch(() => undefined).then(async () => {
      if (cancelled) return
      const содержимое = await envelope(captured)
      // Пароля нет — молчим и цель не сбрасываем: это не пропавший файл, а
      // незаконченная настройка, и о ней экран говорит своими словами. Замок
      // при этом не запоминаем: в файле по-прежнему прежнее содержимое.
      if (содержимое === null || cancelled) return
      const result = await backupTarget.write(содержимое.content)
      if (cancelled) return
      if (result === 'ok') {
        force.current = false
        writtenLock.current = lock
        setFailed(false)
        setStalled(false)
        markDone(содержимое.count, содержимое.signature)
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
    }).catch(() => { if (!cancelled) setStalled(true) })
    return () => {
      cancelled = true
    }
  }, [ready, target, signature, settings.backupLastSignature, settings.backupLastAt, lock, markDone, envelope, tombstones])

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
      const captured = latest.current
      const содержимое = await envelope(captured)
      if (содержимое === null) return
      const saved = await download(backupFilename(Date.now()), содержимое.content, 'application/json')
      // Отметку ставим только при подтверждённом сохранении — ровно как в
      // shareNow ниже. На телефоне «сохранить» проходит через системное окно, и
      // отказ от него означает, что копии нет.
      if (saved) {
        markDone(содержимое.count, содержимое.signature)
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
      const captured = latest.current
      const содержимое = await envelope(captured)
      if (содержимое === null) return
      const sent = await shareFile(backupFilename(Date.now()), содержимое.content, 'application/json')
      // Отметку ставим только при подтверждённой передаче: закрытое окно
      // «поделиться» означает, что копии нет, и делать вид иначе нельзя.
      if (sent) {
        markDone(содержимое.count, содержимое.signature)
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
