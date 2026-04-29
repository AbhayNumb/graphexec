import { NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET() {
  try {
    const result = await pool.query(
      "SELECT id, type, config, code, description, created_at FROM skills ORDER BY created_at DESC"
    );
    return NextResponse.json(result.rows);
  } catch (err) {
    console.error("GET /api/skills error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { id, type, config, code, description } = await request.json();

    if (!id || !type) {
      return NextResponse.json(
        { error: "id and type are required" },
        { status: 400 }
      );
    }

    const result = await pool.query(
      `INSERT INTO skills (id, type, config, code, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, type, config, code, description, created_at`,
      [id, type, config ?? {}, code ?? null, description ?? null]
    );

    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (err) {
    console.error("POST /api/skills error:", err);
    const msg =
      err.code === "23505"
        ? `Skill "${err.detail?.match(/\(id\)=\((.+?)\)/)?.[1] || ""}" already exists`
        : err.detail || err.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function PATCH(request) {
  try {
    const { id, type, config, code, description } = await request.json();

    if (!id || !type) {
      return NextResponse.json(
        { error: "id and type are required" },
        { status: 400 }
      );
    }

    const result = await pool.query(
      `UPDATE skills SET type = $2, config = $3, code = $4, description = $5
       WHERE id = $1
       RETURNING id, type, config, code, description, created_at`,
      [id, type, config ?? {}, code ?? null, description ?? null]
    );

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("PATCH /api/skills error:", err);
    return NextResponse.json(
      { error: err.detail || err.message },
      { status: 400 }
    );
  }
}

export async function DELETE(request) {
  try {
    const { id } = await request.json();
    await pool.query("DELETE FROM skills WHERE id = $1", [id]);
    return NextResponse.json({ deleted: id });
  } catch (err) {
    console.error("DELETE /api/skills error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
