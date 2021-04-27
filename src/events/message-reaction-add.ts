import Nightmare from 'nightmare';
import parseHumanDate from 'parse-human-date';
import { ago as timeAgo } from 'time-ago';
import humanFormat from 'human-format';
import dedent from 'dedent';
import fetch from 'node-fetch';
import { colours, isTextBasedChannel, sendAuditLogMessage, sleep, waitForQuestions } from '../utils';
import { DMChannel, GuildMember, Message, MessageEmbed, MessageReaction, Role, TextChannel, User } from 'discord.js';
import { logger } from '../logger';
import { store, guildsDefaultOptions } from '../store';

const getOnlyFansStats = async function(name: string) {
  const nightmare = new Nightmare();

  logger.debug(`Collecting onlyfans stats for "${name}"`);

  // Goto the page
  await nightmare.goto(`https://onlyfans.com/${name}`);

  // Wait till the page is loaded
  await nightmare.wait('.b-profile__sections__count');

  // Get profile items
  const { profileItems, ...result } = await nightmare.evaluate(() => {
    const lastOnline = (document.querySelector('.b-profile__user__status__text')?.children[0] as HTMLElement)?.title.toLowerCase();
    const profileItems = [...document.querySelectorAll('.b-profile__sections__count')].map(element => element.innerHTML, 10);
    return {
      profileItems,
      lastOnline
    }
  }) as unknown as {
    profileItems: string[];
    lastOnline: string;
  };

  logger.debug(`Finished collecting onlyfans stats for "${name}"`);

  // Close session
  await nightmare.end();

  // Get the last time the account was online
  const lastOnline = result.lastOnline ? timeAgo(parseHumanDate(result.lastOnline)) : '';

  // Images | Videos | Likes
  if (profileItems.length === 3) {
    const images = humanFormat.parse(profileItems[0].toLowerCase());
    const videos = humanFormat.parse(profileItems[1].toLowerCase());
    const likes = humanFormat.parse(profileItems[2].toLowerCase());
    const averageLikesPerPost = Number((likes / (images + videos)).toFixed(2));
    return {
      name,
      posts: images + videos,
      images,
      videos,
      likes,
      lastOnline,
      averageLikesPerPost
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
      averageLikesPerPost
    };
  }

  throw new Error('Invalid profile');
};

// https://github.com/microsoft/TypeScript/issues/20812#issuecomment-493622598
const isRole = (role?: Role): role is Role => role !== undefined;

