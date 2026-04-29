"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const SKILL_TYPES = [
  { value: "db_query", label: "DB Query", color: "#0ea5e9", bg: "#f0f9ff" },
  { value: "api_call", label: "API Call", color: "#8b5cf6", bg: "#f5f3ff" },
  { value: "llm_call", label: "LLM Call", color: "#f59e0b", bg: "#fffbeb" },
  { value: "python_fn", label: "Python Fn", color: "#10b981", bg: "#ecfdf5" },
  { value: "transform", label: "Transform", color: "#ec4899", bg: "#fdf2f8" },
];

const CONFIG_HINTS = {
  db_query: '{\n  "connection_env": "DATABASE_URL",\n  "query": "SELECT * FROM ..."\n}',
  api_call: '{\n  "url": "https://...",\n  "method": "GET",\n  "headers": {},\n  "body": {}\n}',
  llm_call: '',
  python_fn: '{}',
  transform: '{\n  "mapping": {\n    "output_field": "input.nested.field"\n  }\n}',
};

const EMPTY_FORM = {
  id: "",
  type: "db_query",
  config: CONFIG_HINTS.db_query,
  code: "",
  description: "",
  inputVars: [],
  outputVars: [],
  promptTemplate: "",
  outputFormat: "",
};

/** Map API skill row into form state (I/O keys live in pickers, not raw JSON for non-LLM). */
function skillToForm(s) {
  const raw = s.config && typeof s.config === "object" ? { ...s.config } : {};
  const inputVars = Array.isArray(raw.input_keys) ? [...raw.input_keys] : [];
  const outputVars = Array.isArray(raw.output_keys) ? [...raw.output_keys] : [];
  delete raw.input_keys;
  delete raw.output_keys;

  if (s.type === "llm_call") {
    return {
      id: s.id,
      type: s.type,
      
      description: s.description || "",
      inputVars,
      outputVars,
      promptTemplate: raw.prompt_template || "",
      outputFormat: raw.output_format || "",
      config: "",
      code: s.code || "",
    };
  }

  return {
    id: s.id,
    type: s.type,
    description: s.description || "",
    inputVars,
    outputVars,
    config: Object.keys(raw).length ? JSON.stringify(raw, null, 2) : CONFIG_HINTS[s.type] || "{}",
    code: s.type === "python_fn" ? s.code || "" : "",
    promptTemplate: "",
    outputFormat: "",
  };
}

