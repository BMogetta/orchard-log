import React, { useRef, useState } from "react";
import { trees, events, photos, estimatedAgeMonths, EVENT_TYPES, useLive } from "../data";
import { downscaleImage } from "../lib/image.js";
import { downloadCareTaskIcs } from "../lib/ics.js";
import { harvestTotals } from "../lib/harvest.js";
import { useT } from "../lib/i18n.jsx";

const num = (v) => (v === "" || v == null ? null : Number(v));

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

function Photo({ blob, onClick }) {
  const [url] = useState(() => URL.createObjectURL(blob));
  React.useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <img className="thumb" src={url} alt="" onClick={onClick} role="button" tabIndex={0} />
  );
}

// Full-size image for the lightbox overlay.
function FullImage({ blob }) {
  const [url] = useState(() => URL.createObjectURL(blob));
  React.useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img className="lightbox-img" src={url} alt="" />;
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

  const [draft, setDraft] = useState({
    type: "note",
    notes: "",
    date: today(),
    yieldAmount: "",
    yieldUnit: "",
  });
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [lightbox, setLightbox] = useState(null);
  const pendingEventId = useRef(null);
  const eventPhotoRef = useRef(null);

  if (!tree) return <p className="empty">{t("common.loading")}</p>;

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  // Build an event doc from a draft, attaching yield fields only for harvests.
  function eventFromDraft(d) {
    const ev = { type: d.type, date: d.date, notes: d.notes };
    if (d.type === "harvest") {
      ev.yieldAmount = num(d.yieldAmount);
      ev.yieldUnit = d.yieldUnit ?? "";
    } else {
      ev.yieldAmount = null;
      ev.yieldUnit = "";
    }
    return ev;
  }

  async function logEvent() {
    await events.add({ treeId: id, ...eventFromDraft(draft) });
    setDraft({ type: "note", notes: "", date: today(), yieldAmount: "", yieldUnit: "" });
  }

  function startEdit(ev) {
    setEditingId(ev.id);
    setEditDraft({
      type: ev.type,
      date: ev.date,
      notes: ev.notes ?? "",
      yieldAmount: ev.yieldAmount ?? "",
      yieldUnit: ev.yieldUnit ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft(null);
  }

  async function saveEdit() {
    const original = eventList.find((e) => e.id === editingId);
    await events.update({ ...original, ...eventFromDraft(editDraft) });
    cancelEdit();
  }

  async function deleteEvent(ev) {
    if (confirm(t("treeDetail.eventDeleteConfirm"))) await events.remove(ev.id);
  }

  async function onPickPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const blob = await downscaleImage(file);
    await photos.add({ treeId: id, blob });
    e.target.value = "";
  }

  // Attach a photo to a specific timeline event (vs. the tree-level gallery).
  function addPhotoToEvent(eventId) {
    pendingEventId.current = eventId;
    eventPhotoRef.current.click();
  }

  async function onPickEventPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const blob = await downscaleImage(file);
    await photos.add({ treeId: id, eventId: pendingEventId.current, blob });
    e.target.value = "";
    pendingEventId.current = null;
  }

  async function deleteLightboxPhoto() {
    if (confirm(t("treeDetail.photoDeleteConfirm"))) {
      await photos.remove(lightbox.id);
      setLightbox(null);
    }
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

  // Chill hours: a min–max range, tolerant of legacy single-value docs.
  const chillMin = tree.chillHoursMinSpec ?? tree.chillHoursSpec ?? null;
  const chillMax = tree.chillHoursMaxSpec ?? null;
  const chillHours =
    chillMin != null && chillMax != null
      ? `${chillMin}–${chillMax}`
      : chillMin != null
        ? String(chillMin)
        : chillMax != null
          ? String(chillMax)
          : null;

  const metaBits = [ageLabel(estimatedAgeMonths(tree))];
  if (tree.grafted && tree.rootstock) {
    metaBits.push(t("treeDetail.onRootstock", { rootstock: tree.rootstock }));
  }
  if (tree.potLiters) {
    metaBits.push(t("treeDetail.potLiters", { n: tree.potLiters }));
  }

  // Loose photos (no event) fill the tree gallery; the rest render under their
  // event in the timeline.
  const allPhotos = photoList || [];
  const loosePhotos = allPhotos.filter((p) => !p.eventId);
  const photosForEvent = (eventId) => allPhotos.filter((p) => p.eventId === eventId);

  const harvests = harvestTotals(eventList || []);

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
          <Line k={t("treeDetail.maxTemp")} v={tree.maxTempC} />
          <Line k={t("treeDetail.chillHours")} v={chillHours} />
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
            : tree.pollination === "partial-self"
              ? t("treeDetail.pollinationPartial")
              : t("treeDetail.pollinationNeeds")}
          {tree.pollination === "needs-partner" &&
            (partner
              ? t("treeDetail.pairedWith", {
                  name: partner.commonName || partner.label,
                })
              : t("treeDetail.noPartnerSet"))}
          {tree.pollination === "partial-self" &&
            partner &&
            t("treeDetail.pairedWith", {
              name: partner.commonName || partner.label,
            })}
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
              <span className="row-gap">
                <button
                  className="ghost sm"
                  onClick={() =>
                    downloadCareTaskIcs({
                      task,
                      treeName: tree.commonName || tree.label || t("treeList.unnamed"),
                      treeId: tree.id,
                      index: i,
                    })
                  }
                >
                  {t("treeDetail.addToCalendar")}
                </button>
                <button className="ghost sm" onClick={() => markTaskDone(i)}>
                  {t("treeDetail.markDoneToday")}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {harvests.length > 0 && (
        <div className="harvest">
          <h3>{t("treeDetail.harvestTitle")}</h3>
          <ul className="harvest-totals">
            {harvests.map((y) => (
              <li key={y.year}>
                <span className="hv-year">{y.year}</span>
                <span className="hv-total">
                  {y.total} {y.unit}
                </span>
              </li>
            ))}
          </ul>
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
          {loosePhotos.map((p) => (
            <Photo key={p.id} blob={p.blob} onClick={() => setLightbox(p)} />
          ))}
        </div>
      </div>

      {/* Shared hidden input for attaching a photo to a specific event. */}
      <input
        ref={eventPhotoRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onPickEventPhoto}
        hidden
      />

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
          {draft.type === "harvest" && (
            <>
              <input
                type="number"
                min="0"
                step="0.1"
                placeholder={t("treeDetail.yieldAmount")}
                value={draft.yieldAmount}
                onChange={(e) => setDraft({ ...draft, yieldAmount: e.target.value })}
              />
              <input
                placeholder={t("treeDetail.yieldUnit")}
                value={draft.yieldUnit}
                onChange={(e) => setDraft({ ...draft, yieldUnit: e.target.value })}
              />
            </>
          )}
          <button className="primary" onClick={logEvent}>
            {t("treeDetail.log")}
          </button>
        </div>

        <ul className="timeline">
          {(eventList || []).map((e) =>
            editingId === e.id ? (
              <li key={e.id} className="ev-editing">
                <select
                  value={editDraft.type}
                  onChange={(ev) => setEditDraft({ ...editDraft, type: ev.target.value })}
                >
                  {EVENT_TYPES.map((v) => (
                    <option key={v} value={v}>
                      {t(`eventType.${v}`)}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={editDraft.date}
                  onChange={(ev) => setEditDraft({ ...editDraft, date: ev.target.value })}
                />
                <input
                  value={editDraft.notes}
                  placeholder={t("treeDetail.notesPlaceholder")}
                  onChange={(ev) => setEditDraft({ ...editDraft, notes: ev.target.value })}
                />
                {editDraft.type === "harvest" && (
                  <>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      className="days"
                      placeholder={t("treeDetail.yieldAmount")}
                      value={editDraft.yieldAmount}
                      onChange={(ev) =>
                        setEditDraft({ ...editDraft, yieldAmount: ev.target.value })
                      }
                    />
                    <input
                      className="days"
                      placeholder={t("treeDetail.yieldUnit")}
                      value={editDraft.yieldUnit}
                      onChange={(ev) =>
                        setEditDraft({ ...editDraft, yieldUnit: ev.target.value })
                      }
                    />
                  </>
                )}
                <button className="primary sm" onClick={saveEdit}>
                  {t("common.save")}
                </button>
                <button className="ghost sm" onClick={cancelEdit}>
                  {t("common.cancel")}
                </button>
              </li>
            ) : (
              <li key={e.id}>
                <div className="ev-row">
                  <span className="ev-date">{e.date}</span>
                  <span className={`ev-type t-${e.type}`}>{t(`eventType.${e.type}`)}</span>
                  <span className="ev-notes">{e.notes}</span>
                  <span className="ev-actions">
                    <button className="link sm" onClick={() => startEdit(e)}>
                      {t("common.edit")}
                    </button>
                    <button className="link sm" onClick={() => addPhotoToEvent(e.id)}>
                      {t("treeDetail.addPhoto")}
                    </button>
                    <button className="link danger sm" onClick={() => deleteEvent(e)}>
                      {t("common.delete")}
                    </button>
                  </span>
                </div>
                {photosForEvent(e.id).length > 0 && (
                  <div className="ev-photos">
                    {photosForEvent(e.id).map((p) => (
                      <Photo key={p.id} blob={p.blob} onClick={() => setLightbox(p)} />
                    ))}
                  </div>
                )}
              </li>
            )
          )}
        </ul>
      </div>

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
            <FullImage blob={lightbox.blob} />
            <div className="lightbox-actions">
              <button className="link danger" onClick={deleteLightboxPhoto}>
                {t("common.delete")}
              </button>
              <button className="ghost" onClick={() => setLightbox(null)}>
                {t("common.close")}
              </button>
            </div>
          </div>
        </div>
      )}
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
