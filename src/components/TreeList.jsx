import React, { useState } from "react";
import { trees, zones, useLive, useCanEdit, estimatedAgeMonths } from "../data";
import { computeAttention } from "../lib/attention.js";
import { computePhenology } from "../lib/phenology.js";
import { Icon, WaterIcon } from "./icons.jsx";
import { TreeIcon } from "./TreeIcon.jsx";
import { useT } from "../lib/i18n.jsx";

const norm = (s) => (s || "").toLowerCase().trim();

// At-a-glance icons for the list row (rendered only when the data is present).
const SUN_ICON = {
  "full-sun": "sun",
  "part-sun": "cloud-sun",
  "part-shade": "cloud",
  "full-shade": "cloudy",
};
// Map our stored slugs to the composable TreeIcon glyph (foliage + pollination).
const FOLIAGE = {
  deciduous: "deciduous",
  evergreen: "evergreen",
  "semi-deciduous": "semiDeciduous",
};
const POLLINATION = {
  self: "selfFertile",
  "partial-self": "partiallySelfFertile",
  "needs-partner": "needsPartner",
};

// Compact age: the dominant unit only (e.g. "4a" / "8m"), or null if unknown.
function ageLabel(tree, t) {
  const m = estimatedAgeMonths(tree);
  if (m == null) return null;
  const y = Math.floor(m / 12);
  return y >= 1 ? t("treeDetail.ageYear", { n: y }) : t("treeDetail.ageMonth", { n: m });
}

// Sort comparators, keyed by the <select> value. Name falls back to label so
// unnamed trees still order sensibly; newest reads the stored createdAt stamp.
const SORTERS = {
  label: (a, b) => (a.label || "").localeCompare(b.label || ""),
  name: (a, b) =>
    (a.commonName || "").localeCompare(b.commonName || "") ||
    (a.label || "").localeCompare(b.label || ""),
  newest: (a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""),
};

// Phenophase -> the vendored line icon + its tone class per state.
const PHENO_ICON = { flowering: "flower", fruiting: "cherry" };
const PHENO_TONE = {
  flowering: { active: "tone-bloom", predicted: "pheno-faint" },
  fruiting: { active: "tone-fruit", predicted: "pheno-faint" },
};

function TreeCard({ tree, onOpen, attn, pheno }) {
  const { t } = useT();
  // Observed reality wins over the reference spec, matching the app's ethos.
  const sun = tree.observedSun !== "unknown" ? tree.observedSun : tree.sunSpec;
  const water = tree.observedWater !== "unknown" ? tree.observedWater : tree.waterSpec;
  const age = ageLabel(tree, t);
  const meta = [tree.variety, tree.scientificName].filter(Boolean);

  // The glyph carries only foliage + pollination; sun, water, frost and the
  // overdue-care alert read as their own fixed-slot icons in the card header.
  const foliage = FOLIAGE[tree.deciduous];
  const pollination = POLLINATION[tree.pollination];
  const frost = tree.minTempC != null && tree.minTempC >= 0;
  const glyphTitle = [
    t(`deciduous.${tree.deciduous}`),
    pollination && t(`pollination.${tree.pollination}`),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button className="tree-card" onClick={() => onOpen(tree.id)}>
      <div className="card-head">
        <span className="tag">{tree.label || t("common.dash")}</span>
        {/* Fixed slots so each condition keeps its position:
            alert · frost · water · sun · flower · fruit */}
        <div className="card-conds">
          <span className="cslot">
            {attn && (
              <Icon name="triangle-alert" title={t("attention.title")} className="tone-warn" />
            )}
          </span>
          <span className="cslot">
            {frost && (
              <Icon name="snowflake" title={t("treeList.frostTender")} className="tone-cold" />
            )}
          </span>
          <span className="cslot">
            {water && water !== "unknown" && (
              <WaterIcon level={water} title={t(`water.${water}`)} />
            )}
          </span>
          <span className="cslot">
            {sun && sun !== "unknown" && <Icon name={SUN_ICON[sun]} title={t(`sun.${sun}`)} />}
          </span>
          {["flowering", "fruiting"].map((phase) => {
            const state = pheno?.[phase];
            return (
              <span className="cslot" key={phase}>
                {state && state !== "none" && (
                  <Icon
                    name={PHENO_ICON[phase]}
                    title={t(`pheno.${phase}.${state}`)}
                    className={PHENO_TONE[phase][state]}
                  />
                )}
              </span>
            );
          })}
        </div>
      </div>

      {foliage ? (
        <TreeIcon
          foliage={foliage}
          pollination={pollination}
          size={56}
          title={glyphTitle}
          className="card-glyph"
        />
      ) : (
        <span className="card-glyph placeholder" aria-hidden="true" />
      )}

      <div className="card-body">
        <strong>{tree.commonName || t("treeList.unnamed")}</strong>
        {meta.length > 0 && <small className="card-sub">{meta.join(" · ")}</small>}
      </div>

      {/* Fixed slots so location / size / age never shift position. */}
      <div className="card-foot">
        <span className="fslot zone">
          {tree.positionOnTerrace && (
            <>
              <span className="pin">📍</span> {tree.positionOnTerrace}
            </>
          )}
        </span>
        <span className="fslot size">{tree.potLiters != null ? `${tree.potLiters}L` : ""}</span>
        <span className="fslot age">{age || ""}</span>
      </div>
    </button>
  );
}

