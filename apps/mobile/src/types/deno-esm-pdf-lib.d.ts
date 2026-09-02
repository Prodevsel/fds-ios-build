/**
 * The Edge Function's renderer imports pdf-lib by URL, because Deno has no
 * node_modules. `renderDirectSignPdf.drift.test.ts` imports that very file to
 * compare its OUTPUT BYTES against the device copy, which pulls it into this
 * app's typecheck — where the https: specifier resolves to nothing.
 *
 * Mapping it onto the workspace package is not a shim: it is the assertion the
 * drift test depends on. Both renderers must be typed against the SAME pdf-lib,
 * or a byte difference could come from two library builds rather than from the
 * two renderers, and the comparison would prove nothing.
 */
declare module 'https://esm.sh/@cantoo/pdf-lib@2.8.1' {
  export * from '@cantoo/pdf-lib';
}
