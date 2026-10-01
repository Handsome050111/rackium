import { useRef, useState } from 'react'
import { Eraser } from 'lucide-react'

// Optional drawn signature (brief Step 7: "optional drawn signature").
// Plain canvas, mouse + touch, no library needed for this.
export default function SignaturePad({ onChange }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const [hasStrokes, setHasStrokes] = useState(false)

  function point(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top
    return { x, y }
  }

  function start(e) {
    e.preventDefault()
    drawing.current = true
    const ctx = canvasRef.current.getContext('2d')
    const { x, y } = point(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  function move(e) {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current.getContext('2d')
    const { x, y } = point(e)
    ctx.lineTo(x, y)
    ctx.strokeStyle = '#094F9A'
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.stroke()
    if (!hasStrokes) {
      setHasStrokes(true)
      onChange?.(true)
    }
  }

  function end() {
    drawing.current = false
  }

  function clear() {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    setHasStrokes(false)
    onChange?.(false)
  }

  return (
    <div className="space-y-1.5">
      <div className="relative overflow-hidden rounded-lg border border-border bg-white">
        <canvas
          ref={canvasRef}
          width={360}
          height={120}
          className="h-[120px] w-full touch-none"
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
        />
        {!hasStrokes && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-text-secondary">Sign here (optional)</span>}
      </div>
      {hasStrokes && (
        <button type="button" onClick={clear} className="flex items-center gap-1 text-[11px] text-text-secondary hover:text-text">
          <Eraser size={12} strokeWidth={2} />
          Clear signature
        </button>
      )}
    </div>
  )
}
