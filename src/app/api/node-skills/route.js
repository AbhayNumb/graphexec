import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { GRAPH_ID } from "@/lib/constants";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const nodeId = searchParams.get("node_id");

  if (!nodeId) {
    return NextResponse.json({ error: "node_id is required" }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `SELECT ns.id, ns.skill_id, ns.execution_order, ns.config_override,
              s.type AS skill_type, s.description AS skill_description,
              s.config AS skill_config
       FROM node_skills ns
       JOIN skills s ON s.id = ns.skill_id
       WHERE ns.graph_id = $1 AND ns.node_id = $2
       ORDER BY ns.execution_order ASC`,
      [GRAPH_ID, nodeId]
    );
    return NextResponse.json(result.rows);
  } catch (err) {
    console.error("GET /api/node-skills error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { node_id, skill_id } = await request.json();

    if (!node_id || !skill_id) {
      return NextResponse.json(
        { error: "node_id and skill_id are required" },
        { status: 400 }
      );
    }

    const maxOrder = await pool.query(
      "SELECT COALESCE(MAX(execution_order), 0) AS max_order FROM node_skills WHERE graph_id = $1 AND node_id = $2",
      [GRAPH_ID, node_id]
    );
    const nextOrder = maxOrder.rows[0].max_order + 1;

    const result = await pool.query(
      `INSERT INTO node_skills (graph_id, node_id, skill_id, execution_order)
       VALUES ($1, $2, $3, $4)
       RETURNING id, skill_id, execution_order, config_override`,
      [GRAPH_ID, node_id, skill_id, nextOrder]
    );

    const skill = await pool.query("SELECT type, description, config FROM skills WHERE id = $1", [skill_id]);
    const row = {
      ...result.rows[0],
      skill_type: skill.rows[0]?.type,
      skill_description: skill.rows[0]?.description,
      skill_config: skill.rows[0]?.config,
    };

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    console.error("POST /api/node-skills error:", err);
    const msg = err.code === "23505" ? "Skill already assigned at that order" : err.message;
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(request) {
  try {
    const { id, node_id } = await request.json();

    await pool.query(
      "DELETE FROM node_skills WHERE id = $1 AND graph_id = $2",
      [id, GRAPH_ID]
    );

    const remaining = await pool.query(
      "SELECT id FROM node_skills WHERE graph_id = $1 AND node_id = $2 ORDER BY execution_order ASC",
      [GRAPH_ID, node_id]
    );
    for (let i = 0; i < remaining.rows.length; i++) {
      await pool.query(
        "UPDATE node_skills SET execution_order = $1 WHERE id = $2",
        [i + 1, remaining.rows[i].id]
      );
    }

    return NextResponse.json({ deleted: id });
  } catch (err) {
    console.error("DELETE /api/node-skills error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const { node_id, ordered_ids } = await request.json();

    if (!node_id || !Array.isArray(ordered_ids)) {
      return NextResponse.json(
        { error: "node_id and ordered_ids[] are required" },
        { status: 400 }
      );
    }

    for (let i = 0; i < ordered_ids.length; i++) {
      await pool.query(
        "UPDATE node_skills SET execution_order = $1 WHERE id = $2 AND graph_id = $3 AND node_id = $4",
        [i + 1, ordered_ids[i], GRAPH_ID, node_id]
      );
    }

    return NextResponse.json({ reordered: true });
  } catch (err) {
    console.error("PATCH /api/node-skills error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
