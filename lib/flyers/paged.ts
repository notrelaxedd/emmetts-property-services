/**
 * Supabase (PostgREST) returns at most 1000 rows per request by default, so a plain select silently
 * truncates. `allPages` keeps asking with `.range()` until a short page comes back. The query should
 * have a stable `.order()` so pages don't overlap.
 */
export const PAGE_SIZE = 1000;

export async function allPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  what: string,
  max = Infinity,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < max; from += PAGE_SIZE) {
    const { data, error } = await page(from, Math.min(from + PAGE_SIZE, max) - 1);
    if (error) throw new Error(`${what}: ${error.message}`);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }
  return out;
}
