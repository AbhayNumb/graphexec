import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { GRAPH_ID } from "@/lib/constants";

export async function POST(request) {
  try {
    const body = await request.json();
    const { id, label, type = "default", position = { x: 0, y: 0 } } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const { rows } = await pool.query(
      `INSERT INTO nodes (graph_id, id, label, type, data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, label, type, data`,
      [GRAPH_ID, id, label || id, type, JSON.stringify({ position })]
    );

    const row = rows[0];
    const node = {
      id: row.id,
      type: row.type,
      position: row.data?.position || position,
      data: { label: row.label || row.id },
    };

    return NextResponse.json(node, { status: 201 });
  } catch (err) {
    console.error("POST /api/nodes error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json();
    const { id, position } = body;

    if (!id || !position || typeof position.x !== "number" || typeof position.y !== "number") {
      return NextResponse.json(
        { error: "id and position { x, y } are required" },
        { status: 400 }
      );
    }

    const { rowCount } = await pool.query(
      `UPDATE nodes SET data = jsonb_set(
         COALESCE(data, '{}'::jsonb),
         '{position}',
         $3::jsonb,
         true
       )
       WHERE graph_id = $1 AND id = $2`,
      [GRAPH_ID, id, JSON.stringify({ x: position.x, y: position.y })]
    );

    if (rowCount === 0) {
      return NextResponse.json({ error: "Node not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PATCH /api/nodes error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { id } = await request.json();

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Find all downstream nodes reachable from this node
    const { rows: downstream } = await pool.query(
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

    // Edges are deleted automatically via ON DELETE CASCADE
    await pool.query(
      `DELETE FROM nodes WHERE graph_id = $1 AND id = ANY($2)`,
      [GRAPH_ID, nodeIds]
    );

    return NextResponse.json({ deleted: nodeIds });
  } catch (err) {
    console.error("DELETE /api/nodes error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
