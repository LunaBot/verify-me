import { MessageEmbed } from 'discord.js';
import { colours } from 'utils';

export const createEmbed = ({ colour, text, author }: { colour?: keyof typeof colours; text?: string; author?: string; }) => {
    return new MessageEmbed({
        ...(colour ? { colour } : { color: colours.BLURPLE }),
        ...(author ? { author: { name: author } } : {}),
        ...(text ? { description: text } : {})
    });
};
