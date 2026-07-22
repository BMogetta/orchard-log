import React from "react";
import { useLive } from "../data";
import { computeAttention } from "../lib/attention.js";
import { useT } from "../lib/i18n.jsx";

export default function AttentionPanel({ onOpen }) {
  const { t } = useT();
  // useLive observes the tables that computeAttention reads, so any change to
  // trees or events (including in-place edits like marking a task done) re-runs
  // it. No manual stamp needed.
  const items = useLive(() => computeAttention(), []) ?? [];

  if (!items.length) return null;

  return (
    <section className="attention">
      <h2>{t("attention.title")}</h2>
      <ul>
        {items.map((it, i) => (
          <li key={i}>
            <button onClick={() => onOpen(it.treeId)}>
              <strong>{it.treeName}</strong>
              <span>{it.labelKey ? t(it.labelKey, it.labelParams) : it.label}</span>
              <em>{t("attention.overdue", { n: it.overdueDays })}</em>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
