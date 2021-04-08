import { store } from '../store';
import { logger } from '../logger';
import { client } from '../client';
import { MessageEmbed } from 'discord.js';

export const onReady = async function onReady() {
    logger.info('BOT:READY');

    // Remove broken tickets
    await Promise.all(store.members.keyArray().map(guildId_memberId => {
        if ((guildId_memberId as string).startsWith('undefined_') || (guildId_memberId as string).endsWith('_undefined')) {
            logger.debug('DELETING_BROKEN_TICKET', guildId_memberId);
            store.members.delete(guildId_memberId);
        }
    }));

    // Reset every member's ticket state
    await Promise.all(store.members.keyArray().map(async guildId_memberId => {
        const state = store.members.get(guildId_memberId, 'state');
        if (state === 'open') {
            const [guildId, memberId] = String(guildId_memberId).split('_');
            logger.debug('RESETTING_MEMBER', memberId);
            store.members.set(guildId_memberId, 'closed', 'state');

            // Get user if they're not cached fallback to fetching them
            const user = client.users.cache.get(memberId) ?? await client.users.fetch(memberId);

            // If the user is still in atleast one server
            // the bot is in then try and message them
            if (user) {
                // Let user know the bot restarted
                await user.send(new MessageEmbed({
                    author: {
                        name: '⌛ Verification bot restarted!'
                    },
                    description: 'Please visit the server where you were verifying and try again.'
                })).catch((error) => {console.log(error)});
            }
        }
    }));

    // Load all invites for all guilds and save them to the cache.
    await Promise.allSettled(client.guilds.cache.map(async guild => {
        if (guild.id === '828106116331733004') {
            const guildInvites = await guild.fetchInvites();
            store.invites.set(guild.id, guildInvites);
        }
    }));
};
