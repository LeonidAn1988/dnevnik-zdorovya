/** Временные раскрытые слои закрываются раньше основного стека экранов. */
const layers: (() => void)[] = []

export function registerBackLayer(close: () => void): () => void {
  layers.push(close)
  return () => {
    const index = layers.indexOf(close)
    if (index >= 0) layers.splice(index, 1)
  }
}

export function closeBackLayer(): boolean {
  const close = layers.pop()
  if (!close) return false
  close()
  return true
}
