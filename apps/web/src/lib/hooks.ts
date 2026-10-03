import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Keep filter state in the URL so views are shareable and survive refresh — without page reloads. */
export function useUrlState<T extends Record<string, string | undefined>>(defaults: T) {
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => {
    const out: Record<string, string | undefined> = { ...defaults };
    for (const k of Object.keys(defaults)) {
      const v = params.get(k);
      if (v !== null) out[k] = v;
    }
    for (const [k, v] of params.entries()) if (!(k in out)) out[k] = v;
    return out as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);
  const set = useCallback(
    (patch: Partial<T>, replaceAll = false) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(replaceAll ? '' : prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined || v === '' || v === null) next.delete(k);
            else next.set(k, String(v));
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [state, set] as const;
}