const reactions = {
    // Approve ticket in queue
    async '👍'(reaction: MessageReaction, member: GuildMember) {
        // Get role to add to member
        const roleIds = store.guilds.get(reaction.message.guild?.id!, 'roles') as string[];
        const roles = roleIds
            .map(roleId => reaction.message.guild?.roles.cache.get(roleId))
            .filter(isRole);

        // Make sure the role exists
        if (roles.length === 0) return;

        // Try to add all the roles to the member
        await Promise.all(roles.map(async role => {
            await member.roles.add(role);
        }));

        // Get ticket number
        const ticketNumber = reaction.message.embeds[0].fields.find(field => field.name === 'Ticket number')?.value;

        // Is the member a seller?
        const seller = reaction.message.embeds[0].fields.find(field => field.name === 'Seller?')?.value.includes('checkmark');

        // Give the seller roles
        if (seller) {
            // Get discord roles
            const sellerRole = member.guild.roles.cache.find(role => role.id === '776567998466228254');

            // Add server seller role
            if (sellerRole) {
                await member.roles.add(sellerRole);
            }

            // Did they provided a reddit verification post link?
            const reddit = reaction.message.embeds[0].fields.find(field => field.name === 'Reddit')?.value;
            if (reddit !== 'N/A' && reddit?.startsWith('http')) {
                const redditSellerRole = member.guild.roles.cache.find(role => role.id === '783282529737900034');

                // Add reddit seller role
                if (redditSellerRole) {
                    await member.roles.add(redditSellerRole);
                }

                // @TODO: Give the seller role on reddit
            }
        }

        // Mark verified
        store.members.set(`${reaction.message.guild?.id}_${member?.id}`, 'verified', 'state');

        // Log ticket approved
        logger.debug(`TICKET:${`${ticketNumber}`.padStart(5, '0')}`, 'APPROVED');

        await store.guilds.ensure('announcementChannel', guildsDefaultOptions.announcementChannel);

        // Mention the user in the chat channel
        const announcementChannelId = await store.guilds.get(reaction.message.guild!.id, 'announcementChannel');
        const announcementChannel = reaction.message.guild!.channels.cache.get(announcementChannelId);

        // Post announcement that the member was approved
        if (isTextBasedChannel(announcementChannel)) {
            // Send message
            await announcementChannel.send(`<@&836464776401649685> | <@${member?.id}>`, {
                embed: new MessageEmbed({
                    color: colours.GREEN,
                    description: dedent`
                        **__Welcome to ${reaction.message.guild?.name}__**

                        ➜ Make sure to read the <#805318568706441228>
                        ➜ Get some roles from our <#781083640025186304>
                        ➜ Try some of our <#831508428542967828> and win some :coin:
                        ➜ If you enjoy the server please remember to <#818703159199399946>

                        **We now have ${reaction.message.guild?.memberCount} members!**
                    `
                })
            });
        }

        try {
            // Let the member know
            await member?.send(new MessageEmbed({
                color: colours.GREEN,
                author: {
                    name: '🚀 Verification approved!'
                },
                fields: [{
                    name: 'Guild',
                    value: reaction.message.guild!.name
                }, {
                    name: 'Ticket #',
                    value: `${ticketNumber}`.padStart(5, '0')
                }],
                description: 'Your verification was approved!'
            }));
        } catch {
            // Member likely either left or was kicked before this
            logger.debug(`TICKET:${ticketNumber}`.padStart(5, '0'), 'MEMBER_LEFT');
        }
    },
    // Ask member to redo ticket in queue
    async '🔁'(reaction: MessageReaction, member: GuildMember) {
        // Get ticket number
        const ticketNumber = reaction.message.embeds[0].fields.find(field => field.name === 'Ticket number')?.value;

        // Reset member's state
        store.members.set(`${reaction.message.guild?.id}_${member?.id}`, 'closed', 'state');

        // Log ticket redo
        logger.debug(`TICKET:${ticketNumber}`.padStart(5, '0'), 'REDO');

        try {
            // Let the member know
            await member?.send(new MessageEmbed({
                color: colours.RED,
                author: {
                    name: '🚀 Verification denied!'
                },
                fields: [{
                    name: 'Guild',
                    value: reaction.message.guild!.name
                }, {
                    name: 'Ticket #',
                    value: `${ticketNumber}`.padStart(5, '0')
                }],
                description: 'Don\'t worry though as you\'re able to redo it, just visit the server where you applied and retry.'
            }));
        } catch {
            // Member likely either left or was kicked before this
            logger.debug(`TICKET:${ticketNumber}`.padStart(5, '0'), 'MEMBER_LEFT');
        }
    },
    // Missing image
    async '🖼️'(reaction: MessageReaction, member: GuildMember) {
        // Get ticket number
        const ticketNumber = reaction.message.embeds[0].fields.find(field => field.name === 'Ticket number')?.value;

        // Reset member's state
        store.members.set(`${reaction.message.guild?.id}_${member?.id}`, 'closed', 'state');

        // Log ticket missing image
        logger.debug(`TICKET:${ticketNumber}`.padStart(5, '0'), 'MISSING_IMAGE');

        try {
            // Let the member know
            await member?.send(new MessageEmbed({
                color: colours.RED,
                author: {
                    name: '🚀 Verification failed!'
                },
                fields: [{
                    name: 'Guild',
                    value: reaction.message.guild!.name
                }, {
                    name: 'Ticket #',
                    value: `${ticketNumber}`.padStart(5, '0')
                }],
                description: 'It seems the image you tried sending broke on our end. Please visit the server where you applied and retry with a different one.'
            }));
        } catch {
            // Member likely either left or was kicked before this
            logger.debug(`TICKET:${ticketNumber}`.padStart(5, '0'), 'MEMBER_LEFT');
        }
    },
    // Deny ticket in queue
    async '👎'(reaction: MessageReaction, member: GuildMember) {
        // Get ticket number
        const ticketNumber = reaction.message.embeds[0].fields.find(field => field.name === 'Ticket number')?.value;

        // Ensure the user can't apply again
        store.members.set(`${reaction.message.guild?.id}_${member?.id}`, 'denied', 'state');

        // Log ticket denied
        logger.debug(`TICKET:${ticketNumber}`.padStart(5, '0'), 'DENIED');

        try {
            // Let the member know
            await member?.send(new MessageEmbed({
                author: {
                    name: '🚀 Verification denied!'
                },
                fields: [{
                    name: 'Guild',
                    value: reaction.message.guild!.name
                }, {
                    name: 'Ticket #',
                    value: `${ticketNumber}`.padStart(5, '0')
                }],
                description: 'Your verification was denied!'
            }));

            // Wait 1s
            await sleep(1000);

            // Kick the member
            await member?.kick();
        } catch {
            // Member likely either left or was kicked before this
            logger.debug(`TICKET:${ticketNumber}`.padStart(5, '0'), 'MEMBER_LEFT');
        }
    }
};

