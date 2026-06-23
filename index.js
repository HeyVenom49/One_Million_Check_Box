import http from "node:http";
import path from "node:path";

import express from "express";
import { Server } from "socket.io";
import { publisher, subscriber, redis } from "./redis-connection.js";

const CHECKBOX_SIZE = 100;
const CHECKBOX_STATE_KEY = "checkbox-state";
const state = {
  checkboxes: new Array(CHECKBOX_SIZE).fill(false),
};

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
      //? We don't want to set state in the server as it's saved in the redis server
      // state.checkboxes[index] = checked;
      io.emit("server:checkbox:change", { index, checked });
    }
  });

  // Socket IO Handler
  io.on("connection", (socket) => {
    console.log(`Socket connected`, { id: socket.id });
    socket.on("client:checkbox:change", async (data) => {
      console.log(`[Socket:${socket.id}]:client:checkbox:change`, data);
      //! Here we just updating the server but there's a problem that if we scale up horizontally, it will not update the other server which we don't want that
      // const { index, checked } = data;
      // state.checkboxes[index] = checked;
      // io.emit("server:checkbox:change", { index, checked });
      //? Here we solving the problem of maintaining the state if a new user comes with new server
      const existingState = await redis.get(CHECKBOX_STATE_KEY);
      if (existingState) {
        const remoteData = JSON.parse(existingState);
        remoteData[data.index] = data.checked;
        await redis.set(CHECKBOX_STATE_KEY, JSON.stringify(remoteData));
      } else {
        await redis.set(
          CHECKBOX_STATE_KEY,
          JSON.stringify(new Array(CHECKBOX_SIZE).fill(false)),
        );
      }
      ///////////////////////////////////
      await publisher.publish(
        "internal-server:checkbox:change",
        JSON.stringify(data),
      );
    });
  });

  // Express Handler
  app.use(express.static(path.resolve("./public")));
  app.get("/health", (_, res) => res.json({ healthy: true }));
  app.get("/checkboxes", async (_, res) => {
    const existingState = await redis.get(CHECKBOX_STATE_KEY);
    if (existingState) {
      const remoteData = JSON.parse(existingState);
      return res.json({ checkboxes: remoteData });
    }
    res.json({ checkboxes: new Array(CHECKBOX_SIZE).fill(false) });
  });

  server.listen(PORT, () => {
    console.log(`Server is running on the http://localhost:${PORT}`);
  });
}

main();
