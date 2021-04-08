import dedent from 'dedent';
import { colours, isTextBasedChannel, sendAuditLogMessage, sleep, waitForQuestions } from '../utils';
import { DMChannel, Message, MessageEmbed, MessageReaction, TextChannel, User } from 'discord.js';
import { logger } from '../logger';
import { store, guildsDefaultOptions } from '../store';

export const onMessageReactionAdd = async function onMessageReactionAdd(reaction: MessageReaction, user: User) {
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
        const member = reaction.message.guild.members.cache.get(memberId!);

        // Couldn't find the associated member
        if (!member) return;

        // Approved
        if (reaction.emoji.name === '👍') {
            // Get role to add to member
            const roleIds = store.guilds.get(reaction.message.guild?.id!, 'roles');
            const roles = roleIds.map(roleId => reaction.message.guild?.roles.cache.get(roleId)).filter(role => role);

            // Make sure the role exists
            if (roles.length === 0) return;

            // Try to add all the roles to the member
            await Promise.all(roles.map(role => member.roles.add(role)));

            // Get ticket number
            const ticketNumber = reaction.message.embeds[0].fields.find(field => field.name === 'Ticket number')?.value;

            // Mark verified
            store.members.set(`${reaction.message.guild?.id}_${member?.id}`, 'verified', 'state');

            // Log ticket approved
            logger.debug(`TICKET:${`${ticketNumber}`.padStart(5, '0')}`, 'APPROVED');

            await store.guilds.ensure('announcementChannel', guildsDefaultOptions.announcementChannel);

            // Mention the user in the chat channel
            const announcementChannelId = await store.guilds.get(reaction.message.guild.id, 'announcementChannel');
            const announcementChannel = reaction.message.guild.channels.cache.get(announcementChannelId);

            // Post announcement that the member was approved
            if (isTextBasedChannel(announcementChannel)) {
                const randomGreeting = [
                    'Welcome {user} to the lobby!',
                    'Hey! {user} finally joined!',
                    'OMG it\'s {user}',
                    'Everyone give a warm welcome to {user}'
                ];
                const greeting = randomGreeting[Math.floor(Math.random() * randomGreeting.length)];
                await announcementChannel.send(greeting.replace('{user}', `<@${member?.id}>`));
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
                        value: reaction.message.guild.name
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
        }

        // Redo
        if (reaction.emoji.name === '🔁') {
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
                        value: reaction.message.guild.name
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
        }

        // Denied
        if (reaction.emoji.name === '👎') {
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
                        value: reaction.message.guild.name
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
        const roleIds = store.guilds.get(reaction.message.guild?.id!, 'roles');
        const roles = roleIds.map(roleId => reaction.message.guild?.roles.cache.get(roleId)).filter(role => role);

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

    // Get audit-log channel
    const auditLogChannelId = store.guilds.get(reaction.message.guild?.id! as string, 'auditLogChannel');
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

    // Store questions
    const questions = [{
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

    // Wait for verification
    const replies = await waitForQuestions(ticketNumber, message, user.id, message.guild?.id!, message.channel as TextChannel, questions);

    // Check if the ticket was closed while the timeout was still ticking
    // @TODO: Refactor the awaitForMessages so it'll end on member leave
    if (store.members.get(`${reaction.message.guild?.id}_${user.id}`, 'state') === 'closed') {
        // Bail since this would already have been noted as closed by whatever closed it
        return;
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

    // Timed-out or cancelled
    if (Object.values(replies).length < questions.length) {
        // Set state to closed
        store.members.set(`${member?.guild.id}_${user.id}`, 'closed', 'state');

        // Log ticket timed-out
        logger.debug(`TICKET:${`${ticketNumber}`.padStart(5, '0')}`, 'TIMED_OUT_OR_CANCEL');

        return;
    }

    // Log replies
    logger.debug(`TICKET:${`${ticketNumber}`.padStart(5, '0')}`, 'GOT_REPLIES', replies);

    // Set verification as pending
    store.members.set(`${reaction.message.guild?.id}_${user.id}`, 'pending', 'state');

    // Log ticket pending
    logger.debug(`TICKET:${`${ticketNumber}`.padStart(5, '0')}`, 'PENDING');

    // Send message to queue channel for mods/admins to verify
    const verification = await queueChannel.send(new MessageEmbed({
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
            value: replies[1],
            inline: true
        }, {
            name: 'ID',
            value: user.id,
            inline: true
        }, {
            name: 'Seller?',
            value: replies[2] ? 'Yes' : 'No',
            inline: true
        }, {
            name: 'Ticket number',
            value: ticketNumber,
            inline: true
        }],
        image: {
            url: replies[3]
        }
    }));

    // Add approve, redo and deny reactions
    await verification.react('👍');
    await verification.react('🔁');
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
};