import yaml from "js-yaml";
import { useEffect, useState } from "react";
import { fetchPublic } from "../lib/publicAsset.js";

// The part list — catalogue.yaml, copied into public/ by sync-scad.mjs.
// `parts` is null until loaded; `error` is a message if it never will be.
export function useCatalogue() {
  const [parts, setParts] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchPublic("catalogue.yaml")
      .then((res) => res.text())
      .then((text) => {
        const doc = yaml.load(text);
        if (!doc || !Array.isArray(doc.parts)) throw new Error("catalogue.yaml has no `parts` list");
        if (!cancelled) setParts(doc.parts);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { parts, error };
}

// lib/constants.scad's simple top-level literals (FIT_CLEARANCE etc.),
// extracted by sync-scad.mjs — the catalogue-default side of the global
// settings override layer. Null until loaded; {} if unavailable, since
// the Settings modal degrades to "no default to diff against".
export function useGlobalDefaults() {
  const [defaults, setDefaults] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchPublic("global-defaults.json")
      .then((res) => res.json())
      .then((doc) => {
        if (!cancelled) setDefaults(doc && typeof doc === "object" ? doc : {});
      })
      .catch(() => {
        if (!cancelled) setDefaults({});
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return defaults;
}