export const onMessageReactionAdd = async function onMessageReactionAdd(reaction: MessageReaction, user: User) {
    try {
        // Get whole reaction
        if (reaction.partial) await reaction.fetch();

        // Get whole user
        if (user.partial) await user.fetch();

        // Only process messages we care about
        if (!store.watchedMessages.has(reaction.message.id)) return;

        logger.debug(`REACTION_ADD:${reaction.message.id}`, `${user.username}#${user.discriminator}`);

        // If we're in the queue channel then make sure it's an admin, if so then they're likely allowing/denying a verification
        // @ts-expect-error
        if (reaction.message.channel.id === store.guilds.get(reaction.message.guild.id!, 'queueChannel')) {
            // Bail if it's not an admin
            if (!reaction.message.guild?.members.cache.get(user.id)?.roles.cache.find(role => role.id === store.guilds.get(reaction.message.guild?.id!, 'adminRole'))) return;
            // Attempt to get the member ID
            const memberId = reaction.message.embeds[0].fields.find(field => field.name === 'ID')?.value;

            // Make sure this is one of our embeds
            if (!memberId) return;

            // Get member
            const member = reaction.message.guild.members.cache.get(memberId!) ?? await reaction.message.guild.members.fetch(memberId!);

            // Couldn't find the associated member
            // Member left the guild
            if (!member) {
                // Let the admin know the member left
                const reply = await reaction.message.channel.send(new MessageEmbed({
                    author: {
                        name: 'Member has left the guild'
                    }
                }));

                await sleep(2000);

                // Delete the queue post
                await reaction.message.delete().catch(() => {});

                // Delete the comment
                await reply.delete().catch(() => {});
                return;
            }

            // If this is a known reaction run the associated method
            if (Object.keys(reactions).includes(reaction.emoji.name)) {
                const reactionMethod = reactions[reaction.emoji.name as keyof typeof reactions];
                await reactionMethod(reaction, member);
            }

            // Get ticket number
            const ticketNumber = parseInt(reaction.message.embeds[0].fields.find(field => field.name === 'Ticket number')?.value ?? '', 10);

            // Send audit-log message
            await sendAuditLogMessage({
                colour: reaction.emoji.name === '👍' ? 'GREEN' : (reaction.emoji.name === '👎' ? 'RED' : 'ORANGE'),
                guildId: reaction.message.guild?.id,
                ticketNumber
            });

            // Delete the queued verification message
            await reaction.message.delete();
            return;
        }

        // Reset verification
        if (reaction.emoji.name === '🔄') {
            store.members.set(`${reaction.message.guild?.id}_${user.id}`, 'closed', 'state');
        }

        // Don't allow people to open a second if they already have a verification running
        if (store.members.get(`${reaction.message.guild?.id}_${user.id}`, 'state') === 'open') {
            await user.send(new MessageEmbed({
                description: '❌ You already have a verification ticket open!',
                color: colours.RED
            }));
            return;
        }

        // Remove the reaction
        await reaction.users.remove(user.id);

        // Get member
        const member = reaction.message.guild?.members.cache.get(user.id);

        // Don't allow people to verify twice
        if (store.members.get(`${reaction.message.guild?.id}_${user.id}`, 'state') === 'verified') {
            // Get role to add to member
            const roleIds = store.guilds.get(reaction.message.guild?.id!, 'roles') as string[];
            const roles = roleIds.map(roleId => reaction.message.guild?.roles.cache.get(roleId)).filter(isRole);

            // Make sure the role exists
            if (roles.length === 0) return;

            // Try to add all the roles to the member
            await Promise.all(roles.map(role => member?.roles.add(role)));

            // Let them know they're already verified
            await user.send(new MessageEmbed({
                description: '❌ You\'re already verified!',
                color: colours.RED
            }));
            return;
        }

        // Don't allow people to verify while they have a verification pending
        if (store.members.get(`${reaction.message.guild?.id}_${user.id}`, 'state') === 'pending') {
            await user.send(new MessageEmbed({
                description: '❌ Your verification has already been submitted to the queue, please wait!',
                color: colours.RED
            }));
            return;
        }

        // Set message state to open
        store.members.set(`${reaction.message.guild?.id}_${user.id}`, 'open', 'state');

        // Get current ticket number
        const ticketNumber: number = (store.guilds.inc(reaction.message.guild!.id, 'ticketNumber') as any).get(reaction.message.guild!.id).ticketNumber;

        // Log ticket open
        logger.debug(`TICKET:${`${ticketNumber}`.padStart(5, '0')}`, 'OPEN', `${member?.user.username}#${member?.user.discriminator}`);

        // Send a DM to the user
        const message = await user.send(new MessageEmbed({
            author: {
                name: '✏️ Verification started!'
            },
            color: colours.AQUA,
            description: dedent`
                This server is **strictly 18+** If you're underage please leave immediately!

                Type \`!cancel\` to exit.
            `
        }));

        // Get audit-log channel id
        const auditLogChannelId = store.guilds.get(reaction.message.guild?.id! as string, 'auditLogChannel');

        // Send error to the owner
        if (!auditLogChannelId) {
            await reaction.message.guild?.owner?.send(new MessageEmbed({
                author: {
                    name: `❌ No audit-log channel set in ${reaction.message.guild.name}`
                },
                description: 'Use `!set-audit-log-channel` to set it!'
            }));
            return;
        }

        // Get audit-log channel
        const auditLogChannel = reaction.message.guild?.channels.cache.find(channel => channel.id === auditLogChannelId) as TextChannel;

        // Post in audit-log
        await auditLogChannel.send(new MessageEmbed({
            color: colours.AQUA,
            author: {
                name: `Ticket number #${`${ticketNumber}`.padStart(5, '0')}`,
                iconURL: member?.user.displayAvatarURL()
            },
            fields: [{
                name: 'Username',
                value: member?.user.username,
                inline: true
            }, {
                name: 'Discriminator',
                value: member?.user.discriminator,
                inline: true
            }, {
                name: 'Default avatar',
                value: !member?.user.avatar ? 'Yes' : 'No',
                inline: true
            }, {
                name: 'ID',
                value: user.id,
                inline: true
            }, {
                name: 'Ticket number',
                value: ticketNumber,
                inline: true
            }, {
                name: 'State',
                value: 'opened',
                inline: true
            }]
        }));

        const basicQuestions = [{
            emoji: '❌',
            text: dedent`
                Please set a profile image before continuing with this verification!
                Click [here](https://support.discord.com/hc/en-us/articles/204156688-How-do-I-change-my-avatar-) for more information.
                Once done reply here and I'll check. :smiley:
            `,
            validator: (message: Message) => (message.channel as DMChannel).recipient.avatar !== null,
            formatter: (message: Message) => {
                return `https://cdn.discordapp.com/avatars/${message.author.id}/${message.author.avatar}.jpg`;
            },
            canSkipCheck: (message: Message) => (message.channel as DMChannel).recipient.avatar !== null,
            failureMessage: 'No profile image detected!'
        }, {
            text: 'How old are you?',
            validator: (message: Message) => {
                const age = parseInt(message.content, 10);
                return (age >= 18) && (age <= 100);
            },
            formatter: (message: Message) => parseInt(message.content, 10)
        }, {
            text: 'Are you wanting to sell adult content in this server?',
            validator: (message: Message) => ['yes', 'no', '1', '0', 'true', 'false', 'yep', 'okay', 'nah', 'nope'].includes(message.content.trim().toLowerCase()),
            formatter: (message: Message) => ['yes', 'okay', '0', 'true'].includes(message.content.trim().toLowerCase())
        }, {
            text: `Please send a photo of yourself holding a piece of paper with today's date, the text "I'm joining the lobby" and your **DISCORD** username.`,
            validator: (message: Message) => message.attachments.find(attachment => attachment.url !== '') !== undefined,
            formatter: (message: Message) => message.attachments.find(attachment => attachment.url !== '')?.url
        }];

        // Wait for basic verification
        const basicReplies = await waitForQuestions(ticketNumber, message, user.id, message.guild?.id!, message.channel as TextChannel, basicQuestions);

        // Log replies
        logger.debug(`TICKET:${`${ticketNumber}`.padStart(5, '0')}`, 'GOT_BASIC_REPLIES', basicReplies);

        // Check if the ticket was closed while the timeout was still ticking
        // @TODO: Refactor the awaitForMessages so it'll end on member leave
        if (store.members.get(`${reaction.message.guild?.id}_${user.id}`, 'state') === 'closed') {
            // Bail since this would already have been noted as closed by whatever closed it
            return;
        }

        // Timed-out or cancelled
        if (Object.values(basicReplies).length < basicQuestions.length) {
            // Set state to closed
            store.members.set(`${member?.guild.id}_${user.id}`, 'closed', 'state');

            // Log ticket timed-out
            logger.debug(`TICKET:${`${ticketNumber}`.padStart(5, '0')}`, 'TIMED_OUT_OR_CANCEL');

            return;
        }

        const seller = basicReplies[2];
        const sellerQuestions = [{
            text: 'Do you use onlyfans?',
            validator: (message: Message) => ['yes', 'no', '1', '0', 'true', 'false', 'yep', 'okay', 'nah', 'nope'].includes(message.content.trim().toLowerCase()),
            formatter: (message: Message) => ['yes', 'okay', '0', 'true'].includes(message.content.trim().toLowerCase())
        }, {
            text: 'Please send your onlyfans link. (e.g. https://onlyfans.com/testaccount)',
            validator: (message: Message) => message.content.match(/(?:(?:http|https)\:\/\/)*onlyfans.com\/([a-zA-Z0-9]+)/gi) !== null,
            formatter: (message: Message) => (/(?:(?:http|https)\:\/\/)*onlyfans.com\/([a-zA-Z0-9-_]+)/gi.exec(message.content) ?? [])[1],
            canSkipCheck: (_message: Message, lastReply: boolean) => !lastReply,
            failureMessage: 'Invalid link!'
        }, {
            text: 'Do you use reddit?',
            validator: (message: Message) => ['yes', 'no', '1', '0', 'true', 'false', 'yep', 'okay', 'nah', 'nope'].includes(message.content.trim().toLowerCase()),
            formatter: (message: Message) => ['yes', 'okay', '0', 'true'].includes(message.content.trim().toLowerCase())
        }, {
            text: 'Please send your reddit username. (e.g. omgimalexis)',
            validator: async (message: Message) => {
                const response = await fetch(`https://www.reddit.com/api/username_available.json?user=${message.content.trim()}`).then(result => result.json());
                return !response;
            },
            formatter: (message: Message) => message.content.trim(),
            canSkipCheck: (_message: Message, lastReply: boolean) => {
                return !lastReply;
            },
            failureMessage: 'Invalid username!'
        }, {
            text: `Please post a photo in [the sub](https://reddit.com/r/horny/submit/) of yourself holding the same piece of paper from before. The title should be "[OC] Verifying for the lobby" and you should select the **verification** flair. Once done, reply to this message with the link.`,
            validator: async (message: Message, lastReply: string) => {
                const link = message.content.match(/(https:\/\/www.reddit.com\/r\/horny\/comments\/[a-z0-9]+)/g)?.[0];
                // Bail if the link is missing
                if (!link) return false;

                // Check if the link's author matches the username they provided
                const response = await fetch(`${link}.json`).then(response => response.json());
                const author: string | undefined = response?.[0]?.data?.children?.[0]?.data?.author?.toLowerCase();
                const subreddit: string | undefined = response?.[0]?.data?.children?.[0]?.data?.subreddit;

                // Ensure the username matches what they gave us
                if (author !== lastReply?.toLowerCase()) {
                    throw new Error(`This post is by ${author} and you said your reddit username was ${lastReply}. Please post again but on the correct account.`)
                }

                // Ensure the subreddit is correct
                if (subreddit !== 'horny') {
                    throw new Error(`Please make the post in /r/horny, not /r/${subreddit}`);
                }

                // Ensure the subreddit is correct
                if (subreddit === `u_${author}`) {
                    throw new Error(`Please make the post in /r/horny, not /u/${author}`);
                }

                return true;
            },
            formatter: (message: Message) => message.content.match(/(https:\/\/www.reddit.com\/r\/horny\/comments\/[a-z0-9]+)/g)?.[0],
            canSkipCheck: (_message: Message, lastReply: boolean) => !lastReply,
            failureMessage: 'Invalid link!'
        }];

        // Wait for seller replies
        const sellerReplies = seller ? await waitForQuestions(ticketNumber, message, user.id, message.guild?.id!, message.channel as TextChannel, sellerQuestions) : [];
        if (seller) {
            // Log replies
            logger.debug(`TICKET:${`${ticketNumber}`.padStart(5, '0')}`, 'GOT_SELLER_REPLIES', sellerReplies);

            // Check if the ticket was closed while the timeout was still ticking
            // @TODO: Refactor the awaitForMessages so it'll end on member leave
            if (store.members.get(`${reaction.message.guild?.id}_${user.id}`, 'state') === 'closed') {
                // Bail since this would already have been noted as closed by whatever closed it
                return;
            }

            // Timed-out or cancelled
            if (Object.values(sellerReplies).length < sellerQuestions.length) {
                // Set state to closed
                store.members.set(`${member?.guild.id}_${user.id}`, 'closed', 'state');

                // Log ticket timed-out
                logger.debug(`TICKET:${`${ticketNumber}`.padStart(5, '0')}`, 'TIMED_OUT_OR_CANCEL');

                return;
            }
        }

        // Get the guild's queue channel id
        const queueChannelId = store.guilds.get(reaction.message.guild?.id!, 'queueChannel');

        // Send error to the owner
        if (!queueChannelId) {
            await reaction.message.guild?.owner?.send(new MessageEmbed({
                author: {
                    name: `❌ No queue channel set in ${reaction.message.guild.name}`
                },
                description: 'Use `!set-queue-channel` to set it!'
            }));
            return;
        }

        // Get queue channel
        const queueChannel = reaction.message.guild?.channels.cache.find(channel => channel.id === queueChannelId) as TextChannel;

        // Set verification as pending
        store.members.set(`${reaction.message.guild?.id}_${user.id}`, 'pending', 'state');

        // Log ticket pending
        logger.debug(`TICKET:${`${ticketNumber}`.padStart(5, '0')}`, 'PENDING');

        // Get onlyfans stats
        const onlyFansStats = seller ? await getOnlyFansStats(sellerReplies[1]).catch(() => undefined) : undefined;

        // Log onlyfans stats
        if (seller) {
            logger.debug(`TICKET:${`${ticketNumber}`.padStart(5, '0')}`, 'ONLYFANS_STATS:' + (onlyFansStats === undefined ? 'FAILURED_FETCH' : 'SUCCESS'));
        }

        // Embeds for admins/mods to see
        const queueChanneEmbed = {
            author: {
                name: `Ticket number #${`${ticketNumber}`.padStart(5, '0')}`,
                iconURL: reaction.message.guild?.members.cache.find(member => member.id === user.id)?.user.displayAvatarURL()
            },
            fields: [{
                name: 'Username',
                value: user.username,
                inline: true
            }, {
                name: 'Discriminator',
                value: user.discriminator,
                inline: true
            }, {
                name: 'Age',
                value: basicReplies[1],
                inline: true
            }, {
                name: 'ID',
                value: user.id,
                inline: true
            }, {
                name: 'Seller?',
                value: seller ? '<:checkmark:835897461276016691>' : '<:decline:835897487289745408>',
                inline: true
            }, {
                name: 'Ticket number',
                value: ticketNumber,
                inline: true
            }, ...(seller ? [{
                name: 'Onlyfans stats',
                value: `${onlyFansStats ? `${onlyFansStats?.posts} posts - ${onlyFansStats?.lastOnline ?? 'N/A'}` : 'Missing'}`,
            }, {
                name: 'Onlyfans link',
                value: `[https://onlyfans.com/${sellerReplies[1]}](Link)`
            }, {
                name: 'Reddit',
                value: sellerReplies[2] ? `[${sellerReplies[4]}](${sellerReplies[3]})` : 'N/A'
            }] : [])],
            image: {
                url: basicReplies[3]
            }
        };

        logger.debug(`TICKET:${`${ticketNumber}`.padStart(5, '0')}`, 'QUEUE_CHANNEL_EMBED', queueChanneEmbed);

        // Send message to queue channel for mods/admins to verify
        const verification = await queueChannel.send(new MessageEmbed(queueChanneEmbed));

        // Add approve, redo, missing image and deny reactions
        await verification.react('👍');
        await verification.react('🔁');
        await verification.react('🖼️');
        await verification.react('👎');

        // Add verfication message to the watched messages list
        store.watchedMessages.set(verification.id, verification.guild!.id);

        // Success?
        await user.send(new MessageEmbed({
            color: colours.GREEN,
            author: {
                name: '🚀 Verification submitted!'
            },
            fields: [{
                name: 'Guild',
                value: reaction.message.guild?.name
            }, {
                name: 'Ticket #',
                value: `${ticketNumber}`.padStart(5, '0')
            }],
            description: 'Once your verification has been accepted you\'ll get a message here from me.'
        }));
    } catch (error) {
        logger.error('Failed processing reaction.', error);
    }
};