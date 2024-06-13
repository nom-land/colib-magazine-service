import {
    DatabaseObjectResponse,
    RichTextItemResponse,
} from "@notionhq/client/build/src/api-endpoints";
import { Client } from "@notionhq/client";
import "dotenv/config";
import { Magazine } from "../src/type";
import { ipfsUploadFile } from "crossbell/ipfs";

const notion = new Client({ auth: process.env.NOTION_API_KEY });

const magazineDBId = "7e15c621192d49519aa9291165c4f7ca";
const magazineContentDBId = "89e17384c64549a0b5d363beb5c6ed2e";

const TGLinkPropId = "rgd%7C";
export const TGLinkPropName = "TG Link（必填）";
export const ReviewTitleName = "分享内容标题（非必填）";
export const TGAccount = "TG account";
const ReviewContentName = "分享者推荐语（若未填写，内容从TG解析，可编辑更新）";
const ReviewUrlName = "分享内容URL（若未填写，内容从TG解析）";
const ReviewerIdName = "分享者CharacterID";
const ReviewContentPropId = "c%3DTq";
const SubTitleName = "副标题";
const SlugName = "自定义网页后缀（不可重复）";
const CuratorName = "策展人";
const PrefaceName = "策展前言/导语";
const BannerName = "banner";
const TitleName = "标题";
const OrderName = "排序";

export async function queryMagazinesDB(lastUpdate: string) {
    // TODO: use last update to avoid updating all the data
    const response = await notion.databases.query({
        database_id: magazineDBId,
        filter: {
            property: "Status",
            status: {
                equals: "Published",
            },
        },
    });
    if (response.has_more) {
        // TODO
    }
    const list = response.results as DatabaseObjectResponse[];

    const magazinesList = await Promise.all(
        list.map(async (item) => {
            const bannerUrl = (item.properties[BannerName] as any).files[0].file
                .url;
            const bannerIpfs = await getIpfsByUrl(bannerUrl);

            return {
                title: (item.properties[TitleName] as any).title[0].plain_text,
                subTitle: (item.properties[SubTitleName] as any).rich_text[0]
                    .plain_text,
                slug: getMagazineSlug(item),
                curator: (item.properties[CuratorName] as any).rich_text[0]
                    .plain_text,
                preface: (item.properties[PrefaceName] as any).rich_text
                    .map((t: any) => t.plain_text)
                    .join(""),
                banner: bannerIpfs.web2url,
                uid: item.id,
            } as Magazine;
        })
    );
    const magazineIds = list.map((item) => {
        return item.id;
    });
    return { magazineIds, magazinesList };
}

export async function queryMagazineContentDB(
    magazineIds: string[],
    magazineLastUpdates: Map<string, string>
) {
    const response = await notion.databases.query({
        database_id: magazineContentDBId,
        filter: {
            // 仅处理有 tg 链接的
            // 仅处理分享者的账户映射完整的数据（tg账号+characterID）
            and: [
                {
                    property: TGLinkPropId, // TG Link（必填）
                    url: {
                        is_not_empty: true,
                    },
                },
                {
                    property: "c%3DTq", // 分享者CharacterID
                    rollup: {
                        every: {
                            rich_text: {
                                is_not_empty: true,
                            },
                        },
                    },
                },
                {
                    property: ReviewContentPropId, // 分享者TG账号
                    rollup: {
                        every: {
                            rich_text: {
                                is_not_empty: true,
                            },
                        },
                    },
                },
                {
                    or: magazineIds.map((id) => ({
                        property: "Magazines",
                        relation: {
                            contains: id,
                        },
                    })),
                },
            ],
        },
    });
    let results = response.results as DatabaseObjectResponse[];

    results = results.filter((item) => {
        const magazineId = getMagazineId(item);
        const lastUpdate =
            magazineLastUpdates.get(magazineId) || new Date(0).toISOString();

        const lastEditedTime = item.last_edited_time;

        if (lastUpdate && lastEditedTime < lastUpdate) {
            return false;
        }

        return true;
    });

    return results;
}

function getMagazineId(item: DatabaseObjectResponse) {
    const magazineId = (item.properties["Magazines"] as any).relation[0].id;
    return magazineId;
}

function getMagazineSlug(item: DatabaseObjectResponse): string {
    return (item.properties[SlugName] as any).rich_text[0].plain_text;
}

export function getProperties(item: DatabaseObjectResponse) {
    const properties = item.properties;

    if (!("rich_text" in properties[ReviewTitleName])) {
        throw new Error(ReviewTitleName + " is not rich text");
    }
    if (!("url" in properties[TGLinkPropName])) {
        throw new Error(TGLinkPropName + " is not a URL");
    }
    if (!("rollup" in properties[TGAccount])) {
        throw new Error(TGAccount + " is not a rollup");
    }
    if (!("rich_text" in properties[ReviewContentName])) {
        throw new Error(ReviewContentName + " is not rich text");
    }
    if (!("url" in properties[ReviewUrlName])) {
        throw new Error(ReviewUrlName + " is not a URL");
    }
    if (!("rollup" in properties[ReviewerIdName])) {
        throw new Error(ReviewerIdName + " is not a rollup");
    }
    if (!("title" in properties[OrderName])) {
        throw new Error(OrderName + " is not title.");
    }

    const title = (
        properties[ReviewTitleName].rich_text[0] as RichTextItemResponse
    )?.plain_text as string | undefined;
    const tgUrl = properties[TGLinkPropName].url as any as string;

    // It cannot be undefined because we have checked it in the query
    const authorId = (properties[ReviewerIdName].rollup as any).array[0]
        .rich_text[0].plain_text;

    const authorTgAccount = (properties[TGAccount].rollup as any).array[0]
        .url as string;

    const notionReview = (
        properties[ReviewContentName].rich_text[0] as RichTextItemResponse
    )?.plain_text as string | undefined;

    const notionReviewUrl = properties[ReviewUrlName].url as any as string;

    const order =
        (properties[OrderName].title[0] as RichTextItemResponse)?.plain_text ||
        "0";

    const magazineId = getMagazineId(item);

    return {
        title,
        tgUrl,
        authorId,
        authorTgAccount,
        notionReview,
        notionReviewUrl,
        order,
        magazineId,
    };
}

async function getIpfsByUrl(url: string) {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
        throw new Error(`Response error: ${response.statusText}`);
    } else {
        const ipfsFile = await ipfsUploadFile(await response.blob());
        return ipfsFile;
    }
}
