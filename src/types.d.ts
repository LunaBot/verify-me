import { Message } from 'discord.js';

export interface Question {
    text: string;
    emoji?: string;
    validator: (message: Message) => boolean;
    formatter: (message: Message) => any;
    canSkipCheck?: (message: Message) => any;
    failureMessage?: string;
}
