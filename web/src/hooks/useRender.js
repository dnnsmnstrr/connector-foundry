import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const IDLE = { key: null, result: null, status: "idle", error: null };

function defaultFormatError(err) {
  return err?.name === "AbortError" ? null : (err?.message ?? String(err));
}

// One preview render that follows its inputs: the pattern Library, the
// Bench and Holes share. `key` is what to render — any value, compared
// by identity, so callers pass a useMemo'd object of the inputs — and
// null for "nothing to show", which drops the last result. Each new key
// cancels the render for the old one (its AbortSignal fires) and starts
// one for the new after `delay`; a result that finishes after its key
// was replaced is dropped, because a slow render landing after the user
// moved on is the common bug here.
//
// `run(key, signal)` does the work and resolves to the result (an STL
// ArrayBuffer for most callers). Options:
// - `delay`: ms to wait before calling `run`, or `(key, previousKey) =>
//   ms`; `previousKey` is the key scheduled before this one, and the
//   same key on a retry. The debounce that keeps typing a value from
//   compiling once per keystroke.
// - `cached(key)`: a synchronous lookup returning the result or null. A
//   hit is shown before the next paint, with no "rendering" state for
//   work that isn't going to happen.
// - `formatError(err)`: the message to show for a failed render, or
//   null for none. By default an AbortError (cancelled) shows nothing.
//
// Returns:
// - `result`, `key`: the result on screen and the key it was rendered
//   for — kept while a newer one renders, so compare `key` with the
//   current one before acting on the result (a download, a click on the
//   mesh).
// - `status`: "idle" | "rendering" (from the moment a render is
//   scheduled, debounce included) | "done" | "error". A cancelled render
//   ends "idle".
// - `error`: the message to show, cleared when the next render starts.
// - `setError(message)`: show another failure (an export's) in the same
//   place until the next render starts.
// - `retry()`: run the current key again.
//
// `run`, `delay`, `cached` and `formatError` are read when a render is
// scheduled, from the latest call, so they need not be memoised.
export function useRender(key, run, { delay = 0, cached, formatError = defaultFormatError } = {}) {
  const [state, setState] = useState(IDLE);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(null);
  latest.current = { run, delay, cached, formatError };
  const scheduledKey = useRef(null);

  // Two phases. Before the browser paints the new inputs, a layout effect
  // puts up the cache hit (or the "rendering" state) in place of the old
  // key's state, so a stale result never shows as current for a frame.
  // The render itself is scheduled from an ordinary effect, so its timer
  // is set in the same order as the caller's other effects' — the Bench
  // queues the nodes' extents ahead of the assembly render that way.
  const hitFor = useRef(null); // { key, attempt } a cache hit was shown for
  useLayoutEffect(() => {
    hitFor.current = null;
    if (key === null || key === undefined) {
      scheduledKey.current = null;
      setState(IDLE);
      return;
    }
    const hit = latest.current.cached?.(key);
    if (hit) {
      hitFor.current = { key, attempt };
      scheduledKey.current = key;
      setState({ key, result: hit, status: "done", error: null });
      return;
    }
    setState((s) => ({ ...s, status: "rendering", error: null }));
  }, [key, attempt]);

  useEffect(() => {
    if (key === null || key === undefined) return;
    if (hitFor.current?.key === key && hitFor.current.attempt === attempt) return;
    const { run, delay, formatError } = latest.current;
    const previousKey = scheduledKey.current;
    scheduledKey.current = key;
    let current = true;
    const controller = new AbortController();
    const timer = setTimeout(
      async () => {
        try {
          const result = await run(key, controller.signal);
          if (current) setState({ key, result, status: "done", error: null });
        } catch (err) {
          if (!current) return;
          const status = err?.name === "AbortError" ? "idle" : "error";
          setState((s) => ({ ...s, status, error: formatError(err) }));
        }
      },
      typeof delay === "function" ? delay(key, previousKey) : delay,
    );
    return () => {
      current = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [key, attempt]);

  const setError = useCallback((error) => setState((s) => ({ ...s, error })), []);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, setError, retry };
}
