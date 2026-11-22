import React, { useEffect, useState } from "react";
import TreeList from "./components/TreeList.jsx";
import TreeDetail from "./components/TreeDetail.jsx";
import TreeForm from "./components/TreeForm.jsx";
import AttentionPanel from "./components/AttentionPanel.jsx";
import BackupControls from "./components/BackupControls.jsx";
import ZonesControls from "./components/ZonesControls.jsx";
import DemoBanner from "./components/DemoBanner.jsx";
import SyncBanner from "./components/SyncBanner.jsx";
import { isDemo } from "./lib/demo.js";
import { useT } from "./lib/i18n.jsx";
import { useCanEdit } from "./data";

// Minimal view state, no router dependency. view: list | detail | form
export default function App() {
  const { t, toggleLang } = useT();
  const canEdit = useCanEdit();
  const [view, setView] = useState("list");
  const [selectedId, setSelectedId] = useState(null);
  const [menu, setMenu] = useState(null); // null | "zones" | "backup"

  const toggleMenu = (m) => setMenu((cur) => (cur === m ? null : m));

  // A device that turns read-only leaves the screens that only exist to write:
  // the form goes back to the detail or the list, and the zones sheet closes.
  // Leaving them is explicit so they do not reopen by themselves later.
  useEffect(() => {
    if (canEdit) return;
    setView((cur) => (cur === "form" ? (selectedId ? "detail" : "list") : cur));
    setMenu((cur) => (cur === "zones" ? null : cur));
  }, [canEdit, selectedId]);

  function openDetail(id) {
    setSelectedId(id);
    setView("detail");
  }
  function openNew() {
    setSelectedId(null);
    setView("form");
  }
  function openEdit(id) {
    setSelectedId(id);
    setView("form");
  }
  function goList() {
    setView("list");
    setSelectedId(null);
  }

  return (
    <div className="app">
      <header className="topbar">
        <button className="wordmark" onClick={goList}>
          Orchard<span>Log</span>
        </button>
        <div className="row-gap">
          <button
            className="icon-btn"
            onClick={toggleLang}
            title={t("nav.switchTo")}
          >
            {t("nav.switchTo")}
          </button>
          {canEdit && (
            <button className="icon-btn" onClick={() => toggleMenu("zones")}>
              {t("nav.zones")}
            </button>
          )}
          <button className="icon-btn" onClick={() => toggleMenu("backup")}>
            {t("nav.backup")}
          </button>
        </div>
      </header>

      {isDemo && <DemoBanner />}
      <SyncBanner />

      {canEdit && menu === "zones" && (
        <div className="menu-sheet">
          <ZonesControls />
        </div>
      )}

      {menu === "backup" && (
        <div className="menu-sheet">
          <BackupControls onDone={() => setMenu(null)} />
        </div>
      )}

      <main className="content">
        {view === "list" && (
          <>
            <AttentionPanel onOpen={openDetail} />
            <TreeList onOpen={openDetail} onNew={openNew} />
          </>
        )}

        {view === "detail" && (
          <TreeDetail
            id={selectedId}
            onBack={goList}
            onEdit={() => openEdit(selectedId)}
          />
        )}

        {view === "form" && canEdit && (
          <TreeForm
            id={selectedId}
            onBack={selectedId ? () => openDetail(selectedId) : goList}
            onSaved={openDetail}
          />
        )}
      </main>
    </div>
  );
}
