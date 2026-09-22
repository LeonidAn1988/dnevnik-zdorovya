/**
 * Камера на телефоне.
 *
 * `<input type="file" capture>` здесь не годится: проверено на Mate 60 Pro —
 * WebView Capacitor этот признак игнорирует и открывает проводник по
 * документам. Человеку, которому сказали «снять бланк», показывают список
 * папок «Загрузки», «Telegram», «СберБанк». Поэтому съёмка идёт через плагин:
 * он показывает системное «Снять» или «Из галереи» и сам просит разрешение.
 */

import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import type { CameraPort } from '../ports'

export const capacitorCamera: CameraPort = {
  canCapture() {
    return true
  },

  async take() {
    try {
      const снимок = await Camera.getPhoto({
        // Сжатие оставляем себе: у нас одна мерка на оба пути — и на съёмку, и
        // на выбор из галереи, — а у плагина она была бы только на съёмку.
        quality: 92,
        // Uri, а не Base64: строка в мегабайт проходит через мост целиком и на
        // старом телефоне это заметная пауза. По ссылке WebView читает сам.
        resultType: CameraResultType.Uri,
        source: CameraSource.Prompt,
        promptLabelHeader: 'Снимок бланка',
        promptLabelPhoto: 'Из галереи',
        promptLabelPicture: 'Снять камерой',
        promptLabelCancel: 'Отмена',
        // Правка кадра после съёмки только мешает: бланк снимают целиком, а
        // обрезка на маленьком экране приводит к потере половины листа.
        allowEditing: false,
        saveToGallery: false,
      })
      if (!снимок.webPath) return null
      const ответ = await fetch(снимок.webPath)
      return await ответ.blob()
    } catch {
      // Отказ человека и отказ в разрешении приходят сюда одинаково. Ни то ни
      // другое не ошибка приложения: молча возвращаем «ничего не выбрано».
      return null
    }
  },
}
