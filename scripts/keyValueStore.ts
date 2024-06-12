// keyValueStore.ts
import * as fs from "fs";
import * as path from "path";
import "dotenv/config";
import { Magazine } from "../src/type";

// TODO: set as global nunti id map file path dir
// const rootPath = path.resolve("./");

const rootPath = path.resolve(process.env.NOTE_ID_MAP_PATH || "./");
const apiPath = path.resolve("./api");

const getFilePath = (table?: string) => {
    let fileName: string;
    if (table) {
        fileName = `store/${table}.json`;
    } else {
        fileName = "store/keyValueStore.json";
    }
    return path.join(rootPath, fileName);
};

export function setKeyValue(
    key: string,
    value: string,
    table?: string
): boolean {
    const filePath = getFilePath(table);

    try {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, "{}");
        }

        const data = fs.readFileSync(filePath, "utf-8");
        let store: Record<string, string> = {};

        if (data) {
            store = JSON.parse(data);
        }

        store[key] = value;
        fs.writeFileSync(filePath, JSON.stringify(store, null, 2));

        return true;
    } catch (err) {
        console.error(err);
        return false;
    }
}

export function removeKeyValue(key: string, table?: string): boolean {
    const filePath = getFilePath(table);

    try {
        if (!fs.existsSync(filePath)) {
            console.error("No file path found.");
            return false;
        }

        const data = fs.readFileSync(filePath, "utf-8");
        let store: Record<string, string> = {};

        if (data) {
            store = JSON.parse(data);
        }

        if (store[key]) {
            delete store[key];
            fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
            return true;
        }

        return false;
    } catch (err) {
        console.error(err);
        return false;
    }
}

export function loadKeyValuePairs(
    targetMap: Map<string, string>,
    table?: string
): void {
    const filePath = getFilePath(table);
    console.log(filePath);

    try {
        if (!fs.existsSync(filePath)) {
            console.error("No file path found.");
            return;
        }

        const data = fs.readFileSync(filePath, "utf-8");
        let store: Record<string, string> = {};

        if (data) {
            store = JSON.parse(data);
        }

        for (const [key, value] of Object.entries(store)) {
            targetMap.set(key, value);
        }
    } catch (err) {
        console.error(err);
    }
}

export function getMapValue(map: Map<string, string>, key: string) {
    const data = map.get(key);
    if (!data) {
        return [new Map(), new Map()];
    }

    let store: Record<string, string> = {};
    store = JSON.parse(data);

    const targetMap = new Map<string, string>();
    const targetMapCopy = new Map<string, string>();

    for (const [key, value] of Object.entries(store)) {
        targetMap.set(key, value);
        targetMapCopy.set(key, value);
    }
    return [targetMap, targetMapCopy];
}

export function storeMagazineListAPI(data: Magazine[]): boolean {
    const filePath = path.join(apiPath, "magazinesList");

    try {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, "{}");
        }

        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

        data.map((m) => {
            const filePath = path.join(apiPath, "magazines/orders-" + m.uid);
            if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, "{}");
            }
        });

        return true;
    } catch (err) {
        console.error(err);
        return false;
    }
}

export function loadMagazineOrders(targetMap: Map<string, string>, id: string) {
    const filePath = path.join(apiPath, "magazines/orders-" + id);
    try {
        if (!fs.existsSync(filePath)) {
            console.error("No file path found.");
            return;
        }

        const data = fs.readFileSync(filePath, "utf-8");
        let store: Record<string, string> = {};

        if (data) {
            store = JSON.parse(data);
        }

        for (const [key, value] of Object.entries(store)) {
            targetMap.set(key, value);
        }
    } catch (err) {
        console.error(err);
    }
}

export function storeMagazineOrdersContentAPI(
    id: string,
    data: Map<string, string>
): boolean {
    const filePath = path.join(apiPath, "magazines/orders-" + id);
    try {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, "{}");
        }

        fs.writeFileSync(
            filePath,
            JSON.stringify(Object.fromEntries(data), null, 2)
        );

        return true;
    } catch (err) {
        console.error(err);
        return false;
    }
}

export function storeMagazineContentAPI(id: string, data: string) {
    const filePath = path.join(apiPath, "magazines/content-" + id);
    try {
        fs.writeFileSync(filePath, data);
        return true;
    } catch (err) {
        console.error(err);
        return false;
    }
}
