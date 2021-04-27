import Nightmare from "nightmare";
import parseHumanDate from "parse-human-date";
import {
    ago as timeAgo
} from "time-ago";
import humanFormat from "human-format";
import {
    logger
} from "../logger";

export const getOnlyFansStats = async function(name: string) {
    const nightmare = new Nightmare();

    try {
        logger.debug(`GET_ONLYFANS_STATS:${name}`, "FETCHING");

        // Goto the page
        await nightmare.goto(`https://onlyfans.com/${name}`).then(value => value);

        logger.debug(`GET_ONLYFANS_STATS:${name}`, "FETCHED_PAGE");

        // Wait till the page is loaded
        await nightmare.wait(function() {
            return (
                document.querySelector(".b-profile__sections__count") ||
                document.querySelector(".b-404__subtitle")
            );
        });

        logger.debug(`GET_ONLYFANS_STATS:${name}`, "PAGE_LOADED");

        // Is a valid profile
        const isValid = await nightmare.evaluate(
            () => !document.querySelector(".b-404__subtitle")
        );

        // Bail if the page loads a 404
        if (!isValid) {
            throw new Error("Invalid profile");
        }

        // Get profile items
        const {
            profileItems,
            ...result
        } = ((await nightmare.evaluate(() => {
            const lastOnline = (document.querySelector(
                ".b-profile__user__status__text"
            )?.children[0] as HTMLElement)?.title.toLowerCase();
            const profileItems = [
                ...document.querySelectorAll(".b-profile__sections__count"),
            ].map((element) => element.innerHTML, 10);
            return {
                profileItems,
                lastOnline,
            };
        })) as unknown) as {
            profileItems: string[];
            lastOnline: string;
        };

        // Get the last time the account was online
        const lastOnline = result.lastOnline ?
            timeAgo(parseHumanDate(result.lastOnline)) :
            "";

        // Images | Videos | Likes
        if (profileItems.length === 3) {
            const images = humanFormat.parse(profileItems[0].toLowerCase());
            const videos = humanFormat.parse(profileItems[1].toLowerCase());
            const likes = humanFormat.parse(profileItems[2].toLowerCase());
            const averageLikesPerPost = Number(
                (likes / (images + videos)).toFixed(2)
            );
            return {
                name,
                posts: images + videos,
                images,
                videos,
                likes,
                lastOnline,
                averageLikesPerPost,
            };
        }

        // Posts | Likes
        if (profileItems.length === 2) {
            const posts = humanFormat.parse(profileItems[0].toLowerCase());
            const likes = humanFormat.parse(profileItems[1].toLowerCase());
            const averageLikesPerPost = Number((likes / posts).toFixed(2));
            return {
                name,
                posts,
                images: undefined,
                videos: undefined,
                likes,
                lastOnline,
                averageLikesPerPost,
            };
        }

        throw new Error("Invalid profile");
    } catch (error) {
        logger.error(`GET_ONLYFANS_STATS:${name}`, error);
    } finally {
        logger.debug(`GET_ONLYFANS_STATS:${name}`, "SESSION_ENDED");

        // Close session
        await nightmare?.end();

        logger.debug(`GET_ONLYFANS_STATS:${name}`, "FINISHED");
    }
};
