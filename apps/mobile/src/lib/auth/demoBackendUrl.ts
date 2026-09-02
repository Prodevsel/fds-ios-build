/**
 * Pure host+port -> URL for the demo-only runtime backend override (see
 * `supabase.ts`). Kept in its own module with no React Native imports so it can
 * be checked without mocking the native layer.
 */
export function buildDemoUrl(host: string, port: number, path = ''): string {
  return `http://${host.trim()}:${port}${path}`;
}
