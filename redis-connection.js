import Redis from "ioredis";

//! One way to do this
// const publisher = new Redis({
//   host: "localhost",
//   port: 6379,
// });

// const subscriber = new Redis({
//   host: "localhost",
//   port: 6379,
// });

//! Second way to do this because it break dry principle

function createRedisConnection() {
  return new Redis({
    host: "localhost",
    port: 6379,
  });
}

//? This is for when a new user comes on the new server so it should be get the previous state
export const redis = createRedisConnection();

export const publisher = createRedisConnection();
export const subscriber = createRedisConnection();
