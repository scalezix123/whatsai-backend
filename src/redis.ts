import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL;

if (!redisUrl) {
  // During local development, we fallback to localhost if no URL is provided.
  console.log("REDIS_URL not found, falling back to localhost:6379");
}

export const redis = new Redis(redisUrl || "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
});

redis.on("error", (err) => {
  console.warn("Redis connection warning (may ignore if local):", err.message);
});
