import { CodeChip } from '@/components/CodeChip';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertTriangle, Check, CheckCircle2, Copy } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { IssueError, type IssuedKey, useIssueApiKey } from './useApiKeys';

/**
 * RevealKeyDialog — the reveal-ONCE surface (D-06). Invokes the `api-key-issue`
 * Edge Function; on success it shows the plaintext key EXACTLY ONCE in a
 * JetBrains-Mono CodeChip with the "copy it now" warning. Once the operator
 * confirms "Fertig", the plaintext is dropped from state and only the masked
 * `sk_••••1a2f` prefix remains anywhere in the system — the key is never
 * re-fetchable (there is no plaintext column, 0035). The max-2 error from the DB
 * trigger surfaces as inline German copy (T-05-37).
 */
export function RevealKeyDialog({
  open,
  companyId,
  onClose,
}: {
  open: boolean;
  companyId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation('api-keys');
  const [label, setLabel] = React.useState('');
  const [issued, setIssued] = React.useState<IssuedKey | null>(null);
  const [errorCode, setErrorCode] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  const issue = useIssueApiKey();

  function reset() {
    setLabel('');
    setIssued(null);
    setErrorCode(null);
    setCopied(false);
    issue.reset();
  }

  function handleClose() {
    if (issue.isPending) return;
    reset();
    onClose();
  }

  function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    setErrorCode(null);
    issue.mutate(
      { companyId, label: label.trim() || null },
      {
        onSuccess: (data) => setIssued(data),
        onError: (err) => setErrorCode(err instanceof IssueError ? err.code : 'generic'),
      },
    );
  }

  async function handleCopy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.key);
      setCopied(true);
    } catch {
      // Clipboard denial is non-fatal — the key is still visible to copy manually.
      setCopied(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t('reveal.title')}
      closeLabel={t('reveal.close')}
    >
      {issued ? (
        <div className="flex flex-col gap-lg">
          <div className="flex items-center gap-sm text-body font-medium text-pine">
            <CheckCircle2 aria-hidden className="size-4" />
            {t('reveal.successTitle')}
          </div>
          <CodeChip className="block w-full break-all p-md text-body leading-relaxed">
            {issued.key}
          </CodeChip>
          <div className="flex items-start gap-sm rounded-md border border-porch/30 bg-porch/10 p-md">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-porch" />
            <p className="text-body text-foreground">{t('reveal.warning')}</p>
          </div>
          <div className="flex justify-end gap-sm">
            <Button type="button" variant="outline" onClick={handleCopy}>
              {copied ? (
                <Check aria-hidden className="size-4 text-pine" />
              ) : (
                <Copy aria-hidden className="size-4" />
              )}
              {copied ? t('reveal.copied') : t('reveal.copy')}
            </Button>
            <Button
              type="button"
              className="bg-ink text-paper hover:bg-ink/90"
              onClick={handleClose}
            >
              {t('reveal.done')}
            </Button>
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-lg" onSubmit={handleGenerate}>
          <div className="flex flex-col gap-xs">
            <Label htmlFor="key-label">{t('reveal.labelField')}</Label>
            <Input
              id="key-label"
              autoFocus
              maxLength={80}
              placeholder={t('reveal.labelPlaceholder')}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="flex items-start gap-sm rounded-md border border-porch/30 bg-porch/10 p-md">
            <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-porch" />
            <p className="text-body text-foreground">{t('reveal.formWarning')}</p>
          </div>

          {errorCode ? (
            <p role="alert" className="text-body text-destructive">
              {t(`errors.${errorCode}`)}
            </p>
          ) : null}

          <div className="flex justify-end gap-sm">
            <Button type="button" variant="outline" onClick={handleClose} disabled={issue.isPending}>
              {t('reveal.cancel')}
            </Button>
            <Button type="submit" disabled={issue.isPending}>
              {issue.isPending ? t('reveal.generating') : t('reveal.generate')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
