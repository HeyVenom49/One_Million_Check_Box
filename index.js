import http from "node:http";
import path from "node:path";

import express from "express";
import { Server } from "socket.io";
import { publisher, subscriber, redis } from "./redis-connection.js";

const CHECKBOX_SIZE = 1_000_000;
const CHECKBOX_STATE_KEY = "checkbox-state:bitmap";
const COOLDOWN_MS = 6 * 1000;
const RATE_LIMIT_KEY_PREFIX = "rate-limit:";

function isValidClientId(clientId) {
  return typeof clientId === "string" && /^[0-9a-f-]{36}$/i.test(clientId);
}

async function getRateLimitRetryAfter(clientId) {
  const lastOperationTime = Number(await redis.get(`${RATE_LIMIT_KEY_PREFIX}${clientId}`));
  if (!lastOperationTime) return null;

  const retryAfter = lastOperationTime + COOLDOWN_MS;
  return Date.now() < retryAfter ? retryAfter : null;
}

async function setRateLimit(clientId) {
  await redis.set(`${RATE_LIMIT_KEY_PREFIX}${clientId}`, String(Date.now()), "PX", COOLDOWN_MS);
}

// Redis stores checkboxes as a bitmap — 1 million bits ≈ 125 KB instead of a huge JSON array.
async function getCheckboxRange(start, count) {
  const result = new Array(count).fill(false);
  if (count === 0) return result;

  const end = start + count - 1;
  const startByte = Math.floor(start / 8);
  const endByte = Math.floor(end / 8);
  const buf = await redis.getrangeBuffer(CHECKBOX_STATE_KEY, startByte, endByte);
  if (!buf || buf.length === 0) return result;

  for (let i = 0; i < count; i++) {
    const bitIndex = start + i;
    const byteIndex = Math.floor(bitIndex / 8) - startByte;
    const bitOffset = 7 - (bitIndex % 8);
    result[i] = ((buf[byteIndex] >> bitOffset) & 1) === 1;
  }

  return result;
}

function parseRangeQuery(query) {
  const start = Math.max(0, Number.parseInt(query.start, 10) || 0);
  const count = Math.min(10_000, Math.max(1, Number.parseInt(query.count, 10) || 100));
  return { start, count };
}

async function main() {
  const PORT = process.env.PORT ?? 8010;

  const app = express();
  const server = http.createServer(app);

  const io = new Server();
  io.attach(server);

  await subscriber.subscribe("internal-server:checkbox:change");
  subscriber.on("message", (channel, message) => {
    if (channel === "internal-server:checkbox:change") {
      const { index, checked } = JSON.parse(message);
      io.emit("server:checkbox:change", { index, checked });
    }
  });

  io.on("connection", (socket) => {
    const clientId = socket.handshake.auth?.clientId;
    console.log(`Socket connected`, { id: socket.id, clientId });

    socket.on("client:checkbox:change", async (data) => {
      console.log(`[Socket:${socket.id}]:client:checkbox:change`, data);

      if (!isValidClientId(clientId)) {
        socket.emit("server:error", {
          index: data.index,
          error: "Invalid client session. Please refresh the page.",
        });
        return;
      }

      const retryAfter = await getRateLimitRetryAfter(clientId);
      if (retryAfter) {
        socket.emit("server:error", {
          index: data.index,
          error: "Please wait 6 seconds before toggling again.",
          retryAfter,
        });
        return;
      }

      const index = Number(data.index);
      if (!Number.isInteger(index) || index < 0 || index >= CHECKBOX_SIZE) {
        socket.emit("server:error", {
          index: data.index,
          error: "Invalid checkbox index.",
        });
        return;
      }

      if (typeof data.checked !== "boolean") {
        socket.emit("server:error", {
          index: data.index,
          error: "Invalid checkbox state.",
        });
        return;
      }

      await setRateLimit(clientId);
      await redis.setbit(CHECKBOX_STATE_KEY, index, data.checked ? 1 : 0);

      await publisher.publish(
        "internal-server:checkbox:change",
        JSON.stringify({ index, checked: data.checked }),
      );
    });
  });

  app.use(express.static(path.resolve("./public")));
  app.get("/health", (_, res) => res.json({ healthy: true }));

  app.get("/checkboxes/stats", async (_, res) => {
    const checked = await redis.bitcount(CHECKBOX_STATE_KEY);
    res.json({ total: CHECKBOX_SIZE, checked });
  });

  app.get("/checkboxes", async (req, res) => {
    const { start, count } = parseRangeQuery(req.query);

    if (start >= CHECKBOX_SIZE) {
      return res.json({ start, checkboxes: [] });
    }

    const safeCount = Math.min(count, CHECKBOX_SIZE - start);
    const checkboxes = await getCheckboxRange(start, safeCount);
    res.json({ start, checkboxes });
  });

  server.listen(PORT, () => {
    console.log(`Server is running on the http://localhost:${PORT}`);
  });
}

main();
