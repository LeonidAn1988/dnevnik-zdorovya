/**
 * Реализация FilePort на Android.
 *
 * В WebView не работают ни `navigator.share`, ни скачивание по ссылке с Blob:
 * первого там просто нет, второе упирается в отсутствие папки загрузок у
 * страницы. Поэтому файл сначала пишется в каталог приложения, а потом
 * отдаётся системному «поделиться» по его адресу.
 */

import { registerPlugin } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import type { FilePort } from '../ports'

/**
 * Куда класть файл перед передачей.
 *
 * `Cache` — служебная папка приложения: система вправе её вычистить, и это
 * ровно то, что нужно. Файл живёт от нажатия «поделиться» до момента, когда его
 * заберёт мессенджер или облако; хранить его дольше незачем, а копия дневника,
 * лежащая в общей памяти телефона, — лишний риск.
 */
const HANDOFF = Directory.Cache

/**
 * Имя файла в адресе не должно содержать пробелов и кириллицы: часть приложений
 * получателей ломается на них при разборе `content://`. Читаемое имя всё равно
 * передаётся отдельно заголовком.
 */
const safeName = (filename: string): string => {
  const dot = filename.lastIndexOf('.')
  const ext = dot > 0 ? filename.slice(dot) : ''
  return `omron-${Date.now()}${ext}`
}

async function writeToCache(filename: string, content: string): Promise<string> {
  const path = safeName(filename)
  await Filesystem.writeFile({ path, data: content, directory: HANDOFF, encoding: Encoding.UTF8 })
  const { uri } = await Filesystem.getUri({ path, directory: HANDOFF })
  return uri
}

/**
 * Свой нативный плагин: системная печать содержимого WebView.
 *
 * Тот же плагин, что открывает системные экраны в напоминаниях, — описан здесь
 * отдельно и узко, ровно тем методом, который нужен файлам.
 */
interface SystemSettingsPrint {
  openLink(options: { url: string }): Promise<void>
  printPage(options: { jobName: string }): Promise<{ started: boolean }>
}

const SystemSettings = registerPlugin<SystemSettingsPrint>('SystemSettings')

export const capacitorFiles: FilePort = {
  /**
   * Скопировать текст в буфер обмена.
   *
   * Два пути, потому что первый подводит: `navigator.clipboard` требует
   * защищённого происхождения и разрешения, и в WebView отказывает молча.
   * Тогда остаётся старый приём с невидимым полем — он работает везде и не
   * требует ничего. Раньше на отказ первого пути список скачивался файлом:
   * человек нажимал «Скопировать» и получал загрузку.
   */
  async copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      try {
        const поле = document.createElement('textarea')
        поле.value = text
        поле.setAttribute('readonly', '')
        поле.style.position = 'fixed'
        поле.style.opacity = '0'
        document.body.appendChild(поле)
        поле.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(поле)
        return ok
      } catch {
        return false
      }
    }
  },

  async shareText(text: string, title: string) {
    try {
      // Текстом, а не файлом: получатель видит сообщение в ленте, а не
      // вложение, которое надо открыть.
      await Share.share({ title, text, dialogTitle: title })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/cancel/i.test(message)) return false
      throw error
    }
  },

  async openExternal(url: string) {
    // Решает система: если стоит приложение аптеки, откроется оно — там человек
    // уже вошёл, там его корзина. Проверено, что запрос при этом не теряется.
    await SystemSettings.openLink({ url }).catch(() => {
      window.open(url, '_blank', 'noopener,noreferrer')
    })
  },

  /**
   * «Сохранить» на телефоне — это тоже «поделиться».
   *
   * Отдельной папки загрузок, доступной приложению без разрешений, здесь нет, а
   * файл, спрятанный внутрь приложения, человек не найдёт. Системное окно даёт
   * выбор: сохранить в «Файлы», отправить в облако, переслать себе. Для копии
   * дневника это и есть нужное действие — она должна оказаться **за пределами**
   * телефона, иначе пропадёт вместе с ним.
   */
  async save(filename, content, mime) {
    // Ответ обязателен: человек мог закрыть окно, и тогда файла нет. Раньше
    // здесь стояло молчаливое `await` — приложение записывало «копия сделана»
    // на отменённое действие.
    return capacitorFiles.share(filename, content, mime)
  },

  canShare() {
    return true
  },

  async share(filename, content, _mime) {
    const uri = await writeToCache(filename, content)
    try {
      await Share.share({ title: filename, files: [uri] })
      return true
    } catch (error) {
      // Закрытое окно «поделиться» — не ошибка, а решение человека.
      const message = error instanceof Error ? error.message : String(error)
      if (/cancel/i.test(message)) return false
      throw error
    }
  },

  /**
   * Снимок бланка — двоичный файл, и в кэш он пишется без `encoding`: с ним
   * `Filesystem` пишет строку как текст, а без него — как base64. Отдаётся тот
   * же системный лист «поделиться», что и копии дневника.
   */
  async shareBlob(filename, blob, _mime) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      // `readAsDataURL` отдаёт «data:image/jpeg;base64,…» — Filesystem ждёт
      // только хвост после запятой.
      reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    const path = safeName(filename)
    await Filesystem.writeFile({ path, data: base64, directory: HANDOFF })
    const { uri } = await Filesystem.getUri({ path, directory: HANDOFF })
    try {
      await Share.share({ title: filename, files: [uri] })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/cancel/i.test(message)) return false
      throw error
    }
  },

  async print(jobName: string) {
    try {
      // `window.print()` внутри WebView не делает ничего — диалога печати у
      // него нет. Android печатает содержимое WebView штатно, и в списке
      // принтеров есть «Сохранить в PDF»: именно так отчёт уходит врачу.
      const { started } = await SystemSettings.printPage({ jobName })
      return started
    } catch {
      return false
    }
  },
}
