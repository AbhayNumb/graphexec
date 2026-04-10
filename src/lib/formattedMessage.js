/**
 * Turn orchestrator `variables.formatted_message` into plain text parts.
 * Handles arrays, JSON arrays, and Python-style list strings like "['hi', 'there']".
 */
export function formattedMessageToParts(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((x) => (typeof x === "string" ? x.trim() : String(x).trim()))
      .filter(Boolean);
  }
  if (typeof raw !== "string") {
    const s = String(raw).trim();
    return s ? [s] : [];
  }

  const s = raw.trim();
  if (!s) return [];

  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) {
        return parsed
          .map((x) => (typeof x === "string" ? x.trim() : String(x).trim()))
          .filter(Boolean);
      }
    } catch {
      /* fall through to Python-style */
    }

    const inner = s.slice(1, -1).trim();
    if (!inner) return [];

    const parts = [];
    const re = /'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"/g;
    let m;
    while ((m = re.exec(inner)) !== null) {
      const chunk = (m[1] ?? m[2] ?? "").replace(/\\(.)/g, "$1");
      if (chunk.trim()) parts.push(chunk.trim());
    }
    if (parts.length) return parts;
  }

  return [s];
}
