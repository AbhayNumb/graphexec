"use client";

import { useCallback, useEffect, useState } from "react";

const TYPE_COLORS = {
  db_query: { color: "#0ea5e9", bg: "#f0f9ff" },
  api_call: { color: "#8b5cf6", bg: "#f5f3ff" },
  llm_call: { color: "#f59e0b", bg: "#fffbeb" },
  python_fn: { color: "#10b981", bg: "#ecfdf5" },
  transform: { color: "#ec4899", bg: "#fdf2f8" },
};

const TYPE_LABELS = {
  db_query: "DB Query",
  api_call: "API Call",
  llm_call: "LLM Call",
  python_fn: "Python Fn",
  transform: "Transform",
};

export default function NodeSkillPanel({ nodeId, nodeLabel, onClose }) {
  const [nodeSkills, setNodeSkills] = useState([]);
  const [allSkills, setAllSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSkill, setSelectedSkill] = useState("");
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState(null);

  const fetchNodeSkills = useCallback(() => {
    fetch(`/api/node-skills?node_id=${nodeId}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setNodeSkills(data);
      })
      .finally(() => setLoading(false));
  }, [nodeId]);

  const fetchAllSkills = useCallback(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAllSkills(data);
      });
  }, []);

  useEffect(() => {
    setLoading(true);
    setNodeSkills([]);
    fetchNodeSkills();
    fetchAllSkills();
  }, [nodeId, fetchNodeSkills, fetchAllSkills]);

  const handleAdd = async () => {
    if (!selectedSkill) return;
    setAdding(true);
    try {
      const res = await fetch("/api/node-skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node_id: nodeId, skill_id: selectedSkill }),
      });
      if (res.ok) {
        const row = await res.json();
        setNodeSkills((prev) => [...prev, row]);
        setSelectedSkill("");
      }
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (id) => {
    const res = await fetch("/api/node-skills", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, node_id: nodeId }),
    });
    if (res.ok) {
      setNodeSkills((prev) => prev.filter((ns) => ns.id !== id));
    }
  };

  const handleDragStart = (idx) => {
    setDragging(idx);
  };

  const handleDragOver = (e, idx) => {
    e.preventDefault();
    if (dragging === null || dragging === idx) return;

    setNodeSkills((prev) => {
      const copy = [...prev];
      const [moved] = copy.splice(dragging, 1);
      copy.splice(idx, 0, moved);
      return copy;
    });
    setDragging(idx);
  };

  const handleDragEnd = async () => {
    setDragging(null);
    const orderedIds = nodeSkills.map((ns) => ns.id);
    await fetch("/api/node-skills", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ node_id: nodeId, ordered_ids: orderedIds }),
    });
  };

  const assignedSkillIds = new Set(nodeSkills.map((ns) => ns.skill_id));
  const availableSkills = allSkills.filter((s) => !assignedSkillIds.has(s.id));

  return (
    <div className="nsp-overlay" onClick={onClose}>
      <div className="nsp-panel" onClick={(e) => e.stopPropagation()}>
        <div className="nsp-header">
          <div>
            <h2 className="nsp-title">{nodeLabel || nodeId}</h2>
            <p className="nsp-node-id">
              <code>{nodeId}</code> — Skill Pipeline
            </p>
          </div>
          <button className="nsp-close" onClick={onClose}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="nsp-add-row">
          <select
            value={selectedSkill}
            onChange={(e) => setSelectedSkill(e.target.value)}
            className="nsp-select"
          >
            <option value="">Select a skill to add...</option>
            {availableSkills.map((s) => (
              <option key={s.id} value={s.id}>
                [{TYPE_LABELS[s.type] || s.type}] {s.id}
                {s.description ? ` — ${s.description}` : ""}
              </option>
            ))}
          </select>
          <button
            className="nsp-add-btn"
            onClick={handleAdd}
            disabled={!selectedSkill || adding}
          >
            {adding ? "Adding..." : "Add"}
          </button>
        </div>

        <div className="nsp-list">
          {loading && <div className="nsp-loading">Loading...</div>}
          {!loading && nodeSkills.length === 0 && (
            <div className="nsp-empty">
              <p>No skills assigned to this node yet.</p>
              <p>Add skills above — they execute in order from top to bottom.</p>
            </div>
          )}
          {nodeSkills.map((ns, idx) => {
            const tc = TYPE_COLORS[ns.skill_type] || TYPE_COLORS.db_query;
            const inputKeys = ns.skill_config?.input_keys || [];
            const outputKeys = ns.skill_config?.output_keys || [];
            return (
              <div
                key={ns.id}
                className={`nsp-item ${dragging === idx ? "nsp-item-dragging" : ""}`}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                onDragEnd={handleDragEnd}
              >
                <div className="nsp-item-grip">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="1.5" />
                    <circle cx="15" cy="6" r="1.5" />
                    <circle cx="9" cy="12" r="1.5" />
                    <circle cx="15" cy="12" r="1.5" />
                    <circle cx="9" cy="18" r="1.5" />
                    <circle cx="15" cy="18" r="1.5" />
                  </svg>
                </div>
                <div className="nsp-item-order">{idx + 1}</div>
                <div className="nsp-item-body">
                  <div className="nsp-item-top">
                    <span
                      className="nsp-item-type"
                      style={{ color: tc.color, background: tc.bg }}
                    >
                      {TYPE_LABELS[ns.skill_type] || ns.skill_type}
                    </span>
                    <code className="nsp-item-id">{ns.skill_id}</code>
                  </div>
                  {ns.skill_description && (
                    <div className="nsp-item-desc">{ns.skill_description}</div>
                  )}
                  {(inputKeys.length > 0 || outputKeys.length > 0) && (
                    <div className="nsp-item-io">
                      {inputKeys.length > 0 && (
                        <div className="nsp-io-group">
                          <span className="nsp-io-label">IN</span>
                          {inputKeys.map((k) => (
                            <span key={k} className="nsp-io-tag nsp-io-tag-in">{k}</span>
                          ))}
                        </div>
                      )}
                      {outputKeys.length > 0 && (
                        <div className="nsp-io-group">
                          <span className="nsp-io-label">OUT</span>
                          {outputKeys.map((k) => (
                            <span key={k} className="nsp-io-tag nsp-io-tag-out">{k}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <button
                  className="nsp-item-remove"
                  onClick={() => handleRemove(ns.id)}
                  title="Remove skill"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>

        {nodeSkills.length > 1 && (
          <p className="nsp-drag-hint">Drag to reorder execution sequence</p>
        )}
      </div>
    </div>
  );
}
