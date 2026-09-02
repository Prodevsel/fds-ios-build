import i18n from '@/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UploadTemplateDialog } from './UploadTemplateDialog';
import type { DirectSignTemplate } from './useDirectSignTemplates';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: false,
}));

vi.mock('./useDirectSignTemplates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./useDirectSignTemplates')>();
  return {
    ...actual,
    useCreateDirectSignTemplate: () => ({
      mutate: mocks.mutate,
      isPending: mocks.isPending,
      reset: vi.fn(),
    }),
  };
});

function mkPdfFile(name = 'vertrag.pdf'): File {
  return new File([new Uint8Array(10)], name, { type: 'application/pdf' });
}

function renderDialog(overrides: Partial<ComponentProps<typeof UploadTemplateDialog>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onUploaded = vi.fn();
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <UploadTemplateDialog
          open
          onClose={onClose}
          companyId="10000000-0000-0000-0000-000000000001"
          onUploaded={onUploaded}
          {...overrides}
        />
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return { onUploaded, onClose };
}

afterEach(() => {
  mocks.mutate.mockReset();
  mocks.isPending = false;
});

describe('UploadTemplateDialog (DSGN-01 upload step)', () => {
  it('rejects a non-PDF file before ever calling the upload mutation', () => {
    renderDialog();
    const input = screen.getByLabelText('PDF-Datei') as HTMLInputElement;
    const pngFile = new File([new Uint8Array(10)], 'not-a-pdf.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [pngFile] } });
    expect(screen.getByRole('alert').textContent).toContain('Bitte wähle eine PDF-Datei aus.');
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('submits the selected PDF via the upload mutation with the given companyId', () => {
    renderDialog();
    const input = screen.getByLabelText('PDF-Datei') as HTMLInputElement;
    const file = mkPdfFile();
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Hochladen' }));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    const [input0] = mocks.mutate.mock.calls[0] as [{ companyId: string; file: File }];
    expect(input0.companyId).toBe('10000000-0000-0000-0000-000000000001');
    expect(input0.file).toBe(file);
  });

  it('disables submit until a valid file is selected', () => {
    renderDialog();
    const button = screen.getByRole('button', { name: 'Hochladen' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });
});
