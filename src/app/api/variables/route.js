import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { GRAPH_ID } from "@/lib/constants";

export async function GET() {
  try {
    const result = await pool.query(
      "SELECT id, name, kind, data_type, default_value, description, created_at FROM variables WHERE graph_id = $1 AND kind = 'normal' ORDER BY created_at DESC",
      [GRAPH_ID]
    );
    return NextResponse.json(result.rows);
  } catch (err) {
    console.error("GET /api/variables error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { name, data_type, default_value, description } =
      await request.json();

    if (!name || !data_type) {
      return NextResponse.json(
        { error: "name and data_type are required" },
        { status: 400 }
      );
    }

    if (name.startsWith("SECRET_")) {
      return NextResponse.json(
        { error: "Variables starting with SECRET_ are not allowed" },
        { status: 400 }
      );
    }

    const result = await pool.query(
      `INSERT INTO variables (graph_id, name, kind, data_type, default_value, description)
       VALUES ($1, $2, 'normal', $3, $4, $5)
       RETURNING id, name, kind, data_type, default_value, description, created_at`,
      [GRAPH_ID, name, data_type, default_value ?? null, description ?? null]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    console.error("POST /api/variables error:", err);
    return NextResponse.json({ error: err.detail || err.message }, { status: 400 });
  }
}

export async function DELETE(request) {
  try {
    const { name } = await request.json();

    await pool.query(
      "DELETE FROM variables WHERE graph_id = $1 AND name = $2",
      [GRAPH_ID, name]
    );

    return NextResponse.json({ deleted: name });
  } catch (err) {
    console.error("DELETE /api/variables error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
