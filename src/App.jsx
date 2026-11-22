import React, { useEffect, useState } from "react";
import TreeList from "./components/TreeList.jsx";
import TreeDetail from "./components/TreeDetail.jsx";
import TreeForm from "./components/TreeForm.jsx";
import AttentionPanel from "./components/AttentionPanel.jsx";
import BackupControls from "./components/BackupControls.jsx";
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
  const [menu, setMenu] = useState(null); // null | "backup"

  const toggleMenu = (m) => setMenu((cur) => (cur === m ? null : m));

  // A device that turns read-only leaves the form, which only exists to write,
  // for the detail or the list. Leaving it is explicit so it does not reopen
  // by itself later.
  useEffect(() => {
    if (canEdit) return;
    setView((cur) => (cur === "form" ? (selectedId ? "detail" : "list") : cur));
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
          <button className="icon-btn" onClick={() => toggleMenu("backup")}>
            {t("nav.backup")}
          </button>
        </div>
      </header>

      {isDemo && <DemoBanner />}
      <SyncBanner />

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
