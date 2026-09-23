/**
 * Реализация FilePort в браузере: временная ссылка на Blob.
 *
 * На нативных платформах здесь будет системный диалог сохранения или «поделиться»,
 * а ядро об этом не узнает.
 */

import type { FilePort } from '../ports'

export const webFiles: FilePort = {
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

  /** В браузере «поделиться» текстом умеет тот же системный лист. */
  async shareText(text: string, title: string) {
    const share = navigator.share?.bind(navigator)
    if (!share) return false
    try {
      await share({ title, text })
      return true
    } catch {
      return false
    }
  },

  /** В браузере ссылка и так открывается в браузере — новой вкладкой. */
  async openExternal(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer')
  },

  async save(filename, content, mime) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
    // Освобождаем не сразу: Safari успевает начать скачивание только после кадра.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    // Скачивание в браузере отменить нельзя — файл ушёл в загрузки.
    return true
  },

  canShare() {
    // Проверяем именно передачу файлов: navigator.share есть и там, где умеет
    // только ссылку с текстом, а нам нужен файл.
    if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
    try {
      return navigator.canShare({ files: [new File([''], 'проба.json', { type: 'application/json' })] })
    } catch {
      return false
    }
  },

  async share(filename, content, mime) {
    const file = new File([content], filename, { type: mime })
    try {
      await navigator.share({ files: [file], title: filename })
      return true
    } catch (error) {
      // Закрытое окно «поделиться» — не ошибка.
      if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError')) {
        return false
      }
      throw error
    }
  },

  async shareBlob(filename, blob, mime) {
    const file = new File([blob], filename, { type: mime })
    try {
      await navigator.share({ files: [file], title: filename })
      return true
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError')) {
        return false
      }
      throw error
    }
  },

  async print(jobName: string) {
    void jobName
    // Заголовок вкладки браузер подставляет в имя файла сам, и менять его
    // ради печати — значит оставить человека с чужим заголовком, если он
    // передумает печатать.
    window.print()
    // Браузер не сообщает, напечатали или отменили. Врать «не получилось»
    // хуже, чем промолчать: диалог человек видел своими глазами.
    return true
  },
}
