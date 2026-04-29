import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { GRAPH_ID } from "@/lib/constants";
import { recordHistory } from "@/lib/graphHistory";

export async function POST(request) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const {
      from_node,
      to_node,
      label = "",
      type = "default",
      data = {},
    } = body;

    if (!from_node || !to_node) {
      return NextResponse.json(
        { error: "from_node and to_node are required" },
        { status: 400 }
      );
    }

    const dataJson =
      data && typeof data === "object" ? JSON.stringify(data) : "{}";

    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO edges (graph_id, from_node, to_node, label, type, data)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING id, from_node, to_node, label, type, data, created_at`,
      [GRAPH_ID, from_node, to_node, label, type, dataJson]
    );
    const row = rows[0];
    await recordHistory(client, {
      actionType: "edge_create",
      targetKind: "edge",
      targetId: String(row.id),
      afterState: row,
    });
    await client.query("COMMIT");

    return NextResponse.json({ ok: true, edge: row }, { status: 201 });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/edges error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function PATCH(request) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const { from_node, to_node, type, label, data } = body;

    if (!from_node || !to_node) {
      return NextResponse.json(
        { error: "from_node and to_node are required" },
        { status: 400 }
      );
    }

    if (type === undefined && label === undefined && data === undefined) {
      return NextResponse.json(
        { error: "Provide at least one of type, label, data" },
        { status: 400 }
      );
    }

    await client.query("BEGIN");
    const beforeResult = await client.query(
      `SELECT id, from_node, to_node, label, type, data
       FROM edges
       WHERE graph_id = $1 AND from_node = $2 AND to_node = $3`,
      [GRAPH_ID, from_node, to_node]
    );
    if (beforeResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Edge not found" }, { status: 404 });
    }

    const sets = [];
    const values = [GRAPH_ID, from_node, to_node];
    let n = 4;

    if (type !== undefined) {
      sets.push(`type = $${n++}`);
      values.push(type);
    }
    if (label !== undefined) {
      sets.push(`label = $${n++}`);
      values.push(label);
    }
    if (data !== undefined) {
      sets.push(`data = $${n++}::jsonb`);
      values.push(
        data && typeof data === "object" ? JSON.stringify(data) : "{}"
      );
    }

    const { rowCount } = await client.query(
      `UPDATE edges SET ${sets.join(", ")}
       WHERE graph_id = $1 AND from_node = $2 AND to_node = $3`,
      values
    );

    if (rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Edge not found" }, { status: 404 });
    }

    const afterResult = await client.query(
      `SELECT id, from_node, to_node, label, type, data
       FROM edges
       WHERE graph_id = $1 AND from_node = $2 AND to_node = $3`,
      [GRAPH_ID, from_node, to_node]
    );
    await recordHistory(client, {
      actionType: "edge_update",
      targetKind: "edge",
      targetId: `${from_node}-${to_node}`,
      beforeState: { edges: beforeResult.rows },
      afterState: { edges: afterResult.rows },
    });
    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("PATCH /api/edges error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(request) {
  const client = await pool.connect();
  try {
    const body = await request.json();
    const { from_node, to_node } = body;

    if (!from_node || !to_node) {
      return NextResponse.json(
        { error: "from_node and to_node are required" },
        { status: 400 }
      );
    }

    await client.query("BEGIN");
    const beforeResult = await client.query(
      `SELECT id, from_node, to_node, label, type, data, created_at
       FROM edges
       WHERE graph_id = $1 AND from_node = $2 AND to_node = $3`,
      [GRAPH_ID, from_node, to_node]
    );
    await client.query(
      `DELETE FROM edges WHERE graph_id = $1 AND from_node = $2 AND to_node = $3`,
      [GRAPH_ID, from_node, to_node]
    );
    if (beforeResult.rowCount > 0) {
      await recordHistory(client, {
        actionType: "edge_delete",
        targetKind: "edge",
        targetId: `${from_node}-${to_node}`,
        beforeState: { edges: beforeResult.rows },
      });
    }
    await client.query("COMMIT");

    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("DELETE /api/edges error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    client.release();
  }
}
