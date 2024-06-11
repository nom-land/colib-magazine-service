import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { logger } from "hono/logger";

import "dotenv/config";
import { log } from "./logger";

const app = new Hono();

app.use("*", cors());

app.use(logger((str) => (new Date(), str)));
app.get("/magazine/list", async (c) => {
    return c.json({});
});

app.use(logger((str) => (new Date(), str)));
app.get("/magazine/:id", async (c) => {
    return c.json({});
});

const start = async () => {
    // Contract
    const port = Number(process.env.PORT) || 3000;

    log.info(`🎉 Server is running on port ${port}`);

    serve({
        fetch: app.fetch,
        port,
    });
};

start();
