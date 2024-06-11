import { parse } from "node-html-parser";

async function parseTgLink(url: string) {
    if (url.endsWith("/")) url = url.slice(0, -1);
    url = url.replace(/\/\d+/, "");
    url = url + "?embed=1&mode=tme";

    const tgHtmlContent = await (await fetch(url)).text();
    const root = parse(tgHtmlContent);
    const author = root.querySelector(".tgme_widget_message_author_name");
    const authorUrl = author?.attributes.href;

    const textContent = root.querySelector(
        ".tgme_widget_message_text.js-message_text"
    )?.textContent;

    const publishDateHtml = root.querySelector(
        ".tgme_widget_message_date > time"
    );
    const publishDate = publishDateHtml?.attributes.datetime
        ? new Date(publishDateHtml?.attributes.datetime)
        : new Date();

    return {
        authorUrl,
        textContent,
        publishDate,
    };
}

const urlRegex = /(http|https):\/\/[^\s]+/g;
const tagRegex = /#[^\s]+/g;

export function getFirstUrl(str: string) {
    const urls = str.match(urlRegex);
    return urls ? urls[0] : null;
}
export function cleanContent(str: string, botName: string) {
    return str
        .replaceAll(urlRegex, "")
        .replaceAll("@" + botName, "")
        .replaceAll(tagRegex, "")
        .trim();
}
export async function getRawContent(url: string) {
    const { authorUrl, textContent, publishDate } = await parseTgLink(url);
    if (!authorUrl || !textContent) {
        return {
            authorUrl,
            publishDate,
            content: null,
            entityUrl: null,
        };
    }
    const entityUrl = getFirstUrl(textContent);
    const content = cleanContent(textContent, "nuntibot");
    return {
        authorUrl,
        publishDate,
        content,
        entityUrl,
    };
}

export function getMsgKeyFromTgUrl(url: string, contextGroupId: string) {
    if (url.endsWith("/")) url = url.slice(0, -1);
    const noteId = url.split("/").pop();
    return contextGroupId + "-" + noteId;
}
