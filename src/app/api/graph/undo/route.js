import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { undoGraph } from "@/lib/graphHistory";

export async function POST() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const state = await undoGraph(client);
    await client.query("COMMIT");
    return NextResponse.json(state);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/graph/undo error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    client.release();
  }
}
