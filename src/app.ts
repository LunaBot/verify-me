import { config } from './config';
import { client } from './client';
import { onError, onGuildMemberAdd, onGuildMemberRemove, onMessage, onMessageReactionAdd, onReady } from './events';
import { logger } from './logger';

const protect = (name: string, func: (...args: any[]) => any) => async (...args: any[]) => {
    try {
        await Promise.resolve(func(...args));
    } catch (error) {
        try {
            const [message, ...stack] = error.stack.split('\n');
            logger.error(`EVENT:${name.toUpperCase()}`, message, '\n' + stack.join('\n'));
        } catch {
            logger.error(`EVENT:${name.toUpperCase()}`, error);
        }
    }
};

export const start = async () => {
    // Bind events
    client.on('error', protect('ERROR', onError));
    client.on('guildMemberAdd', protect('GUILD_MEMBER_ADD', onGuildMemberAdd));
    client.on('guildMemberRemove', protect('GUILD_MEMBER_REMOVE', onGuildMemberRemove));
    client.on('message', protect('MESSAGE', onMessage));
    client.on('messageReactionAdd', protect('MESSAGE_REACTION_ADD', onMessageReactionAdd));
    client.on('ready', protect('READY', onReady));

    // Login to discord's ws gateway
    client.login(config.botToken);
};