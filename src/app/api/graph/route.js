import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { GRAPH_ID } from "@/lib/constants";

export async function GET() {
  try {
    const nodesResult = await pool.query(
      "SELECT id, label, type, data FROM nodes WHERE graph_id = $1",
      [GRAPH_ID]
    );

    const edgesResult = await pool.query(
      "SELECT id, from_node, to_node, label, type, data FROM edges WHERE graph_id = $1",
      [GRAPH_ID]
    );

    const nodes = nodesResult.rows.map((row) => ({
      id: row.id,
      type: row.type || "default",
      position: row.data?.position || { x: 0, y: 0 },
      data: { label: row.label || row.id },
    }));

    const edges = edgesResult.rows.map((row) => {
      const payload =
        row.data && typeof row.data === "object" ? { ...row.data } : {};
      return {
        id: `${row.from_node}-${row.to_node}`,
        source: row.from_node,
        target: row.to_node,
        label: row.label || "",
        markerEnd: { type: "arrowclosed" },
        data: {
          ...payload,
          executorType: row.type || "default",
        },
      };
    });

    return NextResponse.json({ nodes, edges });
  } catch (err) {
    console.error("GET /api/graph error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
