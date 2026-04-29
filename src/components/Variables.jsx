"use client";

import { useCallback, useEffect, useState } from "react";

const EMPTY_FORM = {
  name: "",
  data_type: "TEXT",
  default_value: "",
  description: "",
};

export default function Variables() {
  const [variables, setVariables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingName, setEditingName] = useState(null);

  const fetchVars = useCallback(() => {
    fetch("/api/variables")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setVariables(data);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchVars();
  }, [fetchVars]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }

    if (form.name.trim().startsWith("SECRET_")) {
      setError("Variables starting with SECRET_ are not allowed — secrets come from .env at runtime");
      return;
    }

    if (form.data_type === "JSON" && form.default_value) {
      try {
        JSON.parse(form.default_value);
      } catch {
        setError("Default value must be valid JSON");
        return;
      }
    }

    setAdding(true);
    setError("");

    try {
      const res = await fetch("/api/variables", {
        method: editingName ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editingName || form.name.trim(),
          data_type: form.data_type,
          default_value: form.default_value || null,
          description: form.description || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || (editingName ? "Failed to update variable" : "Failed to create variable"));
        return;
      }

      setForm(EMPTY_FORM);
      setEditingName(null);
      fetchVars();
    } catch {
      setError("Network error");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (name) => {
    const res = await fetch("/api/variables", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      setVariables((prev) => prev.filter((v) => v.name !== name));
      if (editingName === name) {
        setEditingName(null);
        setForm(EMPTY_FORM);
      }
    }
  };

  const handleEdit = (v) => {
    setError("");
    setForm({
      name: v.name || "",
      data_type: v.data_type || "TEXT",
      default_value: v.default_value == null ? "" : String(v.default_value),
      description: v.description || "",
    });
    setEditingName(v.name);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCancelEdit = () => {
    setForm(EMPTY_FORM);
    setEditingName(null);
    setError("");
  };

  if (loading) {
    return <div className="var-page"><p>Loading variables...</p></div>;
  }

  return (
    <div className="var-page">
      <div className="var-header">
        <h1>Variables</h1>
        <p className="var-subtitle">
          Manage runtime variables for graph execution
        </p>
      </div>

      <form className="var-form" onSubmit={handleSubmit}>
        {editingName && (
          <div className="sk-editing-banner">
            <span>
              Editing <code className="sk-inline-code">{editingName}</code>
            </span>
            <button type="button" className="sk-btn sk-btn-secondary" onClick={handleCancelEdit}>
              Cancel
            </button>
          </div>
        )}
        <div className="var-form-row">
          <div className="var-field">
            <label>Name</label>
            <input
              name="name"
              value={form.name}
              onChange={handleChange}
              placeholder="my_variable"
              readOnly={!!editingName}
              className={editingName ? "sk-input-readonly" : undefined}
            />
          </div>

          <div className="var-field">
            <label>Type</label>
            <select
              name="data_type"
              value={form.data_type}
              disabled={!!editingName}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, data_type: e.target.value, default_value: "" }));
                setError("");
              }}
            >
              <option value="TEXT">Text</option>
              <option value="BOOLEAN">Boolean</option>
              <option value="JSON">JSON</option>
            </select>
          </div>
        </div>

        <div className="var-form-row">
          <div className="var-field var-field-grow">
            <label>Default Value</label>
            {form.data_type === "BOOLEAN" ? (
              <select name="default_value" value={form.default_value} onChange={handleChange}>
                <option value="">-- select --</option>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            ) : form.data_type === "JSON" ? (
              <textarea
                name="default_value"
                value={form.default_value}
                onChange={handleChange}
                placeholder='{"key": "value"}'
                className="var-json-input"
                rows={3}
              />
            ) : (
              <input
                name="default_value"
                value={form.default_value}
                onChange={handleChange}
                placeholder="Default value"
              />
            )}
          </div>

          <div className="var-field var-field-grow">
            <label>Description</label>
            <input
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="Optional description"
            />
          </div>
        </div>

        {error && <div className="var-error">{error}</div>}

        <button type="submit" className="var-btn" disabled={adding}>
          {adding ? (editingName ? "Saving..." : "Adding...") : editingName ? "Save changes" : "Add Variable"}
        </button>
      </form>

      <div className="var-table-wrap">
        <table className="var-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Default Value</th>
              <th>Description</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {variables.length === 0 && (
              <tr>
                <td colSpan={5} className="var-empty">
                  No variables yet. Add one above.
                </td>
              </tr>
            )}
            {variables.map((v) => (
              <tr key={v.name}>
                <td className="var-name-cell">
                  <code>{v.name}</code>
                </td>
                <td className="var-type-cell">{v.data_type}</td>
                <td className="var-val-cell">
                  {v.default_value ?? <span className="var-null">null</span>}
                </td>
                <td className="var-desc-cell">{v.description || "—"}</td>
                <td>
                  <div className="var-actions">
                    <button
                      className="var-edit-btn"
                      onClick={() => handleEdit(v)}
                      title="Edit variable"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                      </svg>
                    </button>
                    <button
                      className="var-delete-btn"
                      onClick={() => handleDelete(v.name)}
                      title="Delete variable"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