export default function TreeList({ onOpen, onNew }) {
  const { t } = useT();
  const canEdit = useCanEdit();
  const list = useLive(() => trees.all(), []);
  const zoneList = useLive(() => zones.list(), []) || [];
  const attnItems = useLive(() => computeAttention(), []) || [];
  const needsAttention = new Set(attnItems.map((a) => a.treeId));
  const phenology = useLive(() => computePhenology(), []) || new Map();

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("label");
  const [needsPartnerOnly, setNeedsPartnerOnly] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [zoneFilter, setZoneFilter] = useState("__all__"); // __all__ | <zone> | "" (undefined)

  const total = list?.length ?? 0;

  const inZoneFilter = (tr) => {
    if (zoneFilter === "__all__") return true;
    if (zoneFilter === "") return !zoneList.includes(tr.positionOnTerrace); // undefined/orphan
    return tr.positionOnTerrace === zoneFilter;
  };

  // search over the identity fields, then the zone + needs-partner filters, then sort.
  const q = norm(query);
  const visible = (list || [])
    .filter((tr) =>
      !q
        ? true
        : [tr.label, tr.commonName, tr.scientificName, tr.variety, ...(tr.otherNames || [])].some(
            (v) => norm(v).includes(q)
          )
    )
    .filter(inZoneFilter)
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
        {canEdit && (
          <button className="primary" onClick={onNew}>
            {t("treeList.addTree")}
          </button>
        )}
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
          {zoneList.length > 0 && (
            <select
              aria-label={t("treeDetail.position")}
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value)}
            >
              <option value="__all__">{t("treeList.zoneAll")}</option>
              {zoneList.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
              <option value="">{t("zones.none")}</option>
            </select>
          )}
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
              <div className="tree-cards">
                {g.items.map((tree) => (
                  <TreeCard
                    key={tree.id}
                    tree={tree}
                    onOpen={onOpen}
                    attn={needsAttention.has(tree.id)}
                    pheno={phenology.get(tree.id)}
                  />
                ))}
              </div>
            </div>
          ))
        : visible.length > 0 && (
            <div className="tree-cards">
              {visible.map((tree) => (
                <TreeCard
                  key={tree.id}
                  tree={tree}
                  onOpen={onOpen}
                  attn={needsAttention.has(tree.id)}
                  pheno={phenology.get(tree.id)}
                />
              ))}
            </div>
          )}
    </section>
  );
}
