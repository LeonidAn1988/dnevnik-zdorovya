/**
 * Уменьшение снимка бланка перед тем, как класть его в базу.
 *
 * С камеры телефона приходит двенадцать мегапикселей и четыре мегабайта. Бланк
 * анализа — это лист А4 с текстом: чтобы прочитать его на телефоне и показать
 * врачу, хватает длинной стороны в 1600 точек, а весит такой снимок около
 * трёхсот килобайт. Двадцать бланков — шесть мегабайт вместо восьмидесяти.
 *
 * Живёт в интерфейсе, а не в ядре: `canvas` — это DOM, а ядро обязано
 * собираться и работать без браузера (`tests/portability.test.mjs`).
 */

/** Длинная сторона после уменьшения. */
const MAX_SIDE = 1600

/** Качество JPEG. 0,82 — текст на бланке ещё читается, ореолов уже нет. */
const QUALITY = 0.82

export interface Shrunk {
  blob: Blob
  width: number
  height: number
  bytes: number
}

/**
 * Уменьшить снимок. Если он и так мал, пересжатия не делаем: второй проход
 * через JPEG только портит текст.
 */
export async function shrink(file: File | Blob): Promise<Shrunk> {
  const образ = await загрузить(file)
  const { width, height } = образ
  const сторона = Math.max(width, height)

  if (сторона <= MAX_SIDE && file.size <= 600_000) {
    освободить(образ)
    return { blob: file, width, height, bytes: file.size }
  }

  const k = Math.min(1, MAX_SIDE / сторона)
  const w = Math.max(1, Math.round(width * k))
  const h = Math.max(1, Math.round(height * k))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    освободить(образ)
    throw new Error('Не удалось подготовить снимок')
  }
  ctx.drawImage(образ, 0, 0, w, h)
  освободить(образ)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY))
  if (!blob) throw new Error('Не удалось уменьшить снимок')
  return { blob, width: w, height: h, bytes: blob.size }
}

/**
 * Прочитать файл в изображение.
 *
 * `createImageBitmap` быстрее и не держит DOM-узел, но в старом WebView его
 * может не быть — тогда обычный `Image` через `objectURL`.
 */
async function загрузить(file: File | Blob): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file)
    } catch {
      // Битый или незнакомый формат — пробуем вторым путём, он терпимее.
    }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Это не похоже на снимок'))
      img.src = url
    })
  } finally {
    // Ссылку отпускаем сразу: картинка уже разобрана в память.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

function освободить(образ: ImageBitmap | HTMLImageElement) {
  if ('close' in образ && typeof образ.close === 'function') образ.close()
}

/** Размер по-человечески: «2,4 МБ». */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`
}
