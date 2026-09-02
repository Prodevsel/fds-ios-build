import { type PointerEvent as ReactPointerEvent, useCallback, useRef, useState } from 'react';
import type { StrokePoint } from './auditPackage';
import { COPY } from './copy';

/**
 * The signature surface: a plain `<canvas>` driven by pointer events.
 *
 * NO NEW DEPENDENCY, on purpose. `react-native-signature-canvas` — the library
 * the app uses — is React Native only and could not run here at all; and pulling
 * a web drawing library into a bundle whose whole selling point is that it
 * contains react, react-dom and nothing else would cost more than the hundred
 * lines below. The bundle-isolation check would reject it anyway.
 *
 * Pointer events rather than mouse or touch events: one code path covers a
 * finger on the customer's phone (the normal case), a stylus, and a mouse on a
 * laptop. `setPointerCapture` is what keeps a stroke attached to the canvas when
 * the finger slides past its edge mid-signature — without it a stroke that
 * leaves the box silently stops recording and the customer sees his signature
 * cut off with no explanation.
 *
 * The stroke shape MIRRORS what AuditPackage.signatureStrokeData already
 * carries in the app: an array of point groups, one group per stroke. There is
 * deliberately NO `pressure` field. 04-STROKE-SPIKE.md established that the
 * tested device does not report one and forbids synthesizing a value — an
 * invented pressure reading in an evidence package is worse than an absent one.
 */

export interface SignatureCapture {
  strokes: StrokePoint[][];
  pngDataUrl: string;
}

export interface SignaturePadProps {
  /** Called after every completed stroke, and with null after a clear. */
  onChange: (capture: SignatureCapture | null) => void;
  /**
   * Rasterizer, injected. The default asks the canvas itself.
   *
   * It is a prop because jsdom implements `<canvas>` only as far as the DOM
   * node: `getContext('2d')` yields null and `toDataURL` is not implemented
   * unless the optional native `canvas` package is installed, which this
   * workspace does not have and this plan does not add. Tests inject a stub and
   * still exercise every line of the pointer handling below. Same DI reasoning
   * as the injected digest function in auditPackage.ts — stub the boundary the
   * environment does not provide, do not fake the logic behind it.
   */
  renderPng?: (canvas: HTMLCanvasElement) => string | null;
  disabled?: boolean;
}

const CANVAS_WIDTH = 600;
const CANVAS_HEIGHT = 220;

/**
 * The 2d context, looked up ONCE per pad and remembered — including a
 * remembered failure. Asking again on every segment of every stroke would ask
 * an environment that has already said no, and under jsdom that answer arrives
 * as a console warning per call, drowning a test run in noise about something
 * that is neither new nor a fault.
 */
function context(
  canvas: HTMLCanvasElement | null,
  cache: { current: CanvasRenderingContext2D | null | undefined },
): CanvasRenderingContext2D | null {
  if (cache.current !== undefined) return cache.current;
  if (!canvas) return null;
  try {
    cache.current = canvas.getContext('2d');
  } catch {
    cache.current = null;
  }
  return cache.current;
}

function defaultRenderPng(canvas: HTMLCanvasElement): string | null {
  try {
    return canvas.toDataURL('image/png');
  } catch {
    // A canvas that cannot be read out is not a signature. Returning null keeps
    // the submit button disabled rather than sending an empty image that would
    // become a contract with a blank signature attached.
    return null;
  }
}

export function SignaturePad({ onChange, renderPng = defaultRenderPng, disabled }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null | undefined>(undefined);
  const strokesRef = useRef<StrokePoint[][]>([]);
  const currentRef = useRef<StrokePoint[] | null>(null);
  const [hasInk, setHasInk] = useState(false);

  /**
   * Canvas coordinates, not page coordinates. The element is laid out
   * responsively (`width: 100%`) while its bitmap stays a fixed size, so a raw
   * clientX would drift further from the drawn line the narrower the phone.
   */
  const toPoint = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): StrokePoint => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;
    return {
      x: Math.round((event.clientX - rect.left) * scaleX),
      y: Math.round((event.clientY - rect.top) * scaleY),
      t: Date.now(),
    };
  }, []);

  const drawSegment = useCallback((from: StrokePoint, to: StrokePoint) => {
    const ctx = context(canvasRef.current, contextRef);
    // Null in jsdom, and null on any browser that refuses the context. Drawing
    // is presentation; the stroke data above is the evidence, and it is
    // recorded either way.
    if (!ctx) return;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111111';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }, []);

  function onPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    // Without capture, a finger that leaves the box takes the rest of the
    // stroke with it and never fires pointerup here.
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const point = toPoint(event);
    currentRef.current = [point];
    // A single tap must leave a visible dot, so the first point draws against
    // itself rather than waiting for a second one.
    drawSegment(point, point);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const current = currentRef.current;
    if (!current) return;
    const point = toPoint(event);
    const previous = current[current.length - 1];
    current.push(point);
    if (previous) drawSegment(previous, point);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLCanvasElement>) {
    const current = currentRef.current;
    if (!current) return;
    currentRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (current.length === 0) return;
    strokesRef.current = [...strokesRef.current, current];
    setHasInk(true);

    const canvas = canvasRef.current;
    const pngDataUrl = canvas ? renderPng(canvas) : null;
    // No image means no capture, even though strokes were recorded: the
    // contract needs both, and half of it is not a signature.
    onChange(pngDataUrl ? { strokes: strokesRef.current, pngDataUrl } : null);
  }

  function clear() {
    strokesRef.current = [];
    currentRef.current = null;
    setHasInk(false);
    const ctx = context(canvasRef.current, contextRef);
    if (ctx && canvasRef.current) {
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    onChange(null);
  }

  return (
    <div>
      <p style={{ lineHeight: 1.6 }}>{COPY.signatureHint}</p>
      <canvas
        ref={canvasRef}
        data-testid="signature-canvas"
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          width: '100%',
          height: 'auto',
          aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`,
          border: '1px solid #999',
          borderRadius: '4px',
          // Without this the browser treats a drag on the canvas as a page
          // scroll and the customer cannot sign at all on a phone.
          touchAction: 'none',
          background: '#fff',
        }}
      />
      <button
        type="button"
        data-testid="signature-clear"
        onClick={clear}
        disabled={!hasInk}
        style={{ marginTop: '0.5rem', padding: '0.5rem 1rem' }}
      >
        {COPY.signatureClear}
      </button>
    </div>
  );
}
