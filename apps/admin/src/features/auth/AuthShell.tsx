import { type ReactNode, useEffect, useRef } from 'react';
import { BrandLogo } from '@/components/BrandLogo';
import { useTranslation } from 'react-i18next';

/**
 * AuthShell — the two-panel auth layout (Ink-Navy brand hero left, form panel
 * right) extracted from the original `LoginPage.tsx` (Claude Design contract
 * `Login.dc.html`) so `LoginPage`, and plan 14-11's `ResetPasswordRequestPage`/
 * `ResetPasswordPage`, share one shell instead of hand-duplicating the brand
 * panel and its live door-to-door pin canvas animation a second/third time.
 *
 * The hero panel's four bespoke type sizes (40px headline, 22px wordmark,
 * 15px hero body, 13px eyebrow chip) are the UI-SPEC's formally named, scoped
 * typography exception — moved across UNCHANGED, not migrated to the 4-size
 * admin scale. The canvas pin animation is likewise moved verbatim (compare
 * against the pre-extraction `LoginPage.tsx` — no logic was rewritten).
 */
export function AuthShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation('auth');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Live door-to-door pin field — faithful port of the design's canvas logic.
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let W = 0;
    let H = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      const r = cv.getBoundingClientRect();
      W = r.width;
      H = r.height;
      cv.width = W * dpr;
      cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    type Pin = {
      x: number;
      y: number;
      born: number;
      success: boolean;
      resolveAt: number;
      life: number;
    };
    const pins: Pin[] = [];
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const textBox = () => ({ x: 0, y: H * 0.28, w: 520, h: H * 0.5 });
    const spawn = () => {
      const b = textBox();
      let x = 0;
      let y = 0;
      let tries = 0;
      do {
        x = rnd(40, W - 40);
        y = rnd(50, H - 60);
        tries++;
      } while (tries < 24 && x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h);
      pins.push({
        x,
        y,
        born: performance.now(),
        success: Math.random() < 0.62,
        resolveAt: rnd(900, 1500),
        life: rnd(3400, 4400),
      });
    };

    const drawPin = (x: number, y: number, s: number, alpha: number, color: string) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y);
      ctx.scale(s, s);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-9, -12, -8, -22, 0, -22);
      ctx.bezierCurveTo(8, -22, 9, -12, 0, 0);
      ctx.fill();
      ctx.fillStyle = '#12203A';
      ctx.beginPath();
      ctx.arc(0, -15, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    const drawBadge = (x: number, y: number, s: number, alpha: number, success: boolean) => {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y - 30);
      ctx.scale(s, s);
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.fillStyle = success ? '#2F8F5B' : '#C0362C';
      ctx.fill();
      ctx.strokeStyle = '#12203A';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (success) {
        ctx.moveTo(-4, 0);
        ctx.lineTo(-1, 3.4);
        ctx.lineTo(4.4, -3.4);
      } else {
        ctx.moveTo(-3.4, -3.4);
        ctx.lineTo(3.4, 3.4);
        ctx.moveTo(3.4, -3.4);
        ctx.lineTo(-3.4, 3.4);
      }
      ctx.stroke();
      ctx.restore();
    };

    if (reduced) {
      for (let i = 0; i < 6; i++) spawn();
      for (const p of pins) {
        drawPin(p.x, p.y, 0.9, 0.5, p.success ? '#3faf72' : '#d6473c');
      }
      window.removeEventListener('resize', resize);
      return;
    }

    for (let i = 0; i < 3; i++) {
      pins.push({
        x: rnd(60, W - 60),
        y: rnd(60, H - 60),
        born: performance.now() - rnd(0, 800),
        success: Math.random() < 0.62,
        resolveAt: rnd(900, 1500),
        life: rnd(3400, 4400),
      });
    }
    let lastSpawn = performance.now();
    let raf = 0;
    const easeOut = (t: number) => 1 - (1 - t) ** 3;
    const easeBack = (t: number) => {
      const c = 1.9;
      return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
    };

    const frame = (now: number) => {
      ctx.clearRect(0, 0, W, H);
      if (now - lastSpawn > rnd(650, 1150) && pins.length < 9) {
        spawn();
        lastSpawn = now;
      }
      for (let i = pins.length - 1; i >= 0; i--) {
        if (now - pins[i]!.born >= pins[i]!.life) pins.splice(i, 1);
      }
      for (const p of pins) {
        const age = now - p.born;
        const fadeOut = age > p.life - 700 ? Math.max(0, (p.life - age) / 700) : 1;
        const drop = easeOut(Math.min(1, age / 400));
        const yOff = (1 - drop) * -26;
        const inAlpha = Math.min(1, age / 260);
        const baseAlpha = 0.5 * inAlpha * fadeOut;
        const resolved = age > p.resolveAt;
        const pinColor = resolved ? (p.success ? '#3faf72' : '#d6473c') : 'rgba(245,246,248,.5)';
        drawPin(p.x, p.y + yOff, 0.9 + drop * 0.1, baseAlpha, pinColor);
        if (!resolved && age > 300) {
          const rt = ((age - 300) % 1100) / 1100;
          ctx.save();
          ctx.globalAlpha = (1 - rt) * 0.26 * fadeOut;
          ctx.strokeStyle = '#F5F6F8';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(p.x, p.y - 2, 4 + rt * 20, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        if (resolved) {
          const bt = Math.min(1, (age - p.resolveAt) / 420);
          drawBadge(p.x, p.y, 0.5 + easeBack(bt) * 0.5, 0.85 * fadeOut, p.success);
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <div className="flex min-h-screen">
      {/* LEFT · brand / live door-to-door field */}
      <div
        className="relative hidden flex-[1.1] overflow-hidden bg-ink md:block"
        style={{
          backgroundImage:
            'linear-gradient(rgba(245,246,248,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(245,246,248,.05) 1px,transparent 1px)',
          backgroundSize: '38px 38px',
        }}
      >
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-0 h-full w-full" />
        <div className="relative z-[1] flex h-full flex-col justify-between px-14 py-[52px]">
          <div className="flex items-center gap-3">
            <BrandLogo size={38} />
            <span className="font-display text-[22px] font-medium text-paper">FrontDoorSales</span>
          </div>

          <div className="max-w-[440px]">
            <div className="mb-[18px] font-sans text-[12px] font-medium uppercase tracking-[0.14em] text-porch">
              {t('login.heroEyebrow')}
            </div>
            <div className="text-balance font-display text-[40px] font-medium leading-[46px] text-paper">
              {t('login.heroHeadline')}
            </div>
            <div className="mt-4 max-w-[400px] text-[15px] leading-[23px] text-paper/[.66]">
              {t('login.heroBody')}
            </div>
          </div>

          <div className="font-mono text-[11px] text-paper/40">{t('login.heroFooter')}</div>
        </div>
      </div>

      {/* RIGHT · form */}
      <div className="flex flex-[.92] items-center justify-center bg-paper p-xl">{children}</div>
    </div>
  );
}
