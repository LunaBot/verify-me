import { Message } from 'discord.js';

export interface Question {
    text: string | ((lastReply?: any) => string);
    emoji?: string;
    validator: (message: Message, lastReply?: any) => Promise<boolean> | boolean;
    formatter: (message: Message, lastReply?: any) => any;
    canSkipCheck?: (message: Message, lastReply?: any) => any;
    failureMessage?: string;
}
