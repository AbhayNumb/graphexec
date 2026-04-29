import { NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  PREVIEW_ROOM_ID,
  PREVIEW_USER_ID,
  PREVIEW_AGENT_ID,
  DEFAULT_SENDER_PHONE,
  DEFAULT_CHAT_BOOKING_ID,
  DEFAULT_ASSISTANT_IN_REPLY_TO,
} from "@/lib/roomChatPreview";
import { formattedMessageToParts } from "@/lib/formattedMessage";

function classifyRole(content) {
  if (!content || typeof content !== "object") return "unknown";
  if (Object.prototype.hasOwnProperty.call(content, "human_in_the_loop")) {
    return "hitl";
  }
  if (Object.prototype.hasOwnProperty.call(content, "inReplyTo")) {
    return "assistant";
  }
  return "user";
}

async function callOrchestrator(userMessage) {
  const url =
    process.env.ORCHESTRATOR_EXECUTE_URL ||
    "http://localhost:8080/orchestrator/execute";
  const apiKey = process.env.ORCHESTRATOR_API_KEY;
  if (!apiKey) {
    console.warn(
      "ORCHESTRATOR_API_KEY is not set; skipping orchestrator execute"
    );
    return { ok: false, skipped: true, reason: "missing_api_key" };
  }

  const body = {
    room_id: PREVIEW_ROOM_ID,
    user_message: userMessage,
    mode: process.env.ORCHESTRATOR_MODE || "fast",
    sender_phone: process.env.CHAT_SENDER_PHONE || DEFAULT_SENDER_PHONE,
    currentChatBookingId:
      process.env.CHAT_BOOKING_ID || DEFAULT_CHAT_BOOKING_ID,
  };
  console.log("body", body);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  });
  console.log("res", res);
  const text = await res.text();

  if (!res.ok) {
    return {
      ok: false,
      skipped: false,
      status: res.status,
      error: text.slice(0, 500),
    };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      ok: false,
      skipped: false,
      error: "Orchestrator returned non-JSON body",
    };
  }

  return { ok: true, skipped: false, data };
}

async function storeAssistantRepliesFromOrchestrator(orchestratorBody) {
  if (!orchestratorBody || orchestratorBody.error) {
    return { stored: 0 };
  }

  const raw = orchestratorBody.variables?.formatted_message;
  const parts = formattedMessageToParts(raw);
  if (!parts.length) {
    return { stored: 0 };
  }

  const inReplyTo =
    process.env.CHAT_IN_REPLY_TO || DEFAULT_ASSISTANT_IN_REPLY_TO;
  const runId = orchestratorBody._id ?? null;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let stored = 0;
    for (const msgText of parts) {
      const content = {
        text: msgText,
        source: "orchestrator",
        inReplyTo,
        attachments: [],
        ...(runId ? { orchestrator_run_id: runId } : {}),
      };
      await client.query(
        `INSERT INTO memories (id, type, "createdAt", content, "userId", "agentId", "roomId", "unique")
         VALUES (gen_random_uuid(), $1, NOW(), $2::jsonb, $3::uuid, $4::uuid, $5::uuid, true)`,
        [
          "messages",
          content,
          PREVIEW_USER_ID,
          PREVIEW_AGENT_ID,
          PREVIEW_ROOM_ID,
        ]
      );
      stored += 1;
    }
    await client.query("COMMIT");
    return { stored, runId };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function GET() {
  try {
    const result = await pool.query(
      `SELECT id, "createdAt", content
       FROM memories
       WHERE "roomId" = $1::uuid AND type = $2
       ORDER BY "createdAt" ASC`,
      [PREVIEW_ROOM_ID, "messages"]
    );
    const messages = result.rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      content: row.content,
      role: classifyRole(row.content),
    }));
    return NextResponse.json({ messages });
  } catch (err) {
    console.error("GET /api/room-messages error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const raw = body?.text;
    const sendAs = body?.sendAs === "hitl" ? "hitl" : "user";

    if (typeof raw !== "string" || !raw.trim()) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const trimmed = raw.trim();
    const senderPhone = process.env.CHAT_SENDER_PHONE || DEFAULT_SENDER_PHONE;

    const content =
      sendAs === "hitl"
        ? {
            text: trimmed,
            human_in_the_loop: true,
            source: "whatsapp-webhook",
          }
        : {
            text: trimmed,
            source: "whatsapp-webhook",
            attachments: [],
            sender_phone: senderPhone,
          };

    await pool.query(
      `INSERT INTO memories (id, type, "createdAt", content, "userId", "agentId", "roomId", "unique")
       VALUES (gen_random_uuid(), $1, NOW(), $2::jsonb, $3::uuid, $4::uuid, $5::uuid, true)`,
      [
        "messages",
        content,
        PREVIEW_USER_ID,
        PREVIEW_AGENT_ID,
        PREVIEW_ROOM_ID,
      ]
    );

    let orchestrator;
    if (sendAs === "hitl") {
      orchestrator = {
        ok: true,
        skipped: true,
        reason: "human_in_the_loop",
        formattedMessageStored: 0,
      };
    } else {
      try {
        const orchResult = await callOrchestrator(trimmed);
        if (orchResult.ok && orchResult.data) {
          const { stored, runId } = await storeAssistantRepliesFromOrchestrator(
            orchResult.data
          );
          orchestrator = {
            ok: true,
            skipped: false,
            runId: orchResult.data._id ?? runId ?? null,
            graphStatus: orchResult.data.status ?? null,
            formattedMessageStored: stored,
          };
        } else {
          orchestrator = {
            ok: orchResult.ok,
            skipped: !!orchResult.skipped,
            reason: orchResult.reason,
            status: orchResult.status,
            error: orchResult.error,
            formattedMessageStored: 0,
          };
        }
      } catch (e) {
        orchestrator = {
          ok: false,
          skipped: false,
          error: e.message || String(e),
          formattedMessageStored: 0,
        };
      }
    }

    return NextResponse.json(
      {
        ok: true,
        sendAs,
        orchestrator,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/room-messages error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const mem = await client.query(
      `DELETE FROM memories WHERE "roomId" = $1::uuid`,
      [PREVIEW_ROOM_ID]
    );
    const esc = await client.query(
      `DELETE FROM escalations WHERE "roomId" = $1::uuid`,
      [PREVIEW_ROOM_ID]
    );
    await client.query("COMMIT");
    return NextResponse.json({
      ok: true,
      deletedMemories: mem.rowCount,
      deletedEscalations: esc.rowCount,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("DELETE /api/room-messages error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    client.release();
  }
}
