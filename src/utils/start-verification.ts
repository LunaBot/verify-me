import fetch from 'node-fetch';
import dedent from 'dedent';
import { DiscordAPIError, DMChannel, GuildMember, GuildMemberManager, Message, MessageEmbed, TextChannel, User } from 'discord.js';
import { colours } from 'utils';
import getUrls from 'get-urls';
import { store } from '../store';
import { logger } from '../logger';
import { createEmbed } from './create-embed';

export const waitForAnswer = async <T = unknown>({ user, question, attempt, validator, formatter, failureText }: {
    user: User,
    question: string,
    attempt?: number,
    validator: (message: Message) => Promise<boolean> | boolean,
    formatter: (message: Message) => T,
    failureText?: string
}): Promise<T | undefined> => {
    // Only ask on the first attempt
    if (!attempt || attempt === 0) {
        // Ask user question
        await user.send(createEmbed({ text: question }));
    }

    store.members.set(user.id, true, 'waiting-reply');

    try {
        // Wait for answer
        const answer = await user.dmChannel!.awaitMessages(message => message.author.id == user.id, {
            // Only collect a single message
            max: 1,
            // 10 mins
            time: 10 * 60 * 1000,
            // Throw error on timeout
            errors: ['time']
        }).then(response => response.first());

        // Timed out
        if (!answer) {
            throw new Error('TIMED_OUT');
        }

        // Verification cancelled
        if (answer.content.includes('!cancel')) {
            throw new Error('CANCELLED');
        }

        // Validate answer
        const isValid = await Promise.resolve(validator(answer)).catch(error => {
            const validatorError = new Error('VALIDATOR_ERROR');
            // @ts-expect-error
            validatorError.error = error;
            throw validatorError;
        });

        // Handle validation
        if (isValid) {
            return formatter(answer);
        }

        // Ask them to try again
        const tryAgainEmbed = createEmbed({ author: failureText ?? 'Invalid response, try again' });
        await user.send(tryAgainEmbed);

        // Wait for the answer again
        return waitForAnswer({ user, question, attempt: 1, validator, formatter });
    } catch (error) {
        throw error;
    } finally {
        store.members.set(user.id, false, 'waiting-reply');
    }
}

const booleanValidator = (message: Message) => ['yes', 'no', '1', '0', 'true', 'false', 'yep', 'okay', 'nah', 'nope'].includes(message.content.trim().toLowerCase());
const booleanFormatter = (message: Message) => ['yes', 'okay', '0', 'true'].includes(message.content.trim().toLowerCase());

