import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getHistoryState } from "@/lib/graphHistory";

export async function GET() {
  const client = await pool.connect();
  try {
    const state = await getHistoryState(client);
    return NextResponse.json(state);
  } catch (err) {
    console.error("GET /api/graph/history error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    client.release();
  }
}
