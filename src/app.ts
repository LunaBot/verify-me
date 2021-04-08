import { config } from './config';
import { client } from './client';
import { onError, onGuildMemberRemove, onMessage, onMessageReactionAdd, onRaw, onReady } from './events';
import { logger } from './logger';

const protect = (name: string, func: (...args) => any) => async (...args) => {
    try {
        await Promise.resolve(func(...args));
    } catch (error) {
        const [message, ...stack] = error.stack.split('\n');
        logger.error(`EVENT:${name.toUpperCase()}`, message, '\n' + stack.join('\n'));
    }
};

export const start = async () => {
    // Bind events
    client.on('error', protect('ERROR', onError));
    client.on('guildMemberRemove', protect('GUILD_MEMBER_REMOVE', onGuildMemberRemove));
    client.on('message', protect('MESSAGE', onMessage));
    client.on('messageReactionAdd', protect('MESSAGE_REACTION_ADD', onMessageReactionAdd));
    client.on('raw', protect('RAW', onRaw));
    client.on('ready', protect('READY', onReady));

    // Login to discord's ws gateway
    client.login(config.botToken);
};