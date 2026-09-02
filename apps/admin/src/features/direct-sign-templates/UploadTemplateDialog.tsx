import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { type DirectSignTemplate, useCreateDirectSignTemplate, validateTemplateFile } from './useDirectSignTemplates';

interface UploadTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  companyId: string | null;
  onUploaded: (template: DirectSignTemplate) => void;
}

/**
 * Upload step (Task 2 of DSGN-01/02): select a finished contract PDF, validate
 * it at the write boundary (application/pdf + max size, T-10-16/V5), upload
 * the EXACT bytes into the per-tenant bucket (upsert:false, D-19) and create a
 * draft `direct_sign_templates` row. Placement (page + normalized fraction)
 * and the Widerrufsbelehrung/publish step follow as separate steps (D-02/D-03)
 * once the operator selects the freshly-created draft row.
 */
export function UploadTemplateDialog({ open, onClose, companyId, onUploaded }: UploadTemplateDialogProps) {
  const { t } = useTranslation('direct-sign-templates');
  const [file, setFile] = React.useState<File | null>(null);
  const [errorKey, setErrorKey] = React.useState<'invalidType' | 'tooLarge' | 'noCompany' | 'generic' | null>(
    null,
  );
  const upload = useCreateDirectSignTemplate();

  function reset() {
    setFile(null);
    setErrorKey(null);
    upload.reset();
  }

  function handleClose() {
    if (upload.isPending) {
      return;
    }
    reset();
    onClose();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setErrorKey(null);
    if (selected) {
      const invalidReason = validateTemplateFile(selected);
      if (invalidReason) {
        setFile(null);
        setErrorKey(invalidReason);
        return;
      }
    }
    setFile(selected);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorKey(null);
    if (!companyId) {
      setErrorKey('noCompany');
      return;
    }
    if (!file) {
      return;
    }
    upload.mutate(
      { companyId, file },
      {
        onSuccess: (template) => {
          onUploaded(template);
          reset();
          onClose();
        },
        onError: () => {
          setErrorKey('generic');
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={t('upload.dialogTitle')}
      description={t('upload.dialogDescription')}
      closeLabel={t('upload.close')}
    >
      <form className="flex flex-col gap-lg" onSubmit={handleSubmit} noValidate>
        <div className="flex flex-col gap-xs">
          <Label htmlFor="direct-sign-upload-file">{t('upload.fileLabel')}</Label>
          <input
            id="direct-sign-upload-file"
            type="file"
            accept="application/pdf"
            aria-label={t('upload.fileLabel')}
            onChange={handleFileChange}
            className="text-body file:mr-md file:rounded-md file:border file:border-input file:bg-transparent file:px-md file:py-xs file:text-body"
          />
          {file ? (
            <p className="text-label text-muted-foreground" data-testid="upload-file-name">
              {file.name}
            </p>
          ) : null}
        </div>

        {errorKey ? (
          <p role="alert" className="text-body text-destructive">
            {t(`upload.errors.${errorKey}`)}
          </p>
        ) : null}

        <div className="flex justify-end gap-sm">
          <Button type="button" variant="outline" onClick={handleClose} disabled={upload.isPending}>
            {t('upload.cancel')}
          </Button>
          <Button type="submit" disabled={upload.isPending || !file}>
            {upload.isPending ? t('upload.submitting') : t('upload.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
