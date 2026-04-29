import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { GRAPH_ID } from "@/lib/constants";
import { recordHistory } from "@/lib/graphHistory";

export async function POST(request) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const { id, label, type = "default", position = { x: 0, y: 0 } } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO nodes (graph_id, id, label, type, data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, label, type, data, created_at`,
      [GRAPH_ID, id, label || id, type, JSON.stringify({ position })]
    );

    const row = rows[0];
    await recordHistory(client, {
      actionType: "node_create",
      targetKind: "node",
      targetId: row.id,
      afterState: {
        id: row.id,
        label: row.label,
        type: row.type,
        data: row.data,
        created_at: row.created_at,
      },
    });
    await client.query("COMMIT");

    const node = {
      id: row.id,
      type: row.type,
      position: row.data?.position || position,
      data: { label: row.label || row.id },
    };

    return NextResponse.json(node, { status: 201 });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/nodes error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function PATCH(request) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const { id, position } = body;

    if (!id || !position || typeof position.x !== "number" || typeof position.y !== "number") {
      return NextResponse.json(
        { error: "id and position { x, y } are required" },
        { status: 400 }
      );
    }

    await client.query("BEGIN");
    const beforeResult = await client.query(
      `SELECT id, data
       FROM nodes
       WHERE graph_id = $1 AND id = $2`,
      [GRAPH_ID, id]
    );
    if (beforeResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }

    const { rows, rowCount } = await client.query(
      `UPDATE nodes SET data = jsonb_set(
         COALESCE(data, '{}'::jsonb),
         '{position}',
         $3::jsonb,
         true
       )
       WHERE graph_id = $1 AND id = $2
       RETURNING id, data`,
      [GRAPH_ID, id, JSON.stringify({ x: position.x, y: position.y })]
    );

    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }

    await recordHistory(client, {
      actionType: "node_move",
      targetKind: "node",
      targetId: id,
      beforeState: {
        id,
        data: beforeResult.rows[0].data || {},
      },
      afterState: {
        id,
        data: rows[0].data || {},
      },
    });
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("PATCH /api/nodes error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(request) {
  const client = await pool.connect();
  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Find all downstream nodes reachable from this node
    await client.query("BEGIN");
    const { rows: downstream } = await client.query(
      `WITH RECURSIVE reachable AS (
        SELECT $2::text AS node_id
        UNION
        SELECT e.to_node
        FROM edges e
        JOIN reachable r ON e.from_node = r.node_id
        WHERE e.graph_id = $1
      )
      SELECT node_id FROM reachable`,
      [GRAPH_ID, id]
    );

    const nodeIds = downstream.map((r) => r.node_id);
    const beforeNodes = await client.query(
      `SELECT id, label, type, data, created_at
       FROM nodes
       WHERE graph_id = $1 AND id = ANY($2)`,
      [GRAPH_ID, nodeIds]
    );
    const beforeEdges = await client.query(
      `SELECT id, from_node, to_node, label, type, data, created_at
       FROM edges
       WHERE graph_id = $1 AND (from_node = ANY($2) OR to_node = ANY($2))`,
      [GRAPH_ID, nodeIds]
    );

    // Edges are deleted automatically via ON DELETE CASCADE
    await client.query(
      `DELETE FROM nodes WHERE graph_id = $1 AND id = ANY($2)`,
      [GRAPH_ID, nodeIds]
    );

    await recordHistory(client, {
      actionType: "node_delete_cascade",
      targetKind: "node",
      targetId: id,
      beforeState: {
        nodes: beforeNodes.rows,
        edges: beforeEdges.rows,
      },
    });
    await client.query("COMMIT");
    return NextResponse.json({ deleted: nodeIds });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("DELETE /api/nodes error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    client.release();
  }
}
