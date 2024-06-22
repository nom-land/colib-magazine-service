import Nomland, {
    ShareInput,
    NoteKey,
    parseEntity,
    createEntity,
} from "nomland.js/node";

import "dotenv/config";
import { log } from "../src/logger";
import { getNoteIdFromTgUrl, getRawContent } from "./telegram";
import {
    getProperties,
    queryMagazineContentDB,
    queryMagazinesDB,
} from "./notion";
import {
    getMapValue,
    loadKeyValuePairs,
    loadMagazineOrders,
    setKeyValue,
    storeMagazineContentAPI,
    storeMagazineListAPI,
    storeMagazineOrdersContentAPI,
} from "./keyValueStore";
import { NoteMetadata } from "crossbell";

const dryRun = process.env.DRY_RUN === "true";

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
        JSON.stringify(Object.fromEntries(magazineLastUpdates)),
        "\nlast update time: ",
        magazineLastUpdate
    );

    const currentTime = new Date().toISOString();

    const { magazineIds, magazinesList } = await queryMagazinesDB(
        magazineLastUpdate
    );

    // Save magazinesList
    const res = storeMagazineListAPI(magazinesList);
    if (!res) {
        throw new Error("Failed to store magazinesList.");
    }

    console.log("Magazines queried: ", magazineIds);

    const magazineContents = await queryMagazineContentDB(
        magazineIds,
        magazineLastUpdates
    );

    console.log(
        "MagazineContent queried. Length of magazineContent that needs to be processed:",
        magazineContents.length
    );

    // Save last update time
    magazineIds.map((id: string) => {
        newMagazineLastUpdates.set(id, currentTime);
    });

    setKeyValue(
        "magazineLastUpdates",
        JSON.stringify(Object.fromEntries(newMagazineLastUpdates)),
        "colib-magazine-config"
    );
    setKeyValue("magazineLastUpdate", currentTime, "colib-magazine-config");

    return {
        magazineContents,
        magazinesList,
        contextId,
        contextName,
        contextGroupId,
        nomland,
    };
}

