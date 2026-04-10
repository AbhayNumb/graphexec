import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { GRAPH_ID } from "@/lib/constants";

export async function POST(request) {
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

    await pool.query(
      `INSERT INTO edges (graph_id, from_node, to_node, label, type, data)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [GRAPH_ID, from_node, to_node, label, type, dataJson]
    );

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("POST /api/edges error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request) {
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

    const { rowCount } = await pool.query(
      `UPDATE edges SET ${sets.join(", ")}
       WHERE graph_id = $1 AND from_node = $2 AND to_node = $3`,
      values
    );

    if (rowCount === 0) {
      return NextResponse.json({ error: "Edge not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PATCH /api/edges error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const body = await request.json();
    const { from_node, to_node } = body;

    if (!from_node || !to_node) {
      return NextResponse.json(
        { error: "from_node and to_node are required" },
        { status: 400 }
      );
    }

    await pool.query(
      `DELETE FROM edges WHERE graph_id = $1 AND from_node = $2 AND to_node = $3`,
      [GRAPH_ID, from_node, to_node]
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/edges error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
