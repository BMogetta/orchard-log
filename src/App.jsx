import React, { useState } from "react";
import TreeList from "./components/TreeList.jsx";
import TreeDetail from "./components/TreeDetail.jsx";
import TreeForm from "./components/TreeForm.jsx";
import AttentionPanel from "./components/AttentionPanel.jsx";
import BackupControls from "./components/BackupControls.jsx";
import DemoBanner from "./components/DemoBanner.jsx";
import { isDemo } from "./lib/demo.js";
import { useT } from "./lib/i18n.jsx";

// Minimal view state, no router dependency. view: list | detail | form
export default function App() {
  const { t, toggleLang } = useT();
  const [view, setView] = useState("list");
  const [selectedId, setSelectedId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

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
          <button className="icon-btn" onClick={() => setMenuOpen((v) => !v)}>
            {t("nav.backup")}
          </button>
        </div>
      </header>

      {isDemo && <DemoBanner />}

      {menuOpen && (
        <div className="menu-sheet">
          <BackupControls onDone={() => setMenuOpen(false)} />
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

        {view === "form" && (
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