async function main() {
    const {
        magazinesList,
        magazineContents,
        contextId,
        contextName,
        contextGroupId,
        nomland,
    } = await setUp();

    const ordersRecord = new Map<string, Map<string, string>>();

    magazinesList.map((magazine) => {
        const targetMap = new Map<string, string>();
        loadMagazineOrders(targetMap, magazine.uid);
        ordersRecord.set(magazine.uid, targetMap);
    });

    for (const [index, item] of magazineContents.entries()) {
        try {
            const {
                title,
                tgUrl,
                authorId,
                authorTgAccount,
                notionReview,
                notionReviewUrl,
                magazineId,
            } = getProperties(item);

            const slug = magazinesList.find((m) => m.uid === magazineId)?.slug;
            if (!slug) {
                console.log("Cannot find slug for item: ", item.id);
                return;
            }

            const {
                authorUrl,
                content,
                entityUrl,
                publishDate,
                rawTextContent,
            } = await getRawContent(tgUrl);

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
                    rawContent: [rawTextContent],
                    date_published: publishDate.toISOString(),
                },
                entityUrl: reviewUrl,
            } as ShareInput;
            if (title) {
                shareInput.details.title = title;
            }

            const { shareId, msgKey } = getNoteIdFromTgUrl(
                tgUrl,
                contextGroupId,
                shareIdsMap
            );

            if (shareId) {
                const shareNoteKey = {
                    characterId: shareId.split("-")[0],
                    noteId: shareId.split("-")[1],
                };

                // check if there's difference
                const shareNote = await nomland.getShare(shareNoteKey);

                if (!shareNote) {
                    console.log(
                        index +
                            " Cannot find share for " +
                            shareNoteKey.characterId +
                            "-" +
                            shareNoteKey.noteId +
                            " " +
                            tgUrl
                    );
                    continue;
                }

                const oldDetails = shareNote.note.details;
                if (
                    oldDetails.content === shareInput.details.content &&
                    oldDetails.title === shareInput.details.title &&
                    oldDetails.date_published ===
                        shareInput.details.date_published &&
                    oldDetails.external_url === tgUrl &&
                    shareNote.entity.metadata.url === shareInput.entityUrl
                ) {
                    console.log(index + " No changes found: " + tgUrl);
                    continue;
                } else {
                    // if (oldDetails.content !== shareInput.details.content) {
                    //     console.log("Old content: ", oldDetails.content);
                    //     console.log(
                    //         "New content: ",
                    //         shareInput.details.content
                    //     );
                    // }
                    // if (oldDetails.title !== shareInput.details.title) {
                    //     console.log("Old title: ", oldDetails.title);
                    //     console.log("New title: ", shareInput.details.title);
                    // }
                    // if (
                    //     oldDetails.date_published !==
                    //     shareInput.details.date_published
                    // ) {
                    //     console.log(
                    //         "Old date_published: ",
                    //         oldDetails.date_published
                    //     );
                    //     console.log(
                    //         "New date_published: ",
                    //         shareInput.details.date_published
                    //     );
                    // }
                    // if (oldDetails.external_url !== tgUrl) {
                    //     console.log(
                    //         "Old external_url: ",
                    //         oldDetails.external_url
                    //     );
                    //     console.log("New external_url: ", tgUrl);
                    // }
                    // if (
                    //     shareNote.entity.metadata.url !== shareInput.entityUrl
                    // ) {
                    //     console.log(
                    //         "Old entity url: ",
                    //         shareNote.entity.metadata.url
                    //     );
                    //     console.log("New entity url: ", shareInput.entityUrl);
                    // }

                    console.log(index + " Requiring updates: " + tgUrl);
                }

                let needsUpdateEntity = false;
                let entityId = shareNote.entity.id;

                const shareEntity = shareNote.entity;
                // TODO: re-parse the entity?
                if (shareEntity.metadata.url !== shareInput.entityUrl) {
                    needsUpdateEntity = true;
                    const entity = await parseEntity(
                        shareInput.entityUrl,
                        "extractus"
                    );
                    if (dryRun) {
                        console.log(
                            "entity: ",
                            JSON.stringify(entity, null, 2)
                        );

                        console.log(
                            index +
                                " Dry run: createEntity($entity" +
                                "," +
                                shareNoteKey.characterId +
                                ") " +
                                tgUrl
                        );
                    } else {
                        const entityInfo = await createEntity(
                            entity,
                            shareNoteKey.characterId
                        );

                        entityId = entityInfo.id;
                        console.log("Entity updated: ", entityId);
                    }
                }

                if (dryRun) {
                    console.log(
                        index +
                            " Dry run: nomland.editNote(" +
                            shareNoteKey.characterId +
                            "-" +
                            shareNoteKey.noteId +
                            ") " +
                            tgUrl
                    );
                } else
                    await nomland.editNote(shareNoteKey, (n: NoteMetadata) => {
                        n.content = shareInput.details.content;
                        n.title = shareInput.details.title;
                        n.date_published = shareInput.details.date_published;
                        n.external_urls = [tgUrl];
                        if (needsUpdateEntity) {
                            const curationRecord = n.attributes?.find(
                                (attr) => attr.trait_type === "curation record"
                            );
                            if (curationRecord) {
                                curationRecord.value = Number(entityId);
                            }
                            const entityRecord = n.attributes?.find(
                                (attr) => attr.trait_type === "entity id"
                            );
                            if (entityRecord) {
                                entityRecord.value = entityId;
                            }
                        }
                        return n;
                    });
            } else {
                // create new share
                console.log(index + " Creating new share for " + tgUrl);
                if (dryRun) {
                    console.log(
                        "Dry run: nomland.createShare($shareInput) " + tgUrl
                    );
                } else {
                    const { noteKey } = await nomland.createShare(shareInput);
                    console.log(
                        "New share created: ",
                        noteKey.characterId + "-" + noteKey.noteId
                    );

                    shareIdsMap.set(
                        msgKey,
                        noteKey.characterId + "-" + noteKey.noteId
                    );
                    setKeyValue(
                        msgKey,
                        noteKey.characterId + "-" + noteKey.noteId,
                        "nunti-idMap"
                    );
                }
            }
        } catch (e) {
            // TODO
            console.log(e);
        }
    }

    const repliesMap = new Map<string, string>();

    if (dryRun) {
        console.log("Dry run: skip storing magazine orders and replies.");
        return;
    }

    for (const [index, item] of magazineContents.entries()) {
        const { magazineId, tgUrl, order, replies } = getProperties(item);
        const magazineOrdersMap = ordersRecord.get(magazineId);
        if (!magazineOrdersMap) {
            console.log("Cannot find magazine orders map for item: ", item.id);
            continue;
        }
        const { shareId: noteKeyStr } = getNoteIdFromTgUrl(
            tgUrl,
            contextGroupId,
            shareIdsMap
        );

        if (noteKeyStr) {
            magazineOrdersMap.set(noteKeyStr, order);
            repliesMap.set(noteKeyStr, replies || "");
        } else {
            console.warn("No noteKeyStr found for item: ", item.id);
        }
    }

    magazinesList.map(async (magazine) => {
        const magazineOrderMap = ordersRecord.get(magazine.uid);
        if (magazineOrderMap) {
            storeMagazineOrdersContentAPI(magazine.uid, magazineOrderMap);
            // sort keys of magazineOrderMap by value
            const sortedKeys = Array.from(magazineOrderMap.keys())
                .sort(
                    (a, b) =>
                        +magazineOrderMap.get(a)! - +magazineOrderMap.get(b)!
                )
                .map(
                    (key) =>
                        ({
                            characterId: key.split("-")[0],
                            noteId: key.split("-")[1],
                        } as NoteKey)
                );
            // TODO: pagination
            const notesData = await nomland.getShares(sortedKeys);
            notesData.notes.map((note: any) => {
                const { characterId, noteId } = note.key;
                const replies = repliesMap.get(characterId + "-" + noteId);
                if (replies) (note as any).replies = replies;
            });
            storeMagazineContentAPI(
                magazine.uid,
                JSON.stringify(notesData, null, 2)
            );
        }
    });
}

main();
