import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2 } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { type PackageDraft, usePublishPackageProduct } from './usePackageProduct';

/**
 * "Pakete & Preise" — authoring a product without the repo.
 *
 * One row per package: name, door price, comparison price, and the terms text
 * the customer reads at the door. Publishing turns that into a complete,
 * closable consultation — choose, email, the price for THAT package, the
 * withdrawal notice, signature.
 *
 * The per-package price is the whole point. smaica's product asked which
 * package the customer wanted and then charged 199 EUR whatever the answer,
 * because a discount block references exactly one terms row and somebody wrote
 * one block. Here that cannot happen: the blocks are generated from the rows.
 */

function emptyPackage(): PackageDraft {
  return { label: '', doorPrice: 0, comparisonPrice: 0, termsText: '' };
}

export function PackageProductCard({ companyId }: { companyId: string }) {
  const { t } = useTranslation('companies');
  const publish = usePublishPackageProduct();

  const [slug, setSlug] = React.useState('');
  const [packages, setPackages] = React.useState<PackageDraft[]>([emptyPackage()]);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);

  function update(index: number, patch: Partial<PackageDraft>) {
    setPackages((prev) => prev.map((pkg, i) => (i === index ? { ...pkg, ...patch } : pkg)));
  }

  const complete = packages.filter((pkg) => pkg.label.trim() && pkg.doorPrice > 0);
  const canPublish = slug.trim().length > 0 && complete.length > 0 && !publish.isPending;

  function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (!canPublish) {
      return;
    }
    publish.mutate(
      {
        companyId,
        slug: slug.trim(),
        // Rows the operator started and left half-filled are dropped rather
        // than published as a package with no price.
        packages: complete,
      },
      {
        onSuccess: () => {
          setDone(true);
          setPackages([emptyPackage()]);
          setSlug('');
        },
        onError: (err) => setError(err instanceof Error ? err.message : t('packages.error')),
      },
    );
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-md p-lg">
        <div className="flex flex-col gap-xs">
          <h2 className="font-display text-heading text-foreground">{t('packages.heading')}</h2>
          <p className="text-body text-muted-foreground">{t('packages.body')}</p>
        </div>

        <form className="flex flex-col gap-md" onSubmit={handlePublish}>
          <div className="flex max-w-sm flex-col gap-xs">
            <Label htmlFor="package-slug">{t('packages.slugLabel')}</Label>
            <Input
              id="package-slug"
              value={slug}
              placeholder={t('packages.slugPlaceholder')}
              onChange={(e) => setSlug(e.target.value)}
            />
          </div>

          <ul className="flex flex-col gap-md">
            {packages.map((pkg, index) => (
              // Index keys are safe here: rows are only appended and removed as
              // a whole, never reordered.
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are never reordered
              <li key={index} className="flex flex-col gap-sm rounded-lg border border-input p-md">
                <div className="flex flex-wrap gap-md">
                  <div className="flex min-w-[16rem] flex-1 flex-col gap-xs">
                    <Label htmlFor={`pkg-name-${index}`}>{t('packages.nameLabel')}</Label>
                    <Input
                      id={`pkg-name-${index}`}
                      value={pkg.label}
                      placeholder={t('packages.namePlaceholder')}
                      onChange={(e) => update(index, { label: e.target.value })}
                    />
                  </div>
                  <div className="flex w-40 flex-col gap-xs">
                    <Label htmlFor={`pkg-door-${index}`}>{t('packages.doorPriceLabel')}</Label>
                    <Input
                      id={`pkg-door-${index}`}
                      type="number"
                      min={0}
                      step="0.01"
                      value={pkg.doorPrice || ''}
                      onChange={(e) => update(index, { doorPrice: Number(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="flex w-40 flex-col gap-xs">
                    <Label htmlFor={`pkg-comp-${index}`}>{t('packages.comparisonPriceLabel')}</Label>
                    <Input
                      id={`pkg-comp-${index}`}
                      type="number"
                      min={0}
                      step="0.01"
                      value={pkg.comparisonPrice || ''}
                      onChange={(e) =>
                        update(index, { comparisonPrice: Number(e.target.value) || 0 })
                      }
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-xs">
                  <Label htmlFor={`pkg-terms-${index}`}>{t('packages.termsLabel')}</Label>
                  <textarea
                    id={`pkg-terms-${index}`}
                    rows={3}
                    value={pkg.termsText}
                    placeholder={t('packages.termsPlaceholder')}
                    onChange={(e) => update(index, { termsText: e.target.value })}
                    className="flex w-full rounded-md border border-input bg-transparent px-md py-sm text-body"
                  />
                </div>

                {packages.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="self-start px-0"
                    onClick={() => setPackages((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <Trash2 aria-hidden className="size-4" />
                    {t('packages.remove')}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap items-center gap-md">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPackages((prev) => [...prev, emptyPackage()])}
            >
              <Plus aria-hidden className="size-4" />
              {t('packages.add')}
            </Button>
            <Button type="submit" disabled={!canPublish}>
              {publish.isPending ? t('packages.publishing') : t('packages.publish')}
            </Button>
          </div>
        </form>

        {done ? (
          <p role="status" className="text-body text-muted-foreground">
            {t('packages.done')}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-body text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
