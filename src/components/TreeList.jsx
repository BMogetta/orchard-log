import React, { useState } from "react";
import { trees, useLive } from "../data";
import { useT } from "../lib/i18n.jsx";

const norm = (s) => (s || "").toLowerCase().trim();

// Sort comparators, keyed by the <select> value. Name falls back to label so
// unnamed trees still order sensibly; newest reads the stored createdAt stamp.
const SORTERS = {
  label: (a, b) => (a.label || "").localeCompare(b.label || ""),
  name: (a, b) =>
    (a.commonName || "").localeCompare(b.commonName || "") ||
    (a.label || "").localeCompare(b.label || ""),
  newest: (a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""),
};

function TreeRow({ tree, onOpen }) {
  const { t } = useT();
  return (
    <li>
      <button className="tree-row" onClick={() => onOpen(tree.id)}>
        <span className="tag">{tree.label || t("common.dash")}</span>
        <span className="tree-names">
          <strong>{tree.commonName || t("treeList.unnamed")}</strong>
          <small>{[tree.variety, tree.scientificName].filter(Boolean).join(" · ")}</small>
        </span>
        {tree.pollination === "needs-partner" && (
          <span className="chip warn" title={t("treeList.needsPartner")}>
            ⚥
          </span>
        )}
      </button>
    </li>
  );
}

export default function TreeList({ onOpen, onNew }) {
  const { t } = useT();
  const list = useLive(() => trees.all(), []);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("label");
  const [needsPartnerOnly, setNeedsPartnerOnly] = useState(false);
  const [grouped, setGrouped] = useState(false);

  const total = list?.length ?? 0;

  // search over the identity fields, then the needs-partner filter, then sort.
  const q = norm(query);
  const visible = (list || [])
    .filter((tr) =>
      !q
        ? true
        : [tr.label, tr.commonName, tr.scientificName, tr.variety].some((v) =>
            norm(v).includes(q)
          )
    )
    .filter((tr) => !needsPartnerOnly || tr.pollination === "needs-partner")
    .sort(SORTERS[sort]);

  // Bucket by scientific name (empty species sorts last, under a labelled group).
  const groups = [];
  if (grouped) {
    const byKey = new Map();
    for (const tr of visible) {
      const key = norm(tr.scientificName) || "￿";
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          name: tr.scientificName?.trim() || t("treeList.noSpecies"),
          items: [],
        });
      }
      byKey.get(key).items.push(tr);
    }
    groups.push(...[...byKey.values()].sort((a, b) => a.key.localeCompare(b.key)));
  }

  return (
    <section>
      <div className="section-head">
        <h2>{t("treeList.title")}</h2>
        <button className="primary" onClick={onNew}>
          {t("treeList.addTree")}
        </button>
      </div>

      {total > 0 && (
        <div className="list-controls">
          <input
            className="search"
            type="search"
            placeholder={t("treeList.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select
            aria-label={t("treeList.sortBy")}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="label">{t("treeList.sort.label")}</option>
            <option value="name">{t("treeList.sort.name")}</option>
            <option value="newest">{t("treeList.sort.newest")}</option>
          </select>
          <label className="toggle">
            <input
              type="checkbox"
              checked={needsPartnerOnly}
              onChange={(e) => setNeedsPartnerOnly(e.target.checked)}
            />
            {t("treeList.onlyNeedsPartner")}
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={grouped}
              onChange={(e) => setGrouped(e.target.checked)}
            />
            {t("treeList.groupBySpecies")}
          </label>
        </div>
      )}

      {total === 0 && list && <p className="empty">{t("treeList.empty")}</p>}
      {total > 0 && visible.length === 0 && (
        <p className="empty">{t("treeList.noMatches")}</p>
      )}

      {grouped
        ? groups.map((g) => (
            <div className="group" key={g.key}>
              <h3 className="group-head">{g.name}</h3>
              <ul className="tree-list">
                {g.items.map((tree) => (
                  <TreeRow key={tree.id} tree={tree} onOpen={onOpen} />
                ))}
              </ul>
            </div>
          ))
        : visible.length > 0 && (
            <ul className="tree-list">
              {visible.map((tree) => (
                <TreeRow key={tree.id} tree={tree} onOpen={onOpen} />
              ))}
            </ul>
          )}
    </section>
  );
}
