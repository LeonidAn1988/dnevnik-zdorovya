import { useEffect, useImperativeHandle, useRef, useState } from 'react'
import { NumberField } from './NumberField'
import { WheelField } from './WheelField'

/**
 * Ввод числа тем способом, который уместен на этом устройстве.
 *
 * Пальцем — барабан: значение лежит в известном диапазоне, прокрутка начинается
 * от текущего, клавиатура не закрывает пол-экрана. Мышью — поле с клавиатуры и
 * кнопками шага: набрать «128» быстрее, чем крутить.
 *
 * В редакторе строки барабан не используется: там правят на единицу-две, и три
 * колеса по 200px вытеснили бы саму запись с экрана.
 */

export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() =>
    typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)').matches : false,
  )
  useEffect(() => {
    const query = matchMedia('(pointer: coarse)')
    const update = () => setCoarse(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return coarse
}

export function ValueField({
  label,
  unit,
  value,
  onChange,
  min,
  max,
  start,
  step = 1,
  decimals = 0,
  placeholder,
  ariaSuffix,
  inputRef,
  required,
  axis,
}: {
  label: string
  unit?: string
  value: string
  onChange: React.Dispatch<React.SetStateAction<string>>
  min: number
  max: number
  start: number
  step?: number
  decimals?: number
  placeholder?: string
  ariaSuffix?: string
  inputRef?: React.Ref<{ focus(): void }>
  required?: boolean
  /** Ось барабана. На мыши не используется. */
  axis?: 'x' | 'y'
}) {
  const coarse = useCoarsePointer()
  const desktopRef = useRef<HTMLInputElement>(null)
  const wheelRef = useRef<HTMLDivElement>(null)
  useImperativeHandle(inputRef, () => ({ focus: () => (coarse ? wheelRef.current : desktopRef.current)?.focus() }), [coarse])

  if (coarse) {
    return (
      <WheelField
        label={label}
        unit={unit}
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        start={start}
        step={step}
        decimals={decimals}
        ariaSuffix={ariaSuffix}
        axis={axis}
        inputRef={wheelRef}
      />
    )
  }

  return (
    <NumberField
      label={label}
      unit={unit}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      min={min}
      max={max}
      start={start}
      step={step}
      decimals={decimals}
      inputRef={desktopRef}
      required={required}
    />
  )
}
