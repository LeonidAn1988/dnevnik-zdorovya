import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from './App'
import { installWebPlatform } from './platform/web'
import './app.css'
import './modern.css'

const native = Capacitor.isNativePlatform()

/**
 * Платформа выбирается один раз и до первой отрисовки: ядро обращается к портам
 * сразу. Один и тот же исходник даёт и сайт, и приложение — различаются только
 * реализации четырёх портов.
 *
 * Нативная половина подгружается отдельным куском и только на телефоне. При
 * обычном импорте она попадала и в сайт: плагины Bluetooth, файлов и
 * «поделиться» утяжеляли веб-бандл на четверть сотни килобайт ради кода,
 * который в браузере не выполнится никогда.
 */
async function start() {
  if (native) {
    const { installCapacitorPlatform } = await import('./platform/capacitor')
    installCapacitorPlatform()
  } else {
    installWebPlatform()
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()

/**
 * Офлайн-кэш нужен только сайту.
 *
 * В приложении весь бандл уже лежит внутри пакета, работать без сети он умеет
 * по построению, а живой служебный работник только вредит: после обновления из
 * магазина он подсунет из кэша прежнюю версию. В разработке он мешает горячей
 * перезагрузке, поэтому и там выключен.
 */
if (import.meta.env.PROD && !native && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('sw.js', document.baseURI)).catch(() => {
      /* офлайн — приятный бонус, а не обязательное условие */
    })
  })
}
