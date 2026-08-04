import React, { useState } from "react";
import { zones, useLive } from "../data";
import { useT } from "../lib/i18n.jsx";

// Manage the user's location zones (add / rename / delete). Zones are a plain
// string list in a single settings doc; trees reference a zone by name. Deleting
// or renaming a zone leaves referencing trees reading as "undefined" — matching
// the location select's behaviour for any name not in the list.
export default function ZonesControls() {
  const { t } = useT();
  const list = useLive(() => zones.list(), []) || [];
  const [draft, setDraft] = useState("");
  const [editingIndex, setEditingIndex] = useState(null);
  const [editValue, setEditValue] = useState("");

  const clean = (s) => s.trim();
  const isNew = (name, exclude) =>
    name && !list.some((z, i) => i !== exclude && z.toLowerCase() === name.toLowerCase());

  async function add() {
    const name = clean(draft);
    if (!isNew(name)) return;
    await zones.save([...list, name]);
    setDraft("");
  }

  async function remove(name) {
    if (!confirm(t("zones.deleteConfirm", { name }))) return;
    await zones.save(list.filter((z) => z !== name));
  }

  function startEdit(i) {
    setEditingIndex(i);
    setEditValue(list[i]);
  }

  async function saveEdit(i) {
    const name = clean(editValue);
    if (isNew(name, i)) {
      const next = list.slice();
      next[i] = name;
      await zones.save(next);
    }
    setEditingIndex(null);
  }

  return (
    <div className="zones">
      <p className="field-hint">{t("zones.hint")}</p>

      {list.length === 0 && <p className="empty">{t("zones.empty")}</p>}

      <ul className="zone-list">
        {list.map((zone, i) => (
          <li key={zone}>
            {editingIndex === i ? (
              <>
                <input
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveEdit(i)}
                />
                <button className="primary sm" onClick={() => saveEdit(i)}>
                  {t("common.save")}
                </button>
                <button className="ghost sm" onClick={() => setEditingIndex(null)}>
                  {t("common.cancel")}
                </button>
              </>
            ) : (
              <>
                <span className="zone-name">{zone}</span>
                <button className="link sm" onClick={() => startEdit(i)}>
                  {t("common.edit")}
                </button>
                <button className="link danger sm" onClick={() => remove(zone)}>
                  {t("common.delete")}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      <div className="zone-add">
        <input
          placeholder={t("zones.newPlaceholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="ghost" onClick={add}>
          {t("zones.add")}
        </button>
      </div>
    </div>
  );
}
