import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { clearGraphHistory } from "@/lib/graphHistory";

export async function POST() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const state = await clearGraphHistory(client);
    await client.query("COMMIT");
    return NextResponse.json(state);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/graph/history/clear error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    client.release();
  }
}
