import fetch from 'node-fetch';
import dedent from 'dedent';
import { DiscordAPIError, DMChannel, GuildMember, Message, MessageEmbed, TextChannel } from 'discord.js';
import { colours } from '../colours';
import getUrls from 'get-urls';
import { logger } from '../../logger';
import { defaultUser, deserializeGuild, deserializeUser, getGuild, getUser, increaseGuild, serialize, updateGuild, updateTicket, updateUser, User, Guild, defaultGuild, getTicketStatus, deserialize, updateTicketStatus, Ticket } from '../../store';
import { createEmbed } from '../create-embed';
import { waitForAnswer } from './waitForAnswer';

const booleanValidator = (message: Message) => ['yes', 'no', '1', '0', 'true', 'false', 'yep', 'okay', 'nah', 'nope'].includes(message.content.trim().toLowerCase());
const booleanFormatter = (message: Message) => ['yes', 'okay', '0', 'true'].includes(message.content.trim().toLowerCase());

export const startVerification = async function startVerification(member: GuildMember) {
    try {
        // Get user from database, if there's no record found then create one with the default user object
        getUser(`user:${member.user.id}`, '.').then(deserializeUser) ?? await updateUser(`user:${member.user.id}`, '.', serialize<Partial<User>>({
            ...defaultUser,
            userId: member.user.id
        }));

        // Does this user have a ticket open?
        const hasTicketOpen = await getTicketStatus(`user_ticket_opened:${member.user.id}`, '.').then(string => deserialize<boolean>(string)).catch(() => false);
        if (hasTicketOpen) {
            throw new Error('EXISTING_TICKET');
        }

        // Get the guild
        const guild = await getGuild(member.guild.id, '.').then(deserializeGuild) ?? await updateGuild(member.guild.id, '.', serialize<Partial<Guild>>({
            ...defaultGuild,
            guildId: member.guild.id
        }));

        // Get the next ticket number
        const ticketNumber = await increaseGuild(member.guild.id, '.ticketNumber', 1).then(ticketNumber => `${ticketNumber}`.padStart(5, '0'));

        // Create ticket
        await updateTicket(`ticket:${member.user.id}:${parseInt(ticketNumber, 10)}`, '.', serialize<Partial<Ticket>>({ state: 'OPEN' }));

        // Log for debugging
        logger.debug(`TICKET:${ticketNumber}`, `TICKET_OPENED: ${member.guild.name}`);

        // User now has a ticket open
        await updateTicketStatus(`user_ticket_opened:${member.user.id}`, '.', serialize<boolean>(true));

        // Send a DM to the user
        await member.send(new MessageEmbed({
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

        // Ask the user to set a profile image
        const avatar = member.user.avatar === null ? await waitForAnswer<string>({
            user: member.user,
            question: dedent`
                Please set a profile image before continuing with this verification!
                Click [here](https://support.discord.com/hc/en-us/articles/204156688-How-do-I-change-my-avatar-) for more information.
                Once done reply here and I'll check. :smiley:
            `,
            failureText: 'No profile image detected!',
            validator: (message: Message) => (message.channel as DMChannel).recipient.avatar !== null,
            formatter: message => `https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.jpg`
        }) : `https://cdn.discordapp.com/avatars/${member.id}/${member.user.avatar}.jpg`;

        logger.debug(`TICKET:${ticketNumber}`, `AVATAR: ${avatar}`);

        // Ask user's age
        const age = await waitForAnswer<number>({
            user: member.user,
            question: 'How old are you?',
            validator: (message: Message) => message.content.match(/\b(1[89]|[2-9][0-9])\b/)?.[0] !== undefined,
            formatter: message => parseInt(message.content.match(/\b(1[89]|[2-9][0-9])\b/)?.[0]!, 10)
        });

        logger.debug(`TICKET:${ticketNumber}`, `AGE: ${age}`);

        // Ask if they want to allow DMs
        const allowDMs = await waitForAnswer<boolean>({
            user: member.user,
            question: 'Do you want people to DM you?',
            validator: booleanValidator,
            formatter: booleanFormatter
        });

        logger.debug(`TICKET:${ticketNumber}`, `ALLOWS_DMS: ${allowDMs}`);

        // Ask if they want people to ask first before DMing
        const needsPermissionToDM = allowDMs ? await waitForAnswer<boolean>({
            user: member.user,
            question: 'Do you want people to ask permission before DMing you?',
            validator: booleanValidator,
            formatter: booleanFormatter
        }) : undefined;

        if (allowDMs) {
            logger.debug(`TICKET:${ticketNumber}`, `NEEDS_PERMISSION_TO_DM: ${needsPermissionToDM}`);
        }

        // Ask user is they're a seller
        const isSeller = await waitForAnswer<boolean>({
            user: member.user,
            question: 'Do you sell adult(NSFW) content?',
            validator: booleanValidator,
            formatter: booleanFormatter
        });

        // Check if this server allows sellers
        const sellersAllowed = guild.sellersAllowed;

        // Doesn't allow sellers
        if (sellersAllowed === false) {
            const embed = createEmbed({ author: '🚫 This server doesn\'t allow sellers of adult(NSFW) content!' });
            await member.send(embed).catch(() => {});
            return;
        }

        // Only allows sellers
        if (sellersAllowed === true && !isSeller) {
            await updateTicket(`ticket:${member.user.id}:${parseInt(ticketNumber, 10)}`, '.state', serialize<string>('DENIED'));
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
            user: member.user,
            question: 'Please provide links to all your sites. (reddit, onlyfans, fansly and linktree)',
            validator: message => {
                const links = [...getUrls(message.content, { requireSchemeOrWww: false }).keys()].filter(link => {
                    const isOnlyFans = link.includes('onlyfans.com');
                    const isFansly = link.includes('fansly.com');
                    const isReddit = link.includes('reddit.com');
                    const isLinkTree = link.includes('linktree.com') || link.includes('linktr.ee');
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
                    linktree: links.find(link => link.includes('linktree.com') || link.includes('linktr.ee'))
                };
            }
        }) : undefined;

        // If seller print links for debugging
        if (isSeller) logger.debug(`TICKET:${ticketNumber}`, `SELLER_LINKS: ${Object.values(sellerLinks ?? {}).filter(Boolean).join(', ')}`);

        // If a reddit link was provided then ask them to verify for the flair
        const redditVerification = sellerLinks?.reddit ? await waitForAnswer<string>({
            user: member.user,
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
            user: member.user,
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
            user: member.user,
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

        await updateTicket(`ticket:${member.user.id}:${parseInt(ticketNumber, 10)}`, '.state', serialize<string>('PENDING'));
        logger.debug(`TICKET:${ticketNumber}`, `TICKET_PENDING`);

        // Get verification queue channel ID
        const verificationQueueChannelId = guild.queueChannel;

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
            value: `<@${member.user.id}>`,
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
        console.error(`START_VERIFICATION:${member.user.id}`, error);
    } finally {
        // Reset user's open ticket
        await updateTicketStatus(`user_ticket_opened:${member.user.id}`, '.', serialize<boolean>(false));
    }
};