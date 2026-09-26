/**
 * Обновление приложения на Android: скачать APK и отдать установщику.
 *
 * Скачивание — штатным `Filesystem.downloadFile` в кэш приложения. Кэш выбран
 * не случайно: система вправе его вычистить, и это ровно то, что нужно — файл
 * живёт от нажатия «Обновить» до установки, а восьмимегабайтный APK, забытый в
 * общей памяти, не нужен никому.
 *
 * Установку делает система. Приложение только показывает ей файл через
 * `FileProvider`; дальше человек видит обычное окно установщика и решает сам.
 * Подпись проверяет тоже система: файл с чужим ключом поверх дневника не
 * встанет, и это единственная защита, которая здесь нужна и которой можно
 * доверять.
 */

import { registerPlugin } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'
import type { UpdatePort } from '../ports'

interface UpdaterPlugin {
  /** Разрешена ли установка приложений из этого источника. */
  canInstall(): Promise<{ allowed: boolean }>
  /** Экран, где это разрешение выдаётся. `opened: false` — экрана нет. */
  openInstallSettings(): Promise<{ opened: boolean }>
  /** Показать файл системному установщику. */
  install(options: { path: string }): Promise<void>
}

const Updater = registerPlugin<UpdaterPlugin>('Updater')

/**
 * Одно и то же имя: следующее скачивание затирает прежнее, а не копит файлы.
 *
 * Латиницей — по тому же правилу, что и имя файла в выпуске: кириллицу в пути
 * часть разборщиков адреса `content://` понимает неправильно, а установщик —
 * чужой код, проверить который нечем.
 */
const ФАЙЛ = 'update.apk'

export const capacitorUpdate: UpdatePort = {
  canSelfUpdate: () => true,

  async canInstall() {
    try {
      const { allowed } = await Updater.canInstall()
      return allowed
    } catch {
      return false
    }
  },

  async requestInstall() {
    try {
      const { opened } = await Updater.openInstallSettings()
      return opened
    } catch {
      return false
    }
  },

  async download(url, onProgress) {
    // Прежний файл сносим до скачивания, а не после: оборванная закачка иначе
    // оставила бы половину, и установщик получил бы битый файл.
    await Filesystem.deleteFile({ path: ФАЙЛ, directory: Directory.Cache }).catch(() => undefined)

    const слушатель = await Filesystem.addListener('progress', (событие) => {
      const всего = событие.contentLength ?? 0
      if (всего > 0) onProgress(Math.min(1, событие.bytes / всего))
    }).catch(() => null)

    try {
      const { path } = await Filesystem.downloadFile({
        url,
        path: ФАЙЛ,
        directory: Directory.Cache,
        // Без этого плагин не шлёт событий вовсе, и полоса стоит на месте.
        progress: true,
      })
      if (!path) throw new Error('скачано, но путь не вернулся')
      return path
    } finally {
      await слушатель?.remove()
    }
  },

  async install(path) {
    await Updater.install({ path })
  },
}
