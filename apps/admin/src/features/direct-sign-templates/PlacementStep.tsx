import { Button } from '@/components/ui/button';
import * as pdfjsLib from 'pdfjs-dist';
// Vite `?url` import — resolves to the built worker asset's URL at build time
// (the standard pdfjs-dist + Vite wiring; no bundler-specific worker plugin
// needed). GlobalWorkerOptions must be set before the first getDocument call.
// eslint-disable-next-line import/no-unresolved
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { type PageFraction, screenToPageFraction } from './pageFraction';
import {
  type TemplatePlacement,
  signDirectSignTemplate,
  useSaveFieldPlacements,
  useSaveTemplatePlacement,
} from './useDirectSignTemplates';
import type { Block, DirectSignFieldPlacement } from '@frontdoorsales/flow-schema';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

export { screenToPageFraction } from './pageFraction';
export type { PageFraction, PageRect } from './pageFraction';

interface PlacementStepProps {
  templateId: string;
  companyId: string;
  storagePath: string;
  /**
   * 0085: the question blocks this template's product will ask. The operator
   * places one anchor per block, so the customer's answer is written into the
   * company's own document instead of the document dictating a single variant.
   * Empty means "signature only" — the pre-0085 behaviour, unchanged.
   */
  questionBlocks?: Block[];
  /** Anchors already stored on the draft row, so a re-visit shows what is set. */
  fieldPlacements?: DirectSignFieldPlacement[];
  onSaved: () => void;
}

/**
 * Visual placement step (Task 3, D-03): renders the uploaded PDF's selected
 * page to a canvas via pdfjs-dist and lets the operator click to place the
 * signature marker. Persists {signature_page, signature_x_frac,
 * signature_y_frac} onto the draft template row via screenToPageFraction —
 * NEVER raw screen pixels. The canvas render itself is exercised on the
 * manual admin pass (Plan 10-10); this component keeps all coordinate math in
 * the pure, unit-tested screenToPageFraction above.
 */
