import React, { useRef, useState } from "react";
import { exportBackup, importBackup } from "../lib/backup.js";
import { useT } from "../lib/i18n.jsx";
import { useCanEdit } from "../data";
import { BUILD_LABEL } from "../lib/version.js";

export default function BackupControls({ onDone }) {
  const { t } = useT();
  const canEdit = useCanEdit();
  const fileRef = useRef();
  const [msg, setMsg] = useState("");

  async function onImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const replace = confirm(t("backup.confirmReplace"));
    try {
      await importBackup(file, { replace });
      setMsg(t("backup.restored"));
    } catch (err) {
      // backup.js throws i18n keys as .message; t() returns the key itself if
      // it doesn't recognise it, so untranslated errors still surface literally.
      setMsg(t(err.message));
    }
    e.target.value = "";
  }

  return (
    <div className="backup">
      <p className="field-hint">{t("backup.hint")}</p>
      <div className="row-gap">
        <button
          className="primary"
          onClick={async () => {
            await exportBackup();
            onDone?.();
          }}
        >
          {t("backup.export")}
        </button>
        {/* Export stays available to everyone; import writes, so it does not. */}
        {canEdit && (
          <>
            <button className="ghost" onClick={() => fileRef.current.click()}>
              {t("backup.import")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              onChange={onImport}
              hidden
            />
          </>
        )}
      </div>
      {msg && <p className="field-hint">{msg}</p>}
      <p className="field-hint">{t("app.version", { v: BUILD_LABEL })}</p>
    </div>
  );
}
