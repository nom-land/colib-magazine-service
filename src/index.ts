import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { logger } from "hono/logger";

import "dotenv/config";
import { log } from "./logger";
import { Magazine } from "./type";
import { resolve } from "path";
import { readFile } from "fs/promises";
import { Feeds } from "nomland.js/node";

const app = new Hono();

app.use("*", cors());

app.use(logger((str) => (new Date(), str)));
app.get("/magazinesList", async (c) => {
    const data = await readFile(
        resolve(__dirname, "../api/magazinesList"),
        "utf-8"
    );

    console.log(data);
    return c.json(data);
});

app.use(logger((str) => (new Date(), str)));
app.get("/magazine/:slug", async (c) => {
    const slug = c.req.param("slug");
    const data = await readFile(
        resolve(__dirname, "../api/magazinesList"),
        "utf-8"
    );

    const magazinesList: Magazine[] = JSON.parse(data);

    const magazine = magazinesList.find((m) => m.slug === slug);
    if (!magazine) {
        return c.json({ error: "Invalid param." }, 401);
    } else {
        const feeds: Feeds = JSON.parse(
            await readFile(
                resolve(__dirname, "../api/magazines/content-" + magazine.uid),
                "utf-8"
            )
        );

        return c.json({
            magazine,
            feeds,
        });
    }
});

const start = async () => {
    const port = Number(process.env.PORT) || 3000;

    log.info(`🎉 Server is running on port ${port}`);

    serve({
        fetch: app.fetch,
        port,
    });
};

start();
