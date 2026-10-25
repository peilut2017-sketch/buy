import { useCallback, useEffect, useRef, useState } from "preact/hooks";

export type Resource<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: unknown };

/** Loads data when `deps` change, ignores stale answers, and offers `reload` for the retry button. */
export function useResource<T>(load: () => Promise<T>, deps: readonly unknown[]): Resource<T> & { reload: () => void } {
  const [state, setState] = useState<Resource<T>>({ status: "loading", data: null, error: null });
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;

  useEffect(() => {
    let alive = true;
    setState({ status: "loading", data: null, error: null });
    loader.current().then(
      (data) => alive && setState({ status: "ready", data, error: null }),
      (error) => alive && setState({ status: "error", data: null, error }),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}
