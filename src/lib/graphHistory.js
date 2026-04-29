import { GRAPH_ID } from "@/lib/constants";

async function ensureCursor(client, graphId = GRAPH_ID) {
  await client.query(
    `INSERT INTO graph_history_cursor (graph_id, current_version)
     VALUES ($1, 0)
     ON CONFLICT (graph_id) DO NOTHING`,
    [graphId]
  );
}

export async function getHistoryState(client, graphId = GRAPH_ID) {
  await ensureCursor(client, graphId);
  const { rows: cursorRows } = await client.query(
    `SELECT current_version FROM graph_history_cursor WHERE graph_id = $1`,
    [graphId]
  );
  const { rows: latestRows } = await client.query(
    `SELECT COALESCE(MAX(version), 0) AS latest_version
     FROM graph_history
     WHERE graph_id = $1`,
    [graphId]
  );

  const currentVersion = Number(cursorRows[0]?.current_version || 0);
  const latestVersion = Number(latestRows[0]?.latest_version || 0);
  return {
    currentVersion,
    latestVersion,
    canUndo: currentVersion > 0,
    canRedo: currentVersion < latestVersion,
  };
}

export async function recordHistory(client, payload, graphId = GRAPH_ID) {
  await ensureCursor(client, graphId);

  const { rows: cursorRows } = await client.query(
    `SELECT current_version
     FROM graph_history_cursor
     WHERE graph_id = $1
     FOR UPDATE`,
    [graphId]
  );
  const currentVersion = Number(cursorRows[0]?.current_version || 0);

  const { rows: latestRows } = await client.query(
    `SELECT COALESCE(MAX(version), 0) AS latest_version
     FROM graph_history
     WHERE graph_id = $1`,
    [graphId]
  );
  const latestVersion = Number(latestRows[0]?.latest_version || 0);

  if (currentVersion < latestVersion) {
    await client.query(
      `DELETE FROM graph_history
       WHERE graph_id = $1 AND version > $2`,
      [graphId, currentVersion]
    );
  }

  const nextVersion = currentVersion + 1;
  await client.query(
    `INSERT INTO graph_history
       (graph_id, version, action_type, target_kind, target_id, before_state, after_state, created_by)
     VALUES
       ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
    [
      graphId,
      nextVersion,
      payload.actionType,
      payload.targetKind,
      payload.targetId || null,
      payload.beforeState ? JSON.stringify(payload.beforeState) : null,
      payload.afterState ? JSON.stringify(payload.afterState) : null,
      payload.createdBy || null,
    ]
  );

  await client.query(
    `UPDATE graph_history_cursor
     SET current_version = $2, updated_at = NOW()
     WHERE graph_id = $1`,
    [graphId, nextVersion]
  );
}

async function syncEdgesSequence(client) {
  await client.query(
    `SELECT setval(
      pg_get_serial_sequence('edges', 'id'),
      COALESCE((SELECT MAX(id) FROM edges), 1),
      (SELECT COUNT(*) > 0 FROM edges)
    )`
  );
}

async function restoreNodeRows(client, graphId, nodes) {
  for (const node of nodes || []) {
    await client.query(
      `INSERT INTO nodes (graph_id, id, label, type, data, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (graph_id, id)
       DO UPDATE SET
         label = EXCLUDED.label,
         type = EXCLUDED.type,
         data = EXCLUDED.data`,
      [
        graphId,
        node.id,
        node.label,
        node.type,
        node.data ? JSON.stringify(node.data) : "{}",
        node.created_at || new Date().toISOString(),
      ]
    );
  }
}

async function restoreEdgeRows(client, graphId, edges) {
  for (const edge of edges || []) {
    await client.query(
      `INSERT INTO edges (id, graph_id, from_node, to_node, label, type, data, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (id)
       DO UPDATE SET
         graph_id = EXCLUDED.graph_id,
         from_node = EXCLUDED.from_node,
         to_node = EXCLUDED.to_node,
         label = EXCLUDED.label,
         type = EXCLUDED.type,
         data = EXCLUDED.data`,
      [
        edge.id,
        graphId,
        edge.from_node,
        edge.to_node,
        edge.label,
        edge.type,
        edge.data ? JSON.stringify(edge.data) : "{}",
        edge.created_at || new Date().toISOString(),
      ]
    );
  }
  await syncEdgesSequence(client);
}

async function applyNodeMove(client, graphId, state) {
  if (!state?.id) return;
  await client.query(
    `UPDATE nodes
     SET data = $3::jsonb
     WHERE graph_id = $1 AND id = $2`,
    [graphId, state.id, JSON.stringify(state.data || {})]
  );
}

async function applyNodeCreateForward(client, graphId, state) {
  await restoreNodeRows(client, graphId, [state]);
}

async function applyNodeCreateBackward(client, graphId, state) {
  await client.query(`DELETE FROM nodes WHERE graph_id = $1 AND id = $2`, [
    graphId,
    state?.id,
  ]);
}

async function applyNodeDeleteForward(client, graphId, state) {
  const ids = (state?.nodes || []).map((n) => n.id);
  if (ids.length === 0) return;
  await client.query(`DELETE FROM nodes WHERE graph_id = $1 AND id = ANY($2)`, [
    graphId,
    ids,
  ]);
}

async function applyNodeDeleteBackward(client, graphId, state) {
  await restoreNodeRows(client, graphId, state?.nodes || []);
  await restoreEdgeRows(client, graphId, state?.edges || []);
}

async function applyEdgeCreateForward(client, graphId, state) {
  await restoreEdgeRows(client, graphId, [state]);
}

async function applyEdgeCreateBackward(client, graphId, state) {
  if (!state) return;
  await client.query(`DELETE FROM edges WHERE graph_id = $1 AND id = $2`, [
    graphId,
    state.id,
  ]);
}

async function applyEdgeDeleteForward(client, graphId, state) {
  const ids = (state?.edges || []).map((e) => e.id);
  if (ids.length === 0) return;
  await client.query(`DELETE FROM edges WHERE graph_id = $1 AND id = ANY($2)`, [
    graphId,
    ids,
  ]);
}

async function applyEdgeDeleteBackward(client, graphId, state) {
  await restoreEdgeRows(client, graphId, state?.edges || []);
}

async function applyEdgeUpdate(client, graphId, state) {
  for (const edge of state?.edges || []) {
    await client.query(
      `UPDATE edges
       SET label = $4, type = $5, data = $6::jsonb
       WHERE graph_id = $1 AND id = $2`,
      [
        graphId,
        edge.id,
        edge.label,
        edge.type,
        edge.data ? JSON.stringify(edge.data) : "{}",
      ]
    );
  }
}

async function replaceNodeSkills(client, graphId, state) {
  const nodeId = state?.node_id;
  if (!nodeId) return;
  await client.query(
    `DELETE FROM node_skills WHERE graph_id = $1 AND node_id = $2`,
    [graphId, nodeId]
  );
  for (const item of state?.skills || []) {
    await client.query(
      `INSERT INTO node_skills
        (id, graph_id, node_id, skill_id, execution_order, config_override, created_at)
       VALUES
        ($1, $2, $3, $4, $5, $6::jsonb, $7)
       ON CONFLICT (id)
       DO UPDATE SET
         graph_id = EXCLUDED.graph_id,
         node_id = EXCLUDED.node_id,
         skill_id = EXCLUDED.skill_id,
         execution_order = EXCLUDED.execution_order,
         config_override = EXCLUDED.config_override`,
      [
        item.id,
        graphId,
        nodeId,
        item.skill_id,
        item.execution_order,
        item.config_override ? JSON.stringify(item.config_override) : "{}",
        item.created_at || new Date().toISOString(),
      ]
    );
  }
}

async function applyHistoryStep(client, row, direction, graphId = GRAPH_ID) {
  const before = row.before_state;
  const after = row.after_state;

  switch (row.action_type) {
    case "node_create":
      if (direction === "undo") return applyNodeCreateBackward(client, graphId, after);
      return applyNodeCreateForward(client, graphId, after);
    case "node_move":
      if (direction === "undo") return applyNodeMove(client, graphId, before);
      return applyNodeMove(client, graphId, after);
    case "node_delete_cascade":
      if (direction === "undo") return applyNodeDeleteBackward(client, graphId, before);
      return applyNodeDeleteForward(client, graphId, before);
    case "edge_create":
      if (direction === "undo") return applyEdgeCreateBackward(client, graphId, after);
      return applyEdgeCreateForward(client, graphId, after);
    case "edge_delete":
      if (direction === "undo") return applyEdgeDeleteBackward(client, graphId, before);
      return applyEdgeDeleteForward(client, graphId, before);
    case "edge_update":
      if (direction === "undo") return applyEdgeUpdate(client, graphId, before);
      return applyEdgeUpdate(client, graphId, after);
    case "node_skills_replace":
      if (direction === "undo") return replaceNodeSkills(client, graphId, before);
      return replaceNodeSkills(client, graphId, after);
    default:
      throw new Error(`Unsupported history action_type: ${row.action_type}`);
  }
}

export async function undoGraph(client, graphId = GRAPH_ID) {
  await ensureCursor(client, graphId);
  const { rows: cursorRows } = await client.query(
    `SELECT current_version
     FROM graph_history_cursor
     WHERE graph_id = $1
     FOR UPDATE`,
    [graphId]
  );
  const currentVersion = Number(cursorRows[0]?.current_version || 0);
  if (currentVersion === 0) {
    return getHistoryState(client, graphId);
  }

  const { rows } = await client.query(
    `SELECT *
     FROM graph_history
     WHERE graph_id = $1 AND version = $2`,
    [graphId, currentVersion]
  );
  const entry = rows[0];
  if (!entry) {
    throw new Error("History entry not found for undo");
  }

  await applyHistoryStep(client, entry, "undo", graphId);

  await client.query(
    `UPDATE graph_history_cursor
     SET current_version = $2, updated_at = NOW()
     WHERE graph_id = $1`,
    [graphId, currentVersion - 1]
  );

  return getHistoryState(client, graphId);
}

export async function redoGraph(client, graphId = GRAPH_ID) {
  await ensureCursor(client, graphId);
  const { rows: cursorRows } = await client.query(
    `SELECT current_version
     FROM graph_history_cursor
     WHERE graph_id = $1
     FOR UPDATE`,
    [graphId]
  );
  const currentVersion = Number(cursorRows[0]?.current_version || 0);
  const nextVersion = currentVersion + 1;

  const { rows } = await client.query(
    `SELECT *
     FROM graph_history
     WHERE graph_id = $1 AND version = $2`,
    [graphId, nextVersion]
  );
  const entry = rows[0];
  if (!entry) {
    return getHistoryState(client, graphId);
  }

  await applyHistoryStep(client, entry, "redo", graphId);

  await client.query(
    `UPDATE graph_history_cursor
     SET current_version = $2, updated_at = NOW()
     WHERE graph_id = $1`,
    [graphId, nextVersion]
  );

  return getHistoryState(client, graphId);
}

export async function clearGraphHistory(client, graphId = GRAPH_ID) {
  await ensureCursor(client, graphId);
  await client.query(`DELETE FROM graph_history WHERE graph_id = $1`, [graphId]);
  await client.query(
    `UPDATE graph_history_cursor
     SET current_version = 0, updated_at = NOW()
     WHERE graph_id = $1`,
    [graphId]
  );
  return getHistoryState(client, graphId);
}
