"use client";

import { useEffect, useState } from "react";

function buildDataPayload({ condition, matchVariable, matchValue }) {
  const data = {};
  const c = condition.trim();
  if (c) data.condition = c;
  const mv = matchVariable.trim();
  if (mv) {
    data.match_variable = mv;
    data.match_value = matchValue;
  }
  return data;
}

export default function EdgeConditionPanel({ edge, onClose, onSaved }) {
  const [executorType, setExecutorType] = useState("default");
  const [edgeLabel, setEdgeLabel] = useState("");
  const [condition, setCondition] = useState("");
  const [matchVariable, setMatchVariable] = useState("");
  const [matchValue, setMatchValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!edge) return;
    const d = edge.data || {};
    setExecutorType(d.executorType || "default");
    setEdgeLabel(edge.label || "");
    setCondition(typeof d.condition === "string" ? d.condition : "");
    setMatchVariable(typeof d.match_variable === "string" ? d.match_variable : "");
    setMatchValue(
      d.match_value !== undefined && d.match_value !== null ? String(d.match_value) : ""
    );
  }, [edge]);

  if (!edge) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      const type = executorType === "conditional" ? "conditional" : "default";
      const data =
        type === "conditional"
          ? buildDataPayload({ condition, matchVariable, matchValue })
          : {};

      const res = await fetch("/api/edges", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_node: edge.source,
          to_node: edge.target,
          type,
          label: edgeLabel,
          data,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Failed to save edge");
        return;
      }

      onSaved({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edgeLabel,
        data: { ...data, executorType: type },
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="nsp-overlay" onClick={onClose}>
      <div className="nsp-panel" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="nsp-header">
          <div>
            <h2 className="nsp-title">Edge</h2>
            <p className="nsp-node-id">
              <code>
                {edge.source} → {edge.target}
              </code>
            </p>
          </div>
          <button type="button" className="nsp-close" onClick={onClose} aria-label="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="nsp-add-row" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
          <label style={{ display: "block", width: "100%", fontSize: "0.85rem" }}>
            Label
            <input
              className="nsp-select"
              style={{ width: "100%", marginTop: 4 }}
              value={edgeLabel}
              onChange={(e) => setEdgeLabel(e.target.value)}
              placeholder="Optional"
            />
          </label>
        </div>

        <div className="nsp-add-row" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.5rem" }}>
          <label style={{ display: "block", width: "100%", fontSize: "0.85rem" }}>
            Executor type
            <select
              className="nsp-select"
              style={{ width: "100%", marginTop: 4 }}
              value={executorType}
              onChange={(e) => setExecutorType(e.target.value)}
            >
              <option value="default">default (always follow)</option>
              <option value="conditional">conditional</option>
            </select>
          </label>
        </div>

        {executorType === "conditional" && (
          <div style={{ marginTop: "0.75rem" }}>
            <p style={{ fontSize: "0.8rem", opacity: 0.85, marginBottom: "0.75rem", lineHeight: 1.45 }}>
              Use either a Python <code>condition</code> (evaluated with <code>vars</code> and{" "}
              <code>json</code>) or <code>match_variable</code> + <code>match_value</code> equality.
              If both are set, the executor uses <code>condition</code> first.
            </p>
            <label style={{ display: "block", width: "100%", fontSize: "0.85rem", marginBottom: "0.65rem" }}>
              condition
              <textarea
                className="nsp-select"
                style={{
                  width: "100%",
                  marginTop: 4,
                  minHeight: 72,
                  resize: "vertical",
                  fontFamily: "ui-monospace, monospace",
                  fontSize: "0.8rem",
                }}
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                placeholder={`e.g. vars['intent'] == 'cancel'`}
                rows={3}
              />
            </label>
            <label style={{ display: "block", width: "100%", fontSize: "0.85rem", marginBottom: "0.65rem" }}>
              match_variable
              <input
                className="nsp-select"
                style={{ width: "100%", marginTop: 4 }}
                value={matchVariable}
                onChange={(e) => setMatchVariable(e.target.value)}
                placeholder="variable name"
              />
            </label>
            <label style={{ display: "block", width: "100%", fontSize: "0.85rem" }}>
              match_value
              <input
                className="nsp-select"
                style={{ width: "100%", marginTop: 4 }}
                value={matchValue}
                onChange={(e) => setMatchValue(e.target.value)}
                placeholder="compared as strings"
              />
            </label>
          </div>
        )}

        <div className="nsp-add-row" style={{ marginTop: "1rem" }}>
          <button type="button" className="nsp-add-btn" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
