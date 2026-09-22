/**
 * Камеры в браузере у нас нет.
 *
 * `getUserMedia` дал бы поток с веб-камеры, но бланк анализа снимают телефоном,
 * а не ноутбуком, и городить собственный видоискатель ради этого незачем.
 * Поэтому в вебе снимок выбирают файлом — тем же полем, что и всегда.
 */

import type { CameraPort } from '../ports'

export const webCamera: CameraPort = {
  canCapture() {
    return false
  },

  async take() {
    return null
  },
}
