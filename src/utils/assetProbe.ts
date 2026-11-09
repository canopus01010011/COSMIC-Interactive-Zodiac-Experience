/** Prefix for files in /public, respecting Vite's `base` option. */
export function assetUrl(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  return `${base.endsWith('/') ? base : `${base}/`}${path.replace(/^\//, '')}`;
}

/**
 * True if `url` exists and is not the SPA fallback page. (Vite's dev server answers unknown paths with
 * index.html and status 200, so a plain `res.ok` check would wrongly accept missing assets.)
 */
export async function probeAsset(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
    if (!res.ok) return false;
    const type = res.headers.get('content-type') ?? '';
    return !type.includes('text/html');
  } catch {
    return false;
  }
}