export function PlacementStep({
  templateId,
  companyId,
  storagePath,
  questionBlocks = [],
  fieldPlacements = [],
  onSaved,
}: PlacementStepProps) {
  const { t } = useTranslation('direct-sign-templates');
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const pdfRef = React.useRef<pdfjsLib.PDFDocumentProxy | null>(null);

  const [pageCount, setPageCount] = React.useState<number>(1);
  const [pageNumber, setPageNumber] = React.useState<number>(1);
  const [marker, setMarker] = React.useState<PageFraction | null>(null);
  const [loadError, setLoadError] = React.useState(false);

  const save = useSaveTemplatePlacement();
  const saveFields = useSaveFieldPlacements();

  /**
   * Which anchor the next canvas click sets: the signature, or one of the
   * product's question blocks. One canvas, one click, a target selector above
   * it — rather than a second placement screen that would duplicate the pdfjs
   * wiring, the page navigation and the coordinate maths.
   */
  const [target, setTarget] = React.useState<string>('signature');
  const [placements, setPlacements] = React.useState<DirectSignFieldPlacement[]>(fieldPlacements);

  // Load the PDF once (signed URL over the private bucket, then pdfjs parses
  // the downloaded bytes) and remember the document for page navigation.
  React.useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    void (async () => {
      try {
        const url = await signDirectSignTemplate(storagePath);
        const loadingTask = pdfjsLib.getDocument({ url });
        const pdf = await loadingTask.promise;
        if (cancelled) {
          return;
        }
        pdfRef.current = pdf;
        setPageCount(pdf.numPages);
      } catch {
        if (!cancelled) {
          setLoadError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [storagePath]);

  // Render the currently selected page whenever the document or page changes.
  React.useEffect(() => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1.2 });
        const ctx = canvas.getContext('2d');
        if (!ctx || cancelled) {
          return;
        }
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      } catch {
        if (!cancelled) {
          setLoadError(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pageNumber, pageCount]);

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const clickY = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const fraction = screenToPageFraction({ width: canvas.width, height: canvas.height }, clickX, clickY);
    if (!fraction) {
      return;
    }
    if (target === 'signature') {
      setMarker(fraction);
      return;
    }
    // Replace rather than append: clicking again for the same block MOVES its
    // anchor. Two anchors for one answer would stamp the value twice.
    setPlacements((prev) => [
      ...prev.filter((p) => p.blockId !== target),
      { blockId: target, page: pageNumber, xFrac: fraction.xFrac, yFrac: fraction.yFrac },
    ]);
  }

  function handleSave() {
    // The two writes are independent: a template may get its variable anchors
    // before its signature anchor, or the other way round. Whichever is set
    // gets persisted; `onSaved` fires once both have gone through.
    const persistFields = () => {
      if (questionBlocks.length === 0) {
        onSaved();
        return;
      }
      saveFields.mutate({ templateId, companyId, placements }, { onSuccess: () => onSaved() });
    };

    if (!marker) {
      persistFields();
      return;
    }
    const placement: TemplatePlacement = { page: pageNumber, xFrac: marker.xFrac, yFrac: marker.yFrac };
    save.mutate({ templateId, companyId, placement }, { onSuccess: persistFields });
  }

  return (
    <div className="flex flex-col gap-md rounded-lg border border-input p-md">
      <div className="flex flex-col gap-xs">
        <h3 className="font-display text-heading text-foreground">{t('placement.heading')}</h3>
        <p className="text-body text-muted-foreground">{t('placement.body')}</p>
      </div>

      {loadError ? (
        <p role="alert" className="text-body text-destructive">
          {t('placement.loadError')}
        </p>
      ) : (
        <>
          {pageCount > 1 ? (
            <div className="flex items-center gap-sm">
              <label htmlFor="placement-page" className="text-label text-muted-foreground">
                {t('placement.pageLabel')}
              </label>
              <select
                id="placement-page"
                className="h-9 rounded-md border border-input bg-transparent px-sm text-body"
                value={pageNumber}
                onChange={(e) => {
                  setPageNumber(Number(e.target.value));
                  setMarker(null);
                }}
              >
                {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {questionBlocks.length > 0 ? (
            <div className="flex flex-col gap-xs">
              <label htmlFor="placement-target" className="text-label text-muted-foreground">
                {t('placement.targetLabel')}
              </label>
              <select
                id="placement-target"
                className="h-9 rounded-md border border-input bg-transparent px-sm text-body"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="signature">{t('placement.targetSignature')}</option>
                {questionBlocks.map((block) => (
                  <option key={block.id} value={block.id}>
                    {block.label}
                  </option>
                ))}
              </select>
              <ul className="flex flex-col gap-2xs" data-testid="placement-field-list">
                {questionBlocks.map((block) => {
                  const placed = placements.find((p) => p.blockId === block.id);
                  return (
                    <li key={block.id} className="text-label text-muted-foreground">
                      {block.label}:{' '}
                      {placed
                        ? `Seite ${placed.page} — x=${placed.xFrac.toFixed(3)} y=${placed.yFrac.toFixed(3)}`
                        : t('placement.notSet')}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className="max-w-full cursor-crosshair rounded-md border border-input"
            data-testid="placement-canvas"
          />

          <p className="text-label text-muted-foreground" data-testid="placement-marker">
            {marker
              ? `x=${marker.xFrac.toFixed(3)} y=${marker.yFrac.toFixed(3)}`
              : t('placement.notSet')}
          </p>
        </>
      )}

      <div className="flex justify-end">
        <Button
          onClick={handleSave}
          disabled={(!marker && placements.length === 0) || save.isPending || saveFields.isPending}
        >
          {save.isPending || saveFields.isPending ? t('placement.saving') : t('placement.save')}
        </Button>
      </div>
    </div>
  );
}