export const startVerification = async function startVerification(member: GuildMember) {
    try {
        // Get member's user
        const user = member.user;

        // Get the user's ticket state
        const ticketState = store.members.get(`${member.guild.id}_${member.id}`, 'state');

        // Bail if they have an existing ticket open
        if (ticketState === 'PENDING') {
            throw new Error('EXISTING_TICKET');
        }

        // Get the next ticket number
        const ticketNumber: string = `${store.guilds.inc(member.guild.id, 'ticketNumber').get(member.guild.id, 'ticketNumber')}`.padStart(5, '0');

        // Send a DM to the user
        const message = await member.send(new MessageEmbed({
            author: {
                name: `✏️ Verification started for ${member.guild.name}!`
            },
            color: colours.AQUA,
            description: dedent`
                This server is **strictly 18+** If you're underage please leave immediately!

                Your ticket number is ${ticketNumber}

                Type \`!cancel\` to exit.
            `
        }));

        // Set ticket as open
        store.members.set(message.author.id, 'OPEN', 'state');
        logger.debug(`TICKET:${ticketNumber}`, `TICKET_OPENED: ${member.guild.name}`);

        // Ask the user to set a profile image
        const avatar = member.user.avatar === null ? await waitForAnswer<string>({
            user,
            question: dedent`
                Please set a profile image before continuing with this verification!
                Click [here](https://support.discord.com/hc/en-us/articles/204156688-How-do-I-change-my-avatar-) for more information.
                Once done reply here and I'll check. :smiley:
            `,
            failureText: 'No profile image detected!',
            validator: (message: Message) => (message.channel as DMChannel).recipient.avatar !== null,
            formatter: message => `https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.jpg`
        }) : `https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.jpg`;

        logger.debug(`TICKET:${ticketNumber}`, `AVATAR: ${avatar}`);

        // Ask user's age
        const age = await waitForAnswer<number>({
            user,
            question: 'How old are you?',
            validator: (message: Message) => message.content.match(/\b(1[89]|[2-9][0-9])\b/)?.[0] !== undefined,
            formatter: message => parseInt(message.content.match(/\b(1[89]|[2-9][0-9])\b/)?.[0]!, 10)
        });

        logger.debug(`TICKET:${ticketNumber}`, `AGE: ${age}`);

        // Ask if they want to allow DMs
        const allowDMs = await waitForAnswer<boolean>({
            user,
            question: 'Do you want people to DM you?',
            validator: booleanValidator,
            formatter: booleanFormatter
        });

        logger.debug(`TICKET:${ticketNumber}`, `ALLOWS_DMS: ${allowDMs}`);

        // Ask if they want people to ask first before DMing
        const needsPermissionToDM = allowDMs ? await waitForAnswer<boolean>({
            user,
            question: 'Do you want people to ask permission before DMing you?',
            validator: booleanValidator,
            formatter: booleanFormatter
        }) : undefined;

        if (allowDMs) {
            logger.debug(`TICKET:${ticketNumber}`, `NEEDS_PERMISSION_TO_DM: ${needsPermissionToDM}`);
        }

        // Ask user is they're a seller
        const isSeller = await waitForAnswer<boolean>({
            user,
            question: 'Do you sell adult(NSFW) content?',
            validator: booleanValidator,
            formatter: booleanFormatter
        });

        // Check if this server allows sellers
        const sellersAllowed = store.guilds.get(member.guild.id, 'sellersAllowed');

        // Doesn't allow sellers
        if (sellersAllowed === false) {
            const embed = createEmbed({ author: '🚫 This server doesn\'t allow sellers of adult(NSFW) content!' });
            await member.send(embed).catch(() => {});
            return;
        }

        // Only allows sellers
        if (sellersAllowed === true && !isSeller) {
            store.members.set(`${member.guild?.id}_${member?.id}`, 'DENIED', 'state');
            const embed = createEmbed({ author: '🚫 This server only allows sellers of adult(NSFW) content!' });
            await member.send(embed).catch(() => {});
            return;
        }

        // Check if server has paused allowing sellers right now
        if (sellersAllowed === null) {
            const embed = createEmbed({ author: '🚫 This server currently doesn\'t allow sellers of adult(NSFW) content!', text: 'Please come back another time.' });
            await member.send(embed).catch(() => {});
            return;
        }

        logger.debug(`TICKET:${ticketNumber}`, `IS_SELLER: ${isSeller}`);

        // Ask sellers to provide links to their sites
        const sellerLinks = isSeller ? await waitForAnswer<{
            onlyfans?: string;
            fansly?: string;
            reddit?: string;
            linktree?: string;
        }>({
            user,
            question: 'Please provide links to all your sites. (reddit, onlyfans, fansly and linktree)',
            validator: message => {
                const links = [...getUrls(message.content, { requireSchemeOrWww: false }).keys()].filter(link => {
                    const isOnlyFans = link.includes('onlyfans.com');
                    const isFansly = link.includes('fansly.com');
                    const isReddit = link.includes('reddit.com');
                    const isLinkTree = link.includes('linktree.com');
                    return isOnlyFans || isFansly || isReddit || isLinkTree;
                });
                return links.length >= 1;
            },
            formatter: message => {
                const links = [...getUrls(message.content, { requireSchemeOrWww: false }).keys()];
                return {
                    onlyfans: links.find(link => link.includes('onlyfans.com')),
                    fansly: links.find(link => link.includes('fansly.com')),
                    reddit: links.find(link => link.includes('reddit.com')),
                    linktree: links.find(link => link.includes('linktree.com')),
                };
            }
        }) : undefined;

        // If seller print links for debugging
        if (isSeller) logger.debug(`TICKET:${ticketNumber}`, `SELLER_LINKS: ${Object.values(sellerLinks ?? {}).filter(Boolean).join(', ')}`);

        // If a reddit link was provided then ask them to verify for the flair
        const redditVerification = sellerLinks?.reddit ? await waitForAnswer<string>({
            user,
            question: `Please post a photo to /r/horny with the title "[OC] Verifying for ${member.guild.name}". Make sure to set the flair to "verification". After you're done reply here with the link.`,
            validator: async message => {
                const link = message.content.match(/(https:\/\/www.reddit.com\/r\/horny\/comments\/[a-z0-9]+)/g)?.[0];
                // Bail if the link is missing
                if (!link) return false;

                // Check if the link's author matches the username they provided
                const response = await fetch(`${link}.json`).then(response => response.json());
                const author: string | undefined = response?.[0]?.data?.children?.[0]?.data?.author?.toLowerCase();
                const subreddit: string | undefined = response?.[0]?.data?.children?.[0]?.data?.subreddit;

                // Ensure this isn't posted on a random sub
                if (subreddit !== 'horny') {
                    throw new Error(`Please make the post in /r/horny, not /r/${subreddit}`);
                }

                // Ensure this isn't posted on their user profile
                if (subreddit === `u_${author}`) {
                    throw new Error(`Please make the post in /r/horny, not /u/${author}`);
                }

                return true;
            },
            formatter: (message: Message) => message.content.match(/(https:\/\/www.reddit.com\/r\/horny\/comments\/[a-z0-9]+)/g)![0]
        }) : undefined;

        // If we got a reddit verification log it for debugging
        if (redditVerification) {
            logger.debug(`TICKET:${ticketNumber}`, `REDDIT_VERIFICATION: ${redditVerification}`);
        }

        // Ask for a photo of them
        const photo = await waitForAnswer<string>({
            user,
            question: dedent`
                Please send a photo of yourself holding a piece of paper with "I'm joining ${member.guild.name}", today's date and your discord username.

                Note: This image will seen **ONLY** by mods and deleted once your verification has been approved/denied.
            `,
            validator: (message: Message) => message.attachments.find(attachment => {;
                // Bail if there's no attachment
                if (attachment.url === '') return false;

                // Get attachment's file extension
                const fileExtension = attachment.url.split('.').pop() ?? 'unknown';

                // Only allow known file extensions
                if (!['jpg', 'jpeg', 'png'].includes(fileExtension.toLowerCase())) return false;

                // Image sent, woo!
                return true;
            }) !== undefined,
            formatter: (message: Message) => message.attachments.find(attachment => attachment.url !== '')!.url
        }) as string;

        // Log the photo for debugging
        logger.debug(`TICKET:${ticketNumber}`, `PHOTO: ${photo}`);

        // The verification embed
        // This will be shown the the member before being enriched for mods
        const verification = new MessageEmbed({
            author: {
                name: member.displayName,
                iconURL: member.user.displayAvatarURL()
            },
            image: {
                url: photo
            },
            fields: [{
                name: 'Age',
                value: age,
                inline: true
            }, {
                name: 'DM preferences',
                value: allowDMs ? (needsPermissionToDM ? 'Ask before DMing' : 'DMs are open') : 'DO NOT DM',
                inline: true
            }, {
                name: 'Seller?',
                value: isSeller ? '<:checkmark:835897461276016691>' : '<:decline:835897487289745408>',
                inline: true
            }, ...(isSeller ? [{
                name: 'Links',
                value: [
                    sellerLinks?.onlyfans ? `Onlyfans: ${sellerLinks?.onlyfans}` : '',
                    sellerLinks?.fansly ? `Fansly: ${sellerLinks?.fansly}` : '',
                    redditVerification ? `Reddit: ${redditVerification}`: '',
                    sellerLinks?.linktree ? `Linktree: ${sellerLinks?.linktree}`: ''
                ].filter(text => text !== '').join('\n')
            }] : [])],
            footer: {
                text: `Ticket #${ticketNumber}`
            }
        });

        // Send verification preview
        await member.send(verification);

        // Ask if they are sure they want to submit it
        const confirmation = await waitForAnswer<boolean>({
            user,
            question: 'Are you sure you want to submit this verification?',
            validator: booleanValidator,
            formatter: booleanFormatter
        });

        logger.debug(`TICKET:${ticketNumber}`, `CONFIRMATION: ${confirmation}`);

        // User cancelled
        if (!confirmation) {
            throw new Error('CANCELLED');
        }

        // Say it's being submitted to the queue
        const submissionPendingMessage = await member.send(new MessageEmbed({
            color: colours.GREEN,
            description: `<a:loading:836512100129177622> Submitting verification to ${member.guild.name}!`,
            footer: {
                text: `Ticket #${ticketNumber}`
            }
        }));

        store.members.set(`${member.guild.id}_${member.id}`, 'PENDING', 'state');
        logger.debug(`TICKET:${ticketNumber}`, `TICKET_PENDING`);

        // Get verification queue channel ID
        const verificationQueueChannelId = store.guilds.get(member.guild.id, 'queueChannel');

        // No verification queue channel set
        if (!verificationQueueChannelId) {
            const error = new Error('NO_CHANNEL_SET');
            // @ts-expect-error
            error.channel = 'verification-queue';
            throw error;
        }

        // Get verification queue channel
        const verificationQueueChannel = member.guild.channels.cache.get(verificationQueueChannelId) as TextChannel;

        // Missing verification queue channel
        if (!verificationQueueChannel) {
            const error = new Error('CHANNEL_MISSING');
            // @ts-expect-error
            error.channel = 'verification-queue';
            throw error;
        }

        // Enrich verification post for mods
        verification.fields.unshift({
            name: 'Tag',
            value: `<@${member.id}>`,
            inline: false
        });
        verification.setThumbnail(member.user.displayAvatarURL());

        // Post verification in queue channel for mods
        const queuePost = await verificationQueueChannel.send(verification);

        // Add reactions for mods
        await queuePost.react('👍');
        await queuePost.react('🔁');
        await queuePost.react('👎');

        // Ticket submitted successfully
        await submissionPendingMessage.edit(new MessageEmbed({
            color: colours.GREEN,
            author: {
                name: `🚀 Verification submitted to ${member.guild.name}!`
            },
            footer: {
                text: `Ticket #${ticketNumber}`
            },
            description: 'Once your verification has been accepted you\'ll get a message here from me.'
        }));
    } catch (error) {
        if (error.message === 'TIMED_OUT') {
            const embed = createEmbed({ author: '⌛ Verification timed out!' });
            await member.send(embed).catch(() => {});
            return;
        }

        if (error.message === 'CANCELLED') {
            const embed = createEmbed({ author: '🚫 Verification cancelled!' });
            await member.send(embed).catch(() => {});
            return;
        }

        if (error.message === 'EXISTING_TICKET') {
            const embed = createEmbed({ author: '🚫 You already have a ticket open!' });
            await member.send(embed).catch(() => {});
            return;
        }

        if (error.message === 'VALIDATOR_ERROR') {
            const embed = createEmbed({ author: `🚫 ${error.error.message}` });
            await member.send(embed).catch(() => {});
            return;
        }

        if (error.message === 'CHANNEL_MISSING') {
            const embed = createEmbed({ author: `🚫 Please contact the admins/mods for ${member.guild.name} as the "${error.channel}" channel is missing.` });
            await member.send(embed).catch(() => {});
            return;
        }

        if (error.message === 'NO_CHANNEL_SET') {
            const embed = createEmbed({ author: `🚫 Please contact the admins/mods for ${member.guild.name} as no "${error.channel}" channel has been set in the config.` });
            await member.send(embed).catch(() => {});
            return;
        }
        
        if (error instanceof DiscordAPIError) {
            if (error.message.includes('missing access')) {
                const channelId = error.path.split('/')[2];
                const channel = member.guild.channels.cache.get(channelId);
                const embed = createEmbed({
                    author: `🚫 Please contact the admins/mods for ${member.guild.name} as I don't have permission to post in ${channel?.name}.`
                });
                await member.send(embed).catch(() => {});
                return;
            }

            const embed = createEmbed({ author: `🚫 Please contact the admins/mods for ${member.guild.name} as I've hit a Discord API error.` });
            await member.send(embed).catch(() => {});
        }

        // Log error
        console.error(`START_VERIFICATION:${member.id}`, error);
    }
};