// Integer minor units + ISO-4217 currency (DATA-MODEL §0) for display.
export function formatMinor(minor, currency) {
  if (minor == null || !currency) return null
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format(minor / 100)
}

// "1234.5" / "1234,50" -> 123450; '' -> null; anything else -> NaN.
export function parseToMinor(text) {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return null
  const n = Number(trimmed.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN
}
