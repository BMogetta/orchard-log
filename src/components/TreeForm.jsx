import React, { useEffect, useState } from "react";
import {
  trees,
  useLive,
  blankTree,
  SUN_VALUES,
  WATER_VALUES,
  PRUNING_TIMING_VALUES,
  FERTILIZER_TYPE_VALUES,
  DECIDUOUS_VALUES,
  SOIL_PH_VALUES,
  GROWTH_RATE_VALUES,
  WIND_TOLERANCE_VALUES,
  POLLINATION_VALUES,
} from "../data";
import { useT } from "../lib/i18n.jsx";

function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

// Render a <select> whose <option> labels come from the i18n dictionary,
// namespaced by the given prefix (e.g. "sun" -> keys "sun.full-sun", …).
function EnumSelect({ prefix, values, value, onChange }) {
  const { t } = useT();
  return (
    <select value={value ?? "unknown"} onChange={(e) => onChange(e.target.value)}>
      {values.map((v) => (
        <option key={v} value={v}>
          {t(`${prefix}.${v}`)}
        </option>
      ))}
    </select>
  );
}

export default function TreeForm({ id, onBack, onSaved }) {
  const { t } = useT();
  const [tree, setTree] = useState(null);
  const others = useLive(() => trees.all(), []) || [];

  useEffect(() => {
    if (id == null) setTree(blankTree());
    else trees.get(id).then((tr) => setTree(tr || blankTree()));
  }, [id]);

  if (!tree) return <p className="empty">{t("common.loading")}</p>;

  const set = (patch) => setTree((tr) => ({ ...tr, ...patch }));
  const num = (v) => (v === "" ? null : Number(v));

  // --- care schedule editing ---
  function addTask() {
    set({
      careSchedule: [
        ...tree.careSchedule,
        {
          task: "",
          intervalDays: 7,
          intervalDaysSummer: null,
          intervalDaysWinter: null,
          lastDone: null,
        },
      ],
    });
  }
  function updateTask(i, patch) {
    const next = tree.careSchedule.slice();
    next[i] = { ...next[i], ...patch };
    set({ careSchedule: next });
  }
  function removeTask(i) {
    set({ careSchedule: tree.careSchedule.filter((_, j) => j !== i) });
  }

  async function submit() {
    const savedId = await trees.save(tree);
    onSaved(id ?? savedId);
  }

  return (
    <section className="form">
      <div className="section-head">
        <button className="link" onClick={onBack}>
          {t("treeForm.cancel")}
        </button>
        <button className="primary" onClick={submit}>
          {t("treeForm.save")}
        </button>
      </div>

      <fieldset>
        <legend>{t("treeForm.fieldset.identity")}</legend>
        <Field label={t("treeForm.label")} hint={t("treeForm.labelHint")}>
          <input
            value={tree.label}
            onChange={(e) => set({ label: e.target.value })}
          />
        </Field>
        <Field label={t("treeForm.commonName")}>
          <input
            value={tree.commonName}
            onChange={(e) => set({ commonName: e.target.value })}
          />
        </Field>
        <Field label={t("treeForm.scientificName")}>
          <input
            value={tree.scientificName}
            onChange={(e) => set({ scientificName: e.target.value })}
          />
        </Field>
        <Field label={t("treeForm.variety")}>
          <input
            value={tree.variety}
            onChange={(e) => set({ variety: e.target.value })}
          />
        </Field>
      </fieldset>

      <fieldset>
        <legend>{t("treeForm.fieldset.provenance")}</legend>
        <Field label={t("treeForm.source")} hint={t("treeForm.sourceHint")}>
          <input
            value={tree.source}
            onChange={(e) => set({ source: e.target.value })}
          />
        </Field>
        <Field label={t("treeForm.purchaseDate")}>
          <input
            type="date"
            value={tree.purchaseDate}
            onChange={(e) => set({ purchaseDate: e.target.value })}
          />
        </Field>
        <Field label={t("treeForm.claimedAge")} hint={t("treeForm.claimedAgeHint")}>
          <input
            type="number"
            value={tree.claimedAgeMonthsAtPurchase ?? ""}
            onChange={(e) =>
              set({ claimedAgeMonthsAtPurchase: num(e.target.value) })
            }
          />
        </Field>
      </fieldset>

      <fieldset>
        <legend>{t("treeForm.fieldset.physical")}</legend>
        <Field label={t("treeForm.potLiters")}>
          <input
            type="number"
            value={tree.potLiters ?? ""}
            onChange={(e) => set({ potLiters: num(e.target.value) })}
          />
        </Field>
        <Field label={t("treeForm.substrate")}>
          <input
            value={tree.substrate}
            onChange={(e) => set({ substrate: e.target.value })}
          />
        </Field>
        <Field label={t("treeForm.grafted")}>
          <input
            type="checkbox"
            checked={tree.grafted}
            onChange={(e) => set({ grafted: e.target.checked })}
          />
        </Field>
        {tree.grafted && (
          <Field label={t("treeForm.rootstock")} hint={t("treeForm.rootstockHint")}>
            <input
              value={tree.rootstock}
              onChange={(e) => set({ rootstock: e.target.value })}
            />
          </Field>
        )}
      </fieldset>

      <fieldset className="spec">
        <legend>{t("treeForm.fieldset.spec")}</legend>
        <Field label={t("treeForm.sun")}>
          <EnumSelect
            prefix="sun"
            values={SUN_VALUES}
            value={tree.sunSpec}
            onChange={(v) => set({ sunSpec: v })}
          />
        </Field>
        <Field label={t("treeForm.water")}>
          <EnumSelect
            prefix="water"
            values={WATER_VALUES}
            value={tree.waterSpec}
            onChange={(v) => set({ waterSpec: v })}
          />
        </Field>
        <Field label={t("treeForm.minTemp")}>
          <input
            type="number"
            value={tree.minTempC ?? ""}
            onChange={(e) => set({ minTempC: num(e.target.value) })}
          />
        </Field>
        <Field label={t("treeForm.chillHours")} hint={t("treeForm.chillHoursHint")}>
          <input
            type="number"
            value={tree.chillHoursSpec ?? ""}
            onChange={(e) => set({ chillHoursSpec: num(e.target.value) })}
          />
        </Field>
        <Field label={t("treeForm.deciduous")}>
          <EnumSelect
            prefix="deciduous"
            values={DECIDUOUS_VALUES}
            value={tree.deciduous}
            onChange={(v) => set({ deciduous: v })}
          />
        </Field>
        <Field label={t("treeForm.matureHeight")}>
          <input
            type="number"
            step="0.1"
            value={tree.matureHeightM ?? ""}
            onChange={(e) => set({ matureHeightM: num(e.target.value) })}
          />
        </Field>
        <Field label={t("treeForm.matureSpread")}>
          <input
            type="number"
            step="0.1"
            value={tree.matureSpreadM ?? ""}
            onChange={(e) => set({ matureSpreadM: num(e.target.value) })}
          />
        </Field>
        <Field label={t("treeForm.soilPh")}>
          <EnumSelect
            prefix="soilPh"
            values={SOIL_PH_VALUES}
            value={tree.soilPhSpec}
            onChange={(v) => set({ soilPhSpec: v })}
          />
        </Field>
        <Field label={t("treeForm.growthRate")}>
          <EnumSelect
            prefix="growthRate"
            values={GROWTH_RATE_VALUES}
            value={tree.growthRate}
            onChange={(v) => set({ growthRate: v })}
          />
        </Field>
        <Field label={t("treeForm.windTolerance")}>
          <EnumSelect
            prefix="windTolerance"
            values={WIND_TOLERANCE_VALUES}
            value={tree.windTolerance}
            onChange={(v) => set({ windTolerance: v })}
          />
        </Field>
        <Field label={t("treeForm.fertilizerType")}>
          <EnumSelect
            prefix="fertilizer"
            values={FERTILIZER_TYPE_VALUES}
            value={tree.fertilizerType}
            onChange={(v) => set({ fertilizerType: v })}
          />
        </Field>
        <Field
          label={t("treeForm.fertilizerNotes")}
          hint={t("treeForm.fertilizerNotesHint")}
        >
          <textarea
            value={tree.fertilizerNotes}
            onChange={(e) => set({ fertilizerNotes: e.target.value })}
          />
        </Field>
        <Field label={t("treeForm.pruningTiming")}>
          <EnumSelect
            prefix="pruning"
            values={PRUNING_TIMING_VALUES}
            value={tree.pruningTiming}
            onChange={(v) => set({ pruningTiming: v })}
          />
        </Field>
        <Field
          label={t("treeForm.pruningNotes")}
          hint={t("treeForm.pruningNotesHint")}
        >
          <textarea
            value={tree.pruningNotes}
            onChange={(e) => set({ pruningNotes: e.target.value })}
          />
        </Field>
        <Field
          label={t("treeForm.fruitingSeason")}
          hint={t("treeForm.fruitingSeasonHint")}
        >
          <input
            value={tree.fruitingSeason}
            onChange={(e) => set({ fruitingSeason: e.target.value })}
          />
        </Field>
        <Field label={t("treeForm.pollination")}>
          <EnumSelect
            prefix="pollination"
            values={POLLINATION_VALUES}
            value={tree.pollination}
            onChange={(v) => set({ pollination: v })}
          />
        </Field>
        {tree.pollination === "needs-partner" && (
          <Field label={t("treeForm.pollinationPartner")}>
            <select
              value={tree.pollinationPartnerId ?? ""}
              onChange={(e) =>
                set({ pollinationPartnerId: num(e.target.value) })
              }
            >
              <option value="">{t("treeForm.pollinationPartnerNone")}</option>
              {others
                .filter((o) => o.id !== tree.id)
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label ? `${o.label} · ` : ""}
                    {o.commonName || `#${o.id}`}
                  </option>
                ))}
            </select>
          </Field>
        )}
      </fieldset>

      <fieldset className="observed">
        <legend>{t("treeForm.fieldset.observed")}</legend>
        <Field label={t("treeForm.positionOnTerrace")}>
          <input
            value={tree.positionOnTerrace}
            onChange={(e) => set({ positionOnTerrace: e.target.value })}
          />
        </Field>
        <Field label={t("treeForm.observedSun")}>
          <EnumSelect
            prefix="sun"
            values={SUN_VALUES}
            value={tree.observedSun}
            onChange={(v) => set({ observedSun: v })}
          />
        </Field>
        <Field
          label={t("treeForm.observedSunNotes")}
          hint={t("treeForm.observedSunNotesHint")}
        >
          <textarea
            value={tree.observedSunNotes}
            onChange={(e) => set({ observedSunNotes: e.target.value })}
          />
        </Field>
        <Field label={t("treeForm.observedWater")}>
          <EnumSelect
            prefix="water"
            values={WATER_VALUES}
            value={tree.observedWater}
            onChange={(v) => set({ observedWater: v })}
          />
        </Field>
        <Field label={t("treeForm.observedWaterNotes")}>
          <textarea
            value={tree.observedWaterNotes}
            onChange={(e) => set({ observedWaterNotes: e.target.value })}
          />
        </Field>
        <Field label={t("treeForm.quirks")}>
          <textarea
            value={tree.quirks}
            onChange={(e) => set({ quirks: e.target.value })}
          />
        </Field>
      </fieldset>

      <fieldset>
        <legend>{t("treeForm.fieldset.care")}</legend>
        <p className="field-hint">{t("treeForm.careHint")}</p>
        {tree.careSchedule.map((task, i) => (
          <div className="task-row" key={i}>
            <input
              placeholder={t("treeForm.taskName")}
              value={task.task}
              onChange={(e) => updateTask(i, { task: e.target.value })}
            />
            <input
              type="number"
              min="1"
              className="days"
              title={t("treeForm.taskDefaultTitle")}
              value={task.intervalDays}
              onChange={(e) => {
                // intervalDays is required and drives the attention math; never
                // let an empty/invalid field persist NaN or a non-positive value.
                const n = Number(e.target.value);
                updateTask(i, {
                  intervalDays:
                    Number.isFinite(n) && n > 0 ? n : task.intervalDays,
                });
              }}
            />
            <span className="unit">{t("common.days.short")}</span>
            <input
              type="number"
              className="days"
              title={t("treeForm.taskSummerTitle")}
              placeholder={t("treeForm.taskSummerPh")}
              value={task.intervalDaysSummer ?? ""}
              onChange={(e) =>
                updateTask(i, { intervalDaysSummer: num(e.target.value) })
              }
            />
            <input
              type="number"
              className="days"
              title={t("treeForm.taskWinterTitle")}
              placeholder={t("treeForm.taskWinterPh")}
              value={task.intervalDaysWinter ?? ""}
              onChange={(e) =>
                updateTask(i, { intervalDaysWinter: num(e.target.value) })
              }
            />
            <button className="link danger" onClick={() => removeTask(i)}>
              {t("common.remove")}
            </button>
          </div>
        ))}
        <button className="ghost" onClick={addTask}>
          {t("treeForm.addTask")}
        </button>
      </fieldset>
    </section>
  );
}
