import { getSupabase } from '@/lib/supabase';
import { buildPackageProductBlocks, packageValueFromLabel } from '@frontdoorsales/flow-schema';
import { useMutation, useQueryClient } from '@tanstack/react-query';

/**
 * Publish a package product from the admin.
 *
 * Until now a product came from a JSON file and a CLI call. That is workable
 * for whoever has the repo checked out and impossible for anyone else, and it
 * is where the pricing bug came from: one discount block for three packages,
 * so every package cost the same and nothing said so.
 *
 * The terms rows go in FIRST and the product SECOND, because the product's
 * discount blocks reference the terms by id. If the product insert fails, the
 * terms rows are orphans — harmless (nothing points at them, and both tables
 * are append-only by design) and far better than the reverse, which would be a
 * published product whose prices do not resolve.
 *
 * Both tables carry company-scoped INSERT policies, so RLS is the authority
 * here as everywhere else; this module never checks permission itself.
 */

export interface PackageDraft {
  /** What the customer sees in the list and on the contract. */
  label: string;
  doorPrice: number;
  comparisonPrice: number;
  termsText: string;
}

export interface PublishPackageProductInput {
  companyId: string;
  slug: string;
  choiceLabel?: string;
  noticeText?: string;
  packages: PackageDraft[];
}

export function usePublishPackageProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: PublishPackageProductInput): Promise<void> => {
      const supabase = getSupabase();

      // EVERYTHING that can fail is settled before the first write. Both tables
      // are append-only with no DELETE policy for `authenticated`, so a failure
      // BETWEEN the two inserts leaves rows the operator cannot remove and a
      // retry that collides with them — the slug becomes unpublishable from the
      // UI forever. There is no transaction across two PostgREST calls, so the
      // defence is to make the second call unable to fail for any reason the
      // first one could have caught.

      // 1. Derived answer values must be unique BEFORE anything is written.
      //    "Basic" and "Basic!" both slugify to `basic`, and any two labels
      //    sharing a 40-character prefix collide too — which is likely, since a
      //    package label reads like "Plus — 20 Inhalte im Monat, bis zu acht
      //    Reels". A collision means two prices for one answer.
      const usedValues = new Set<string>();
      const values = input.packages.map((pkg, index) => {
        const base = packageValueFromLabel(pkg.label) || `paket-${index + 1}`;
        let value = base;
        let suffix = 2;
        while (usedValues.has(value)) {
          value = `${base}-${suffix}`;
          suffix += 1;
        }
        usedValues.add(value);
        return value;
      });

      // 2. Take the next free version rather than assuming 1. product_definitions
      //    is unique over (slug, version) GLOBALLY — not per company — and
      //    discount_terms over (company_id, product_slug, version). Publishing a
      //    slug a second time, or a slug another company already uses, would
      //    otherwise fail with a raw 23505 the operator cannot interpret.
      const [{ data: existingProducts }, { data: existingTerms }] = await Promise.all([
        supabase.from('product_definitions').select('version').eq('slug', input.slug),
        supabase
          .from('discount_terms')
          .select('version')
          .eq('company_id', input.companyId)
          .eq('product_slug', input.slug),
      ]);
      const nextVersion = (rows: { version: number }[] | null) =>
        (rows ?? []).reduce((max, row) => Math.max(max, Number(row.version)), 0) + 1;
      const productVersion = nextVersion(existingProducts as { version: number }[] | null);
      const firstTermsVersion = nextVersion(existingTerms as { version: number }[] | null);

      const terms = input.packages.map((pkg, index) => ({
        id: crypto.randomUUID(),
        company_id: input.companyId,
        product_slug: input.slug,
        // Consecutive from the next free one. `version` is the discriminator
        // between simultaneously valid packages here, not a timeline.
        version: firstTermsVersion + index,
        status: 'published',
        type: 'markdown',
        door_price: pkg.doorPrice,
        // A package with no comparison price must not advertise "statt 0,00 €".
        // DiscountBlock only suppresses the struck-through price on NULL.
        comparison_price: pkg.comparisonPrice > 0 ? pkg.comparisonPrice : null,
        terms_text: pkg.termsText,
      }));

      // 3. Build the blocks BEFORE writing anything — buildPackageProductBlocks
      //    throws on a shape it will not publish, and a throw after the terms
      //    insert is the poisoned-retry state described above.
      const blocks = buildPackageProductBlocks({
        choiceLabel: input.choiceLabel,
        noticeText: input.noticeText,
        packages: input.packages.map((pkg, index) => ({
          value: values[index]!,
          label: pkg.label,
          termsId: terms[index]!.id,
        })),
      });

      const { error: termsError } = await supabase.from('discount_terms').insert(terms);
      if (termsError) {
        throw termsError;
      }

      const { error: productError } = await supabase.from('product_definitions').insert({
        company_id: input.companyId,
        slug: input.slug,
        version: productVersion,
        status: 'published',
        blocks,
        contract_mode: 'flow_form',
      });
      if (productError) {
        throw productError;
      }
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['companies', 'products', variables.companyId] });
      void queryClient.invalidateQueries({
        queryKey: ['direct-sign-templates', 'question-sources', variables.companyId],
      });
    },
  });
}
