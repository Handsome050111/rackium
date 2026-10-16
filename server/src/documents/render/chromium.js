// The PDF renderer's settings, kept apart from the renderer itself so that
// configuring it (app start) does not load Chromium or pdf.js (M6b review).
export const pdfSettings = { chromiumPath: null }
export function configurePdf({ chromiumPath = null } = {}) {
  pdfSettings.chromiumPath = chromiumPath || null
}
// Closes the browser only if the renderer was ever loaded.
export async function closePdfBrowserIfLoaded() {
  if (!pdfSettings.loaded) return
  const { closePdfBrowser } = await import('./pdf.js')
  await closePdfBrowser()
}
