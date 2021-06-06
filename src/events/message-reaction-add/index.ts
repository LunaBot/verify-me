import { DiscordAPIError, MessageEmbed, MessageReaction, TextChannel, User } from 'discord.js';
import { createEmbed } from 'utils/create-embed';
import { logger } from '../../logger';
import { store } from '../../store';
import { sleep } from '../../utils';
import { reactions } from './reactions';

export const onMessageReactionAdd = async function onMessageReactionAdd(reaction: MessageReaction, user: User) {
    try {
        // If we're not in a guild then bail
        if (!reaction.message.guild) return;

        // If we're not in the queue channel then bail
        if (reaction.message.channel.id !== store.guilds.get(reaction.message.guild.id!, 'queueChannel')) return;
    
        // Get whole reaction and user
        if (reaction.partial) await reaction.fetch();
        if (user.partial) await user.fetch();

        // Bail if it's not an admin
        if (!reaction.message.guild?.members.cache.get(user.id)?.roles.cache.find(role => role.id === store.guilds.get(reaction.message.guild?.id!, 'adminRole'))) return;

        // Attempt to get the ticket number
        const ticketNumber = reaction.message.embeds?.[0]?.footer?.text?.match(/Ticket \#([0-9]+)/)![1];

        // Attempt to get the member ID
        const memberId = reaction.message.embeds?.[0]?.fields.find(field => field.name.toLowerCase() === 'tag')?.value.match(/<@!?(\d+)>/)?.[1];

        // Make sure this is one of our embeds
        if (!ticketNumber || !memberId) return;

        logger.debug(`TICKET:${ticketNumber}`, `REACTION_ADD:${reaction.message.id}`, `${user.username}#${user.discriminator}`);

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

            await sleep(5000);

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

        // Data for audit-log embed
        const auditLogData = reaction.message.embeds[0];

        // Remove image from audit-log embed
        auditLogData.image = null;

        // Get ticket state
        const ticketState = store.members.get(`${reaction.message.guild.id}_${member?.id}`, 'state');

        // Add ticket state to audit-log embed
        auditLogData.addField('Ticket State', ticketState, true);

        // If they're not denied try and reset their state
        if (ticketState !== 'DENIED') {
            // Reset member's ticket state to closed so they can redo it, etc.
            store.members.set(member?.id, 'CLOSED', 'state');
        }

        // Create audit-log embed
        const auditLogEmbed = new MessageEmbed(auditLogData);

        // Get audit-log channel ID
        const auditLogChannelId = store.guilds.get(reaction.message.guild.id, 'auditLogChannel');

        // No verification queue channel set
        if (!auditLogChannelId) {
            const error = new Error('NO_CHANNEL_SET');
            // @ts-expect-error
            error.channel = 'audit-log';
            throw error;
        }

        // Get audit-log channel
        const auditLogChannel = reaction.message.guild.channels.cache.find(channel => channel.id === auditLogChannelId) as TextChannel;

        // Missing audit-log channel
        if (!auditLogChannel) {
            const error = new Error('CHANNEL_MISSING');
            // @ts-expect-error
            error.channel = 'audit-log';
            throw error;
        }

        // Post in audit-log
        await auditLogChannel.send(auditLogEmbed);

        // Delete the queued verification message
        await reaction.message.delete();
        return;
    } catch (error) {
        // Attempt to get the ticket number
        const ticketNumber = reaction.message.embeds[0].footer?.text?.match(/Ticket \#([0-9]+)/)?.[1];

        if (error.message === 'CHANNEL_MISSING') {
            const embed = createEmbed({ author: `🚫 Please contact the admins/mods as the "${error.channel}" channel is missing.` });
            await reaction.message.channel.send(embed).catch(() => {});
            return;
        }

        if (error.message === 'NO_CHANNEL_SET') {
            const embed = createEmbed({ author: `🚫 Please contact the admins/mods as no "${error.channel}" channel has been set in the config.` });
            await reaction.message.channel.send(embed).catch(() => {});
            return;
        }
        
        if (error instanceof DiscordAPIError) {
            if (error.message.toLowerCase().includes('missing access')) {
                const channelId = error.path.split('/')[2];
                const channel = reaction.message.guild!.channels.cache.get(channelId);
                const embed = createEmbed({
                    author: `🚫 Please contact the admins/mods as I don't have permission to post in ${channel?.name}.`
                });
                await reaction.message.channel.send(embed).catch(() => {});
                return;
            }
            const embed = createEmbed({ author: `🚫 Please contact the admins/mods as I've hit a Discord API error.` });
            await reaction.message.channel.send(embed).catch(() => {});
            logger.error(`TICKET:${ticketNumber}`, `REACTION_ADD:${reaction.message.id}`, `${user.username}#${user.discriminator}`, error);
            return;
        }

        // Log error
        console.error(error);
    }
};