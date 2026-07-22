import React, { useState } from "react";
import { trees, events, photos, estimatedAgeMonths, EVENT_TYPES, useLive } from "../data";
import { downscaleImage } from "../lib/image.js";
import { useT } from "../lib/i18n.jsx";

function useAgeLabel() {
  const { t } = useT();
  return (months) => {
    if (months == null) return t("treeDetail.unknownAge");
    const y = Math.floor(months / 12);
    const m = months % 12;
    const parts = [];
    if (y) parts.push(t("treeDetail.ageYear", { n: y }));
    if (m) parts.push(t("treeDetail.ageMonth", { n: m }));
    return parts.length ? parts.join(" ") : t("treeDetail.ageZero");
  };
}

// Resolve an enum value to its translated display string, or null when it's
// "unknown" so the row can render as em-dash rather than "Unknown".
function useEnumLabel() {
  const { t } = useT();
  return (prefix, value) => {
    if (value == null || value === "unknown") return null;
    return t(`${prefix}.${value}`);
  };
}

function Photo({ blob }) {
  const [url] = useState(() => URL.createObjectURL(blob));
  React.useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img className="thumb" src={url} alt="" />;
}

export default function TreeDetail({ id, onBack, onEdit }) {
  const { t } = useT();
  const ageLabel = useAgeLabel();
  const enumLabel = useEnumLabel();

  const tree = useLive(() => trees.get(id), [id]);
  const eventList = useLive(() => events.forTree(id), [id]);
  const photoList = useLive(() => photos.forTree(id), [id]);
  const partner = useLive(
    () => (tree?.pollinationPartnerId ? trees.get(tree.pollinationPartnerId) : null),
    [tree?.pollinationPartnerId]
  );

  const [draft, setDraft] = useState({ type: "note", notes: "", date: today() });

  if (!tree) return <p className="empty">{t("common.loading")}</p>;

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  async function logEvent() {
    await events.add({ treeId: id, ...draft });
    setDraft({ type: "note", notes: "", date: today() });
  }

  async function onPickPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const blob = await downscaleImage(file);
    await photos.add({ treeId: id, blob });
    e.target.value = "";
  }

  async function markTaskDone(i) {
    const next = tree.careSchedule.slice();
    next[i] = { ...next[i], lastDone: today() };
    await trees.save({ ...tree, careSchedule: next });
  }

  async function remove() {
    const name = tree.commonName || t("treeDetail.deleteConfirmFallback");
    if (confirm(t("treeDetail.deleteConfirm", { name }))) {
      await trees.remove(id);
      onBack();
    }
  }

  const matureSize =
    tree.matureHeightM || tree.matureSpreadM
      ? t("treeDetail.matureSizeFormat", {
          h: tree.matureHeightM ?? "?",
          w: tree.matureSpreadM ?? "?",
        })
      : null;

  const metaBits = [ageLabel(estimatedAgeMonths(tree))];
  if (tree.grafted && tree.rootstock) {
    metaBits.push(t("treeDetail.onRootstock", { rootstock: tree.rootstock }));
  }
  if (tree.potLiters) {
    metaBits.push(t("treeDetail.potLiters", { n: tree.potLiters }));
  }

  return (
    <section className="detail">
      <div className="section-head">
        <button className="link" onClick={onBack}>
          {t("treeDetail.back")}
        </button>
        <div className="row-gap">
          <button className="ghost" onClick={onEdit}>
            {t("common.edit")}
          </button>
          <button className="link danger" onClick={remove}>
            {t("common.delete")}
          </button>
        </div>
      </div>

      <div className="detail-head">
        <span className="tag big">{tree.label || t("common.dash")}</span>
        <div>
          <h2>{tree.commonName || t("treeList.unnamed")}</h2>
          <p className="sub">
            {[tree.variety, tree.scientificName].filter(Boolean).join(" · ")}
          </p>
          <p className="meta">{metaBits.join(" · ")}</p>
        </div>
      </div>

      {/* SIGNATURE: spec vs observed, side by side */}
      <div className="compare">
        <div className="compare-col spec">
          <h3>{t("treeDetail.specTitle")}</h3>
          <Line k={t("treeDetail.sun")} v={enumLabel("sun", tree.sunSpec)} />
          <Line k={t("treeDetail.water")} v={enumLabel("water", tree.waterSpec)} />
          <Line k={t("treeDetail.minTemp")} v={tree.minTempC} />
          <Line k={t("treeDetail.chillHours")} v={tree.chillHoursSpec} />
          <Line
            k={t("treeDetail.leafHabit")}
            v={enumLabel("deciduous", tree.deciduous)}
          />
          <Line k={t("treeDetail.matureSize")} v={matureSize} />
          <Line k={t("treeDetail.soilPh")} v={enumLabel("soilPh", tree.soilPhSpec)} />
          <Line
            k={t("treeDetail.growthRate")}
            v={enumLabel("growthRate", tree.growthRate)}
          />
          <Line
            k={t("treeDetail.windTolerance")}
            v={enumLabel("windTolerance", tree.windTolerance)}
          />
          <Line
            k={t("treeDetail.fertilizer")}
            v={enumLabel("fertilizer", tree.fertilizerType)}
          />
          {tree.fertilizerNotes && (
            <p className="notes">{tree.fertilizerNotes}</p>
          )}
          <Line
            k={t("treeDetail.pruning")}
            v={enumLabel("pruning", tree.pruningTiming)}
          />
          {tree.pruningNotes && <p className="notes">{tree.pruningNotes}</p>}
          <Line k={t("treeDetail.fruiting")} v={tree.fruitingSeason} />
        </div>
        <div className="compare-col observed">
          <h3>{t("treeDetail.observedTitle")}</h3>
          <Line k={t("treeDetail.position")} v={tree.positionOnTerrace} />
          <Line k={t("treeDetail.sun")} v={enumLabel("sun", tree.observedSun)} />
          {tree.observedSunNotes && (
            <p className="notes">{tree.observedSunNotes}</p>
          )}
          <Line k={t("treeDetail.water")} v={enumLabel("water", tree.observedWater)} />
          {tree.observedWaterNotes && (
            <p className="notes">{tree.observedWaterNotes}</p>
          )}
          <Line k={t("treeDetail.quirks")} v={tree.quirks} />
        </div>
      </div>

      {tree.pollination !== "unknown" && (
        <p className="pollination">
          {t("treeDetail.pollinationPrefix")}
          {tree.pollination === "self"
            ? t("treeDetail.pollinationSelf")
            : t("treeDetail.pollinationNeeds")}
          {tree.pollination === "needs-partner" &&
            (partner
              ? t("treeDetail.pairedWith", {
                  name: partner.commonName || partner.label,
                })
              : t("treeDetail.noPartnerSet"))}
        </p>
      )}

      {tree.careSchedule?.length > 0 && (
        <div className="tasks">
          <h3>{t("treeDetail.recurringCare")}</h3>
          {tree.careSchedule.map((task, i) => (
            <div className="task-line" key={i}>
              <span>
                {task.task || t("treeDetail.taskUntitled")} ·{" "}
                {t("treeDetail.taskEvery", { n: task.intervalDays })}
                {task.intervalDaysSummer != null &&
                  t("treeDetail.taskSummer", { n: task.intervalDaysSummer })}
                {task.intervalDaysWinter != null &&
                  t("treeDetail.taskWinter", { n: task.intervalDaysWinter })}
                {task.lastDone
                  ? t("treeDetail.taskLast", { date: task.lastDone })
                  : t("treeDetail.taskNever")}
              </span>
              <button className="ghost sm" onClick={() => markTaskDone(i)}>
                {t("treeDetail.markDoneToday")}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="photos">
        <div className="section-head">
          <h3>{t("treeDetail.photos")}</h3>
          <label className="ghost file-btn">
            {t("treeDetail.addPhoto")}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onPickPhoto}
              hidden
            />
          </label>
        </div>
        <div className="thumbs">
          {(photoList || []).map((p) => (
            <Photo key={p.id} blob={p.blob} />
          ))}
        </div>
      </div>

      <div className="log">
        <h3>{t("treeDetail.clinicalHistory")}</h3>
        <div className="log-form">
          <select
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value })}
          >
            {EVENT_TYPES.map((v) => (
              <option key={v} value={v}>
                {t(`eventType.${v}`)}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
          />
          <input
            placeholder={t("treeDetail.notesPlaceholder")}
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
          <button className="primary" onClick={logEvent}>
            {t("treeDetail.log")}
          </button>
        </div>

        <ul className="timeline">
          {(eventList || []).map((e) => (
            <li key={e.id}>
              <span className="ev-date">{e.date}</span>
              <span className={`ev-type t-${e.type}`}>{t(`eventType.${e.type}`)}</span>
              <span className="ev-notes">{e.notes}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Line({ k, v }) {
  return (
    <div className="line">
      <span className="k">{k}</span>
      <span className="v">{v === "" || v == null ? "—" : String(v)}</span>
    </div>
  );
}