function templatePlaceholders(tmpl) {
  if (typeof tmpl !== "string") return [];
  const names = [];
  const pythonJsonDumpsArgRe =
    /^\s*json\.dumps\(\s*([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)\s*(?:,|\))/;
  const doubleRe = /\{\{\s*([^}]+?)\s*\}\}/g;
  const dottedNameRe = /^[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*$/;
  let m;
  while ((m = doubleRe.exec(tmpl)) !== null) {
    const token = m[1].trim();
    if (token && dottedNameRe.test(token)) {
      names.push(token);
      continue;
    }
    const jsonDumpsMatch = token.match(pythonJsonDumpsArgRe);
    if (jsonDumpsMatch) names.push(jsonDumpsMatch[1]);
  }
  const singleRe = /\{(\s*[a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*\s*)\}/g;
  while ((m = singleRe.exec(tmpl)) !== null) {
    const name = m[1].trim();
    if (name && !names.includes(name)) names.push(name);
  }
  const singleExprRe = /\{([^{}]+)\}/g;
  while ((m = singleExprRe.exec(tmpl)) !== null) {
    const token = m[1].trim();
    const jsonDumpsMatch = token.match(pythonJsonDumpsArgRe);
    if (!jsonDumpsMatch) continue;
    const name = jsonDumpsMatch[1];
    if (name && !names.includes(name)) names.push(name);
  }
  return [...new Set(names)];
}

function isJsonLikeVariable(variable) {
  const dt = String(variable?.data_type || "").toLowerCase();
  return dt.includes("json") || dt === "object" || dt === "dict" || dt === "map";
}

/**
 * For placeholders like "payload.user_id", map back to root variable "payload"
 * when that root variable is JSON-like.
 */
function resolvePlaceholdersToVariableNames(placeholders, vars) {
  const byName = new Map(vars.map((v) => [v.name, v]));
  const resolved = [];
  for (const p of placeholders) {
    if (byName.has(p)) {
      resolved.push(p);
      continue;
    }
    if (!p.includes(".")) continue;
    const root = p.split(".")[0];
    const rootVar = byName.get(root);
    if (!rootVar) continue;
    if (!isJsonLikeVariable(rootVar)) continue;
    resolved.push(root);
  }
  return [...new Set(resolved)];
}

function placeholderUsageCounts(placeholders, vars) {
  const byName = new Map(vars.map((v) => [v.name, v]));
  const counts = new Map();
  for (const p of placeholders) {
    let resolved = null;
    if (byName.has(p)) {
      resolved = p;
    } else if (p.includes(".")) {
      const root = p.split(".")[0];
      const rootVar = byName.get(root);
      if (rootVar && isJsonLikeVariable(rootVar)) resolved = root;
    }
    if (!resolved) continue;
    counts.set(resolved, (counts.get(resolved) || 0) + 1);
  }
  return counts;
}

function findUnknownPlaceholders(placeholders, vars) {
  const byName = new Map(vars.map((v) => [v.name, v]));
  return placeholders.filter((p) => {
    if (byName.has(p)) return false;
    if (!p.includes(".")) return true;
    const root = p.split(".")[0];
    const rootVar = byName.get(root);
    return !(rootVar && isJsonLikeVariable(rootVar));
  });
}

function findMatchingBrace(s, startIdx) {
  let depth = 0;
  let i = startIdx;
  let inString = null;
  let escape = false;
  for (; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Top-level keys inside a dict literal body (handles nested brackets/parens in values). */
function extractTopLevelDictKeys(inner) {
  const keys = [];
  let i = 0;
  const len = inner.length;

  const skipValue = (from) => {
    let j = from;
    const depth = { p: 0, b: 0, sq: 0 };
    let inStr = null;
    let esc = false;
    while (j < len) {
      const ch = inner[j];
      if (inStr) {
        if (esc) {
          esc = false;
          j++;
          continue;
        }
        if (ch === "\\") {
          esc = true;
          j++;
          continue;
        }
        if (ch === inStr) inStr = null;
        j++;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = ch;
        j++;
        continue;
      }
      if (ch === "(") {
        depth.p++;
        j++;
        continue;
      }
      if (ch === ")") {
        depth.p--;
        j++;
        continue;
      }
      if (ch === "{") {
        depth.b++;
        j++;
        continue;
      }
      if (ch === "}") {
        depth.b--;
        j++;
        continue;
      }
      if (ch === "[") {
        depth.sq++;
        j++;
        continue;
      }
      if (ch === "]") {
        depth.sq--;
        j++;
        continue;
      }
      if (ch === "," && depth.p === 0 && depth.b === 0 && depth.sq === 0) return j + 1;
      j++;
    }
    return j;
  };

  while (i < len) {
    while (i < len && /\s/.test(inner[i])) i++;
    if (i >= len) break;
    let key = null;
    const c = inner[i];
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      let sb = "";
      while (i < len) {
        if (inner[i] === "\\") {
          i++;
          if (i < len) sb += inner[i++];
          continue;
        }
        if (inner[i] === quote) {
          i++;
          break;
        }
        sb += inner[i++];
      }
      key = sb;
    } else if (/[a-zA-Z_]/.test(c)) {
      let sb = c;
      i++;
      while (i < len && /[a-zA-Z0-9_]/.test(inner[i])) sb += inner[i++];
      key = sb;
    } else {
      i = skipValue(i);
      continue;
    }
    while (i < len && /\s/.test(inner[i])) i++;
    if (i >= len || inner[i] !== ":") {
      i++;
      continue;
    }
    i++;
    keys.push(key);
    i = skipValue(i);
  }
  return keys;
}

/** Parses return {...} dict literals in execute() body; output keys must match graph variables. */
function parsePythonFnReturnKeys(code) {
  if (typeof code !== "string" || !code.trim()) {
    return { ok: false, keys: [], error: "Code is required for Python Fn" };
  }
  if (!/\bdef\s+execute\s*\(/.test(code)) {
    return { ok: false, keys: [], error: "Code must define def execute(...)" };
  }
  const defMatch = /\bdef\s+execute\s*\([^)]*\)\s*:/.exec(code);
  if (!defMatch) {
    return { ok: false, keys: [], error: "Code must define def execute(...)" };
  }
  const defStart = defMatch.index;
  const defLineStart = code.lastIndexOf("\n", defStart) + 1;
  const defIndent = (code.slice(defLineStart, defStart).match(/^\s*/) || [""])[0]
    .length;

  // Restrict parsing to execute() body only, so nested helper functions
  // defined after execute do not contribute return keys.
  const lines = code.split("\n");
  let executeLineIndex = -1;
  let offset = 0;
  for (let idx = 0; idx < lines.length; idx++) {
    const lineLen = lines[idx].length + 1; // include newline separator
    if (offset <= defStart && defStart < offset + lineLen) {
      executeLineIndex = idx;
      break;
    }
    offset += lineLen;
  }

  let body = "";
  if (executeLineIndex >= 0) {
    const bodyLines = [];
    for (let i = executeLineIndex + 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) {
        bodyLines.push(line);
        continue;
      }
      const indent = (line.match(/^\s*/) || [""])[0].length;
      if (indent <= defIndent) break;
      bodyLines.push(line);
    }
    body = bodyLines.join("\n");
  } else {
    body = code.slice(defMatch.index + defMatch[0].length);
  }

  const keySet = new Set();
  let searchFrom = 0;
  let foundDictReturn = false;
  while (searchFrom < body.length) {
    const sub = body.slice(searchFrom);
    const rm = /\breturn\s+\{/.exec(sub);
    if (!rm) break;
    foundDictReturn = true;
    const braceStart = searchFrom + rm.index + rm[0].length - 1;
    const rel = body.slice(braceStart);
    const endRel = findMatchingBrace(rel, 0);
    if (endRel < 0) {
      return { ok: false, keys: [], error: "Unclosed dict in return — use return {\"key\": value}" };
    }
    const inner = rel.slice(1, endRel);
    for (const k of extractTopLevelDictKeys(inner)) keySet.add(k);
    searchFrom = braceStart + endRel + 1;
  }
  const keys = [...keySet];
  if (!foundDictReturn || keys.length === 0) {
    return {
      ok: false,
      keys: [],
      error: 'Python Fn must return a dict literal with at least one key, e.g. return {"result": inputs}',
    };
  }
  return { ok: true, keys, error: null };
}


export default function Skills() {
  const [skills, setSkills] = useState([]);
  const [variables, setVariables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const fetchSkills = useCallback(() => {
    fetch("/api/skills")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setSkills(data);
      })
      .finally(() => setLoading(false));
  }, []);

  const fetchVariables = useCallback(() => {
    fetch("/api/variables")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setVariables(data);
      });
  }, []);

  useEffect(() => {
    fetchSkills();
    fetchVariables();
  }, [fetchSkills, fetchVariables]);

  const allVars = variables;

  const llmPromptState = useMemo(() => {
    if (form.type !== "llm_call") return { valid: true, inputPlaceholders: [], outputPlaceholders: [] };
    return {
      valid: true,
      inputPlaceholders: templatePlaceholders(form.promptTemplate),
      outputPlaceholders: templatePlaceholders(form.outputFormat),
    };
  }, [form.type, form.promptTemplate, form.outputFormat]);

  const llmInputPlaceholders = llmPromptState.inputPlaceholders;
  const llmOutputPlaceholders = llmPromptState.outputPlaceholders;

  const llmInputKey = llmInputPlaceholders.join("\0");
  const llmOutputKey = llmOutputPlaceholders.join("\0");

  const llmMatchedInputNames = useMemo(() => {
    return resolvePlaceholdersToVariableNames(llmPromptState.inputPlaceholders, allVars);
  }, [llmInputKey, allVars]);

  const llmInputUsageCounts = useMemo(() => {
    return placeholderUsageCounts(llmPromptState.inputPlaceholders, allVars);
  }, [llmInputKey, allVars]);

  const llmMatchedOutputNames = useMemo(() => {
    return resolvePlaceholdersToVariableNames(llmPromptState.outputPlaceholders, allVars);
  }, [llmOutputKey, allVars]);

  const llmOutputUsageCounts = useMemo(() => {
    return placeholderUsageCounts(llmPromptState.outputPlaceholders, allVars);
  }, [llmOutputKey, allVars]);

  const llmMatchedInputKey = llmMatchedInputNames.join("\0");
  const llmMatchedOutputKey = llmMatchedOutputNames.join("\0");

  const pythonReturnState = useMemo(() => {
    if (form.type !== "python_fn") return { ok: true, keys: [], error: null };
    return parsePythonFnReturnKeys(form.code || "");
  }, [form.type, form.code]);

  const pythonReturnKeys =
    form.type === "python_fn" && pythonReturnState.ok ? pythonReturnState.keys : [];

  const pythonReturnKeyStr = pythonReturnKeys.join("\0");

  const pythonMatchedOutputNames = useMemo(() => {
    const varNames = new Set(allVars.map((v) => v.name));
    return pythonReturnKeys.filter((k) => varNames.has(k));
  }, [pythonReturnKeyStr, allVars]);

  const pythonMatchedOutputKey = pythonMatchedOutputNames.join("\0");

  useEffect(() => {
    if (form.type !== "llm_call") return;
    setForm((prev) => {
      if (prev.type !== "llm_call") return prev;
      let changed = false;
      let nextInput = prev.inputVars;
      let nextOutput = prev.outputVars;

      const allowedIn = new Set(llmMatchedInputNames);
      const keptIn = prev.inputVars.filter((k) => allowedIn.has(k));
      const addedIn = llmMatchedInputNames.filter((k) => !keptIn.includes(k));
      const combinedIn = [...keptIn, ...addedIn];
      if (
        combinedIn.length !== prev.inputVars.length ||
        !combinedIn.every((k, i) => k === prev.inputVars[i])
      ) {
        nextInput = combinedIn;
        changed = true;
      }

      const allowedOut = new Set(llmMatchedOutputNames);
      const keptOut = prev.outputVars.filter((k) => allowedOut.has(k));
      const addedOut = llmMatchedOutputNames.filter((k) => !keptOut.includes(k));
      const combinedOut = [...keptOut, ...addedOut];
      if (
        combinedOut.length !== prev.outputVars.length ||
        !combinedOut.every((k, i) => k === prev.outputVars[i])
      ) {
        nextOutput = combinedOut;
        changed = true;
      }

      return changed ? { ...prev, inputVars: nextInput, outputVars: nextOutput } : prev;
    });
  }, [form.type, llmMatchedInputKey, llmMatchedOutputKey]);

  useEffect(() => {
    if (form.type !== "python_fn") return;
    setForm((prev) => {
      if (prev.type !== "python_fn") return prev;
      let changed = false;
      let nextOutput = prev.outputVars;

      const allowedOut = new Set(pythonMatchedOutputNames);
      const keptOut = prev.outputVars.filter((k) => allowedOut.has(k));
      const addedOut = pythonMatchedOutputNames.filter((k) => !keptOut.includes(k));
      const combinedOut = [...keptOut, ...addedOut];
      if (
        combinedOut.length !== prev.outputVars.length ||
        !combinedOut.every((k, i) => k === prev.outputVars[i])
      ) {
        nextOutput = combinedOut;
        changed = true;
      }

      return changed ? { ...prev, outputVars: nextOutput } : prev;
    });
  }, [form.type, pythonMatchedOutputKey]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setError("");
  };

  const handleTypeChange = (e) => {
    const type = e.target.value;
    setForm((prev) => ({
      ...prev,
      type,
      config: type === "llm_call" ? "" : CONFIG_HINTS[type],
      promptTemplate: type === "llm_call" ? "Given {input}, generate a response..." : "",
      outputFormat: type === "llm_call" ? "{{ output }}" : "",
      code: type === "python_fn" ? 'def execute(**inputs):\n    # your logic here\n    return {"result": inputs}' : "",
    }));
    setError("");
  };

  const toggleVar = (varName, direction) => {
    const key = direction === "input" ? "inputVars" : "outputVars";
    setForm((prev) => {
      if (prev.type === "llm_call") {
        const allowed = direction === "input" ? llmMatchedInputNames : llmMatchedOutputNames;
        if (!new Set(allowed).has(varName)) return prev;
      }
      if (prev.type === "python_fn" && direction === "output") {
        if (!new Set(pythonReturnKeys).has(varName)) return prev;
      }
      const list = prev[key];
      return {
        ...prev,
        [key]: list.includes(varName)
          ? list.filter((v) => v !== varName)
          : [...list, varName],
      };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.id.trim()) {
      setError("Skill ID is required");
      return;
    }

    let parsedConfig;
    if (form.type === "llm_call") {
      if (!form.promptTemplate.trim()) {
        setError("Prompt template is required for LLM Call");
        return;
      }
      parsedConfig = {
        prompt_template: form.promptTemplate,
        output_format: form.outputFormat || "",
      };

      const inputPh = templatePlaceholders(form.promptTemplate);
      const unknownIn = findUnknownPlaceholders(inputPh, allVars);
      if (unknownIn.length > 0) {
        setError(
          `Each {name} in prompt_template must match a defined variable. Not found: ${unknownIn.join(", ")}`
        );
        return;
      }
      const outputPh = templatePlaceholders(form.outputFormat);
      const unknownOut = findUnknownPlaceholders(outputPh, allVars);
      if (unknownOut.length > 0) {
        setError(
          `Each {name} in output_format must match a defined variable. Not found: ${unknownOut.join(", ")}`
        );
        return;
      }
    } else {
      try {
        parsedConfig = JSON.parse(form.config);
      } catch {
        setError("Config must be valid JSON");
        return;
      }
    }

    if (form.type === "python_fn") {
      const pr = parsePythonFnReturnKeys(form.code || "");
      if (!pr.ok) {
        setError(pr.error);
        return;
      }
      const varSet = new Set(allVars.map((v) => v.name));
      const unknownOut = pr.keys.filter((p) => !varSet.has(p));
      if (unknownOut.length > 0) {
        setError(
          `Each key in the return dict must match a defined variable. Not found: ${unknownOut.join(", ")}`
        );
        return;
      }
    }

    parsedConfig.input_keys = form.inputVars;
    parsedConfig.output_keys = form.outputVars;

    setAdding(true);
    setError("");

    const payload = {
      id: editingId || form.id.trim(),
      type: form.type,
      config: parsedConfig,
      code: form.type === "python_fn" ? form.code || null : null,
      description: form.description || null,
    };

    try {
      const res = await fetch("/api/skills", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || (editingId ? "Failed to update skill" : "Failed to create skill"));
        return;
      }

      setForm({ ...EMPTY_FORM });
      setEditingId(null);
      fetchSkills();
    } catch {
      setError("Network error");
    } finally {
      setAdding(false);
    }
  };

  const handleEdit = (s) => {
    setError("");
    setForm(skillToForm(s));
    setEditingId(s.id);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleCancelEdit = () => {
    setForm({ ...EMPTY_FORM });
    setEditingId(null);
    setError("");
  };

  const handleDelete = async (id) => {
    const res = await fetch("/api/skills", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      setSkills((prev) => prev.filter((s) => s.id !== id));
      if (expanded === id) setExpanded(null);
      if (editingId === id) {
        setEditingId(null);
        setForm({ ...EMPTY_FORM });
      }
    }
  };

  const getTypeStyle = (type) =>
    SKILL_TYPES.find((t) => t.value === type) || SKILL_TYPES[0];

  const llmAllowedInputSet = new Set(
    form.type === "llm_call" ? llmInputPlaceholders : []
  );
  const llmAllowedOutputSet = new Set(
    form.type === "llm_call" ? llmOutputPlaceholders : []
  );
  const pythonAllowedOutputSet = new Set(
    form.type === "python_fn" ? pythonReturnKeys : []
  );

  if (loading) {
    return <div className="sk-page"><p>Loading skills...</p></div>;
  }

  return (
    <div className="sk-page">
      <div className="sk-header">
        <h1>Skills</h1>
        <p className="sk-subtitle">
          Reusable execution units — each skill does one atomic action
        </p>
      </div>

      <form className="sk-form" onSubmit={handleSubmit}>
        {editingId && (
          <div className="sk-editing-banner">
            <span>
              Editing <code className="sk-inline-code">{editingId}</code>
            </span>
            <button type="button" className="sk-btn sk-btn-secondary" onClick={handleCancelEdit}>
              Cancel
            </button>
          </div>
        )}
        <div className="sk-form-row">
          <div className="sk-field">
            <label>Skill ID</label>
            <input
              name="id"
              value={form.id}
              onChange={handleChange}
              placeholder="e.g. fetch_bookings"
              readOnly={!!editingId}
              className={editingId ? "sk-input-readonly" : undefined}
            />
          </div>

          <div className="sk-field">
            <label>Type</label>
            <select
              name="type"
              value={form.type}
              onChange={handleTypeChange}
              disabled={!!editingId}
            >
              {SKILL_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div className="sk-field sk-field-grow">
            <label>Description</label>
            <input
              name="description"
              value={form.description}
              onChange={handleChange}
              placeholder="What does this skill do?"
            />
          </div>
        </div>

        <div className="sk-form-row">
          <div className="sk-field sk-field-grow">
            <label>
              Input Variables{" "}
              <span className="sk-hint-count">{form.inputVars.length} selected</span>
            </label>
            {form.type === "llm_call" && (
              <p className="sk-field-hint">
                Inputs are driven by <code className="sk-inline-code">{"{name}"}</code> or{" "}
                <code className="sk-inline-code">{"{{name}}"}</code> placeholders in{" "}
                <code className="sk-inline-code">prompt_template</code>. Matching variables are auto-selected.
              </p>
            )}
            <div className="sk-var-picker">
              {allVars.length === 0 && (
                <span className="sk-var-empty-hint">No variables created yet</span>
              )}
              {allVars.map((v) => {
                const selected = form.inputVars.includes(v.name);
                const isLlm = form.type === "llm_call";
                const disabled = isLlm && !llmAllowedInputSet.has(v.name);
                const useCount = isLlm ? llmInputUsageCounts.get(v.name) || 0 : 0;
                return (
                  <button
                    key={v.name}
                    type="button"
                    className={`sk-var-chip ${selected ? "sk-var-chip-active" : ""} ${disabled ? "sk-var-chip-disabled" : ""}`}
                    onClick={() => toggleVar(v.name, "input")}
                    disabled={disabled}
                    title={
                      disabled
                        ? `Add {${v.name}} to prompt_template to enable`
                        : useCount > 1
                          ? `Used ${useCount} times in prompt_template`
                          : ""
                    }
                  >
                    {v.name}
                    {useCount > 1 && <span className="sk-var-chip-type">{useCount}x</span>}
                    <span className="sk-var-chip-type">{v.data_type}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="sk-form-row">
          <div className="sk-field sk-field-grow">
            <label>
              Output Variables{" "}
              <span className="sk-hint-count">{form.outputVars.length} selected</span>
            </label>
            {form.type === "llm_call" && (
              <p className="sk-field-hint">
                Outputs are driven by <code className="sk-inline-code">{"{{name}}"}</code> placeholders in{" "}
                <code className="sk-inline-code">output_format</code>. Matching variables are auto-selected.
              </p>
            )}
            {form.type === "python_fn" && (
              <p className="sk-field-hint">
                Output variables follow the keys in <code className="sk-inline-code">return {"{...}"}</code> (for example{" "}
                <code className="sk-inline-code">return {"{\"result\": inputs}"}</code>
                ). Each key must match a defined variable; matches are auto-selected. Saving requires{" "}
                <code className="sk-inline-code">def execute(...)</code> and at least one dict return.
              </p>
            )}
            <div className="sk-var-picker">
              {allVars.length === 0 && (
                <span className="sk-var-empty-hint">No variables created yet</span>
              )}
              {allVars.map((v) => {
                const selected = form.outputVars.includes(v.name);
                const isLlm = form.type === "llm_call";
                const isPython = form.type === "python_fn";
                const useCount = isLlm ? llmOutputUsageCounts.get(v.name) || 0 : 0;
                const disabled =
                  (isLlm && !llmAllowedOutputSet.has(v.name)) ||
                  (isPython && !pythonAllowedOutputSet.has(v.name));
                const disabledTitle = isLlm
                  ? `Add {{${v.name}}} to output_format to enable`
                  : isPython
                    ? `Add "${v.name}" as a key in return {...} to enable`
                    : "";
                return (
                  <button
                    key={v.name}
                    type="button"
                    className={`sk-var-chip ${selected ? "sk-var-chip-active" : ""} ${disabled ? "sk-var-chip-disabled" : ""}`}
                    onClick={() => toggleVar(v.name, "output")}
                    disabled={disabled}
                    title={
                      disabled
                        ? disabledTitle
                        : isLlm && useCount > 1
                          ? `Used ${useCount} times in output_format`
                          : ""
                    }
                  >
                    {v.name}
                    {isLlm && useCount > 1 && <span className="sk-var-chip-type">{useCount}x</span>}
                    <span className="sk-var-chip-type">{v.data_type}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {form.type === "llm_call" ? (
          <>
            <div className="sk-form-row">
              <div className="sk-field sk-field-grow">
                <label>Prompt Template</label>
                <p className="sk-field-hint">
                  Write your prompt naturally with line breaks. Use{" "}
                  <code className="sk-inline-code">{"{variable_name}"}</code> for input placeholders.
                </p>
                <textarea
                  name="promptTemplate"
                  value={form.promptTemplate}
                  onChange={handleChange}
                  className="sk-code-input sk-prompt-input"
                  rows={10}
                  placeholder={"You are a helpful assistant.\nContext: {context}\n\nUser query: {user_query}"}
                />
              </div>
            </div>
            <div className="sk-form-row">
              <div className="sk-field sk-field-grow">
                <label>Output Format</label>
                <p className="sk-field-hint">
                  Define expected output shape. Use{" "}
                  <code className="sk-inline-code">{"{{variable_name}}"}</code> for output placeholders.
                </p>
                <textarea
                  name="outputFormat"
                  value={form.outputFormat}
                  onChange={handleChange}
                  className="sk-code-input"
                  rows={3}
                  placeholder={'{{ booking_id }}, {{ checkin }}'}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="sk-form-row">
            <div className="sk-field sk-field-grow">
              <label>Config (JSON)</label>
              <textarea
                name="config"
                value={form.config}
                onChange={handleChange}
                className="sk-code-input"
                rows={5}
              />
            </div>
          </div>
        )}

        {form.type === "python_fn" && (
          <div className="sk-form-row">
            <div className="sk-field sk-field-grow">
              <label>Code</label>
              <textarea
                name="code"
                value={form.code}
                onChange={handleChange}
                className="sk-code-input sk-python-input"
                rows={6}
                placeholder={'def execute(**inputs):\n    return {"result": ...}'}
              />
            </div>
          </div>
        )}

        {error && <div className="sk-error">{error}</div>}

        <div className="sk-form-actions">
          <button type="submit" className="sk-btn" disabled={adding}>
            {adding ? (editingId ? "Saving..." : "Adding...") : editingId ? "Save changes" : "Add Skill"}
          </button>
        </div>
      </form>

      <div className="sk-list">
        {skills.length === 0 && (
          <div className="sk-empty">No skills yet. Create one above.</div>
        )}
        {skills.map((s) => {
          const typeStyle = getTypeStyle(s.type);
          const isExpanded = expanded === s.id;
          const inputKeys = s.config?.input_keys || [];
          const outputKeys = s.config?.output_keys || [];
          return (
            <div key={s.id} className="sk-card">
              <div className="sk-card-header" onClick={() => setExpanded(isExpanded ? null : s.id)}>
                <div className="sk-card-left">
                  <span
                    className="sk-type-badge"
                    style={{ color: typeStyle.color, background: typeStyle.bg }}
                  >
                    {typeStyle.label}
                  </span>
                  <code className="sk-card-id">{s.id}</code>
                  {s.description && (
                    <span className="sk-card-desc">{s.description}</span>
                  )}
                </div>
                <div className="sk-card-right">
                  <div className="sk-card-io-summary">
                    {inputKeys.length > 0 && (
                      <span className="sk-io-count sk-io-in">{inputKeys.length} in</span>
                    )}
                    {outputKeys.length > 0 && (
                      <span className="sk-io-count sk-io-out">{outputKeys.length} out</span>
                    )}
                  </div>
                  <button
                    className="sk-edit-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(s);
                    }}
                    title="Edit skill"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  <button
                    className="sk-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(s.id);
                    }}
                    title="Delete skill"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                  <svg
                    className={`sk-chevron ${isExpanded ? "sk-chevron-open" : ""}`}
                    xmlns="http://www.w3.org/2000/svg"
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>
              </div>
              {isExpanded && (
                <div className="sk-card-body">
                  {(inputKeys.length > 0 || outputKeys.length > 0) && (
                    <div className="sk-card-io">
                      {inputKeys.length > 0 && (
                        <div className="sk-card-io-group">
                          <span className="sk-card-label">Inputs</span>
                          <div className="sk-card-io-chips">
                            {inputKeys.map((k) => (
                              <span key={k} className="sk-io-chip sk-io-chip-in">{k}</span>
                            ))}
                          </div>
                        </div>
                      )}
                      {outputKeys.length > 0 && (
                        <div className="sk-card-io-group">
                          <span className="sk-card-label">Outputs</span>
                          <div className="sk-card-io-chips">
                            {outputKeys.map((k) => (
                              <span key={k} className="sk-io-chip sk-io-chip-out">{k}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="sk-card-section">
                    <span className="sk-card-label">Config</span>
                    <pre className="sk-card-pre">
                      {JSON.stringify(s.config, null, 2)}
                    </pre>
                  </div>
                  {s.code && (
                    <div className="sk-card-section">
                      <span className="sk-card-label">Code</span>
                      <pre className="sk-card-pre sk-card-pre-code">
                        {s.code}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
