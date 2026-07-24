import { useEffect, useState } from "react";
import { pouch } from "./backend.js";

// Reactive-query seam over PouchDB's changes feed. Runs the querier once, then
// re-runs it on every database change and pushes the fresh result into state.
// Coarse (any change re-queries), which is fine at this scale and keeps the
// API identical to what the components already call.
export function useLive(querier, deps = [], fallback) {
  const [result, setResult] = useState(fallback);

  useEffect(() => {
    let active = true;
    const run = () =>
      Promise.resolve(querier()).then((r) => {
        if (active) setResult(r);
      });
    run();
    const feed = pouch.changes({ since: "now", live: true }).on("change", run);
    return () => {
      active = false;
      feed.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return result;
}
