import React from "react";
import { trees, useLive } from "../data";
import { useT } from "../lib/i18n.jsx";

export default function TreeList({ onOpen, onNew }) {
  const { t } = useT();
  const list = useLive(() => trees.allByLabel(), []);

  return (
    <section>
      <div className="section-head">
        <h2>{t("treeList.title")}</h2>
        <button className="primary" onClick={onNew}>
          {t("treeList.addTree")}
        </button>
      </div>

      {list && list.length === 0 && (
        <p className="empty">{t("treeList.empty")}</p>
      )}

      <ul className="tree-list">
        {(list || []).map((tree) => (
          <li key={tree.id}>
            <button className="tree-row" onClick={() => onOpen(tree.id)}>
              <span className="tag">{tree.label || t("common.dash")}</span>
              <span className="tree-names">
                <strong>{tree.commonName || t("treeList.unnamed")}</strong>
                <small>
                  {[tree.variety, tree.scientificName].filter(Boolean).join(" · ")}
                </small>
              </span>
              {tree.pollination === "needs-partner" && (
                <span
                  className="chip warn"
                  title={t("treeList.needsPartner")}
                >
                  ⚥
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
