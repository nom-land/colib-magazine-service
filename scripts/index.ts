import Nomland, { ShareInput, NoteDetails } from "nomland.js";

import "dotenv/config";
import { log } from "../src/logger";
import { getMsgKeyFromTgUrl, getRawContent } from "./telegram";
import {
    getProperties,
    queryMagazineContentDB,
    queryMagazinesDB,
} from "./notion";
import {
    getMapValue,
    loadKeyValuePairs,
    setKeyValue,
    storeAPI,
} from "./keyValueStore";

const shareIdsMap = new Map<string, string>();
const configMap = new Map<string, string>();

async function setUp() {
    const contextId = process.env.CONTEXT_ID;
    const contextName = process.env.CONTEXT_NAME;
    const contextGroupId = process.env.CONTEXT_GROUP_ID;
    if (!contextId || !contextName || !contextGroupId) {
        throw new Error(
            "Context id, context name or context group id not found in env."
        );
    }
    console.log(
        "Env initialized :\ncontextId: ",
        contextId,
        "contextName: ",
        contextName,
        "contextGroupId: ",
        contextGroupId
    );

    loadKeyValuePairs(shareIdsMap, "nunti-idMap");
    loadKeyValuePairs(configMap, "colib-magazine-config");

    const appKey = process.env.APP_ADMIN_KEY as `0x${string}`;
    const appName = process.env.APP_NAME as string;
    if (!appKey) {
        throw new Error("APP_ADMIN_KEY or APP_NAME not found in env.");
    }
    const nomland = new Nomland(appName, appKey);

    console.log("Nomland Initialized.");

    const magazineLastUpdate =
        configMap.get("magazineLastUpdate") || new Date(0).toISOString();

    // TODO：notion 的分页？
    const [magazineLastUpdates, newMagazineLastUpdates] = getMapValue(
        configMap,
        "magazineLastUpdates"
    );

    console.log(
        "Get last edit time of magazines: ",
        JSON.stringify(magazineLastUpdates)
    );

    const currentTime = new Date().toISOString();

    const { magazineIds, magazinesList } = await queryMagazinesDB(
        magazineLastUpdate
    );

    // Save magazinesList
    const res = storeAPI(magazinesList, "magazinesList");
    if (!res) {
        throw new Error("Failed to store magazinesList.");
    }

    console.log("Magazines queried: ", magazineIds);

    magazineIds.map((id: string) => {
        newMagazineLastUpdates.set(id, currentTime);
    });
    setKeyValue(
        "magazineLastUpdates",
        JSON.stringify(newMagazineLastUpdates),
        "colib-magazine-config"
    );
    setKeyValue("magazineLastUpdate", currentTime, "colib-magazine-config");

    const magazineContents = await queryMagazineContentDB(
        magazineIds,
        new Map(magazineLastUpdates)
    );

    console.log(
        "MagazineContent queried. Length of magazineContent that needs to be processed:",
        magazineContents.length
    );

    return {
        magazineContents,
        magazineIds,
        contextId,
        contextName,
        contextGroupId,
        nomland,
    };
}

async function main() {
    const {
        magazineContents,
        contextId,
        contextName,
        contextGroupId,
        nomland,
    } = await setUp();

    magazineContents.map(async (item, index) => {
        try {
            const {
                title,
                tgUrl,
                authorId,
                authorTgAccount,
                notionReview,
                notionReviewUrl,
            } = getProperties(item);

            const { authorUrl, content, entityUrl, publishDate } =
                await getRawContent(tgUrl);

            if (authorUrl !== authorTgAccount) {
                log.error(
                    "TG Account in notion does not match author url parsed from tg url."
                );
            }

            // 如果填写了分享语/分享链接的，优先存储填写的内容。未填写的，根据 tg 原始内容解析。
            let reviewContent = "";
            let reviewUrl = "";

            if (notionReview) {
                reviewContent = notionReview;
            } else if (content) {
                reviewContent = content;
            }
            if (notionReviewUrl) {
                reviewUrl = notionReviewUrl;
            } else if (entityUrl) {
                reviewUrl = entityUrl;
            } else {
                throw new Error("No entity url found: " + tgUrl);
            }
            const shareInput = {
                author: authorId,
                context: contextId,
                details: {
                    content: reviewContent,
                    sources: ["Telegram", contextName],
                    external_url: tgUrl,
                    submitted_by: contextId, // TODO: add it in nomland.js
                },
                date_published: publishDate,
                entityUrl: reviewUrl,
            } as ShareInput;
            if (title) {
                shareInput.details.title = title;
            }

            const msgKey = getMsgKeyFromTgUrl(tgUrl, contextGroupId);
            const shareId = shareIdsMap.get(msgKey);

            if (shareId) {
                const shareNoteKey = {
                    characterId: shareId.split("-")[0],
                    noteId: shareId.split("-")[1],
                };

                // check if there's difference
                const shareNote = await nomland.getShare(shareNoteKey);
                const oldDetails = shareNote?.note.details;
                if (
                    oldDetails?.content === shareInput.details.content &&
                    oldDetails?.title === shareInput.details.title
                ) {
                    console.log(index + " No changes found: " + tgUrl);

                    return;
                }
                console.log(index + " Requiring updates: " + tgUrl);

                // await nomland.editNote(shareNoteKey, (n: NoteDetails) => {
                //     n.content = shareInput.details.content;
                //     n.title = shareInput.details.title;
                //     return n;
                // });
            } else {
                // create new share
                console.log(index + " Creating new share for " + tgUrl);
                // const { noteKey } = await nomland.createShare(shareInput);
                // shareIdsMap.set(
                //     msgKey,
                //     noteKey.characterId + "-" + noteKey.noteId
                // );
                // setKeyValue(msgKey, noteKey.characterId + "-" + noteKey.noteId);
            }
        } catch (e) {
            // TODO
            console.log(e);
        }
    });
}

main();
