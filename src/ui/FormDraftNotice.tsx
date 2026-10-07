import { Banner } from './bits'

export function FormDraftNotice({ conflict, onReload, onKeep }: {
  conflict: boolean
  onReload: () => void
  onKeep: () => void
}) {
  if (!conflict) return null
  return <div role="alert"><Banner tone="warning">
    <b>Сохранённые данные изменились, пока вы заполняли форму.</b>
    <p>Ваш ввод остался в черновике. Загрузите свежие данные или оставьте свой ввод и проверьте его перед сохранением.</p>
    <div className="row">
      <button type="button" className="btn" onClick={onReload}>Загрузить свежие данные</button>
      <button type="button" className="btn" onClick={onKeep}>Оставить мой ввод</button>
    </div>
  </Banner></div>
}
