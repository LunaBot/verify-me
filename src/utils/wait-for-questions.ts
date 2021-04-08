import { Message, MessageEmbed, TextChannel } from "discord.js";
import { store } from "../store";
import { colours } from "utils";

export const waitForQuestions = async (ticketNumber: number, originalMessage: Message, userId: string, guildId: string, channel: TextChannel, questions: Question[], index: number = 0, results: any[] = []): Promise<any[]> => {
    // Get the current question
    const question = questions[index];

    // Mark which step we're on
    store.tickets.set(`${guildId}_${ticketNumber}`, index, 'step');

    // Return results when done
    if (!question) return results;

    // Check if we can skip this question
    if (question.canSkipCheck && question.canSkipCheck(originalMessage)) return waitForQuestions(ticketNumber, originalMessage, userId, guildId, channel, questions, index + 1, {
        ...results,
        [index]: question.formatter(originalMessage)
    });

    // Ask question
    await channel.send(new MessageEmbed({
        color: colours.BLURPLE,
        description: `${question.emoji ?? '❓'} ${question.text}`
    }));

    // Wait for answer
    const collected = await channel.awaitMessages(m => m.author.id === userId, {
        // Only collect a single message at a time
        max: 1,
        // 10 seconds
        time: 10 * 1000,
        // // 10 minutes
        // time: 10 * 60 * 1000,
        errors: ['time']
    }).then(response => response.first()).catch(async () => {
        await channel.send(new MessageEmbed({
            author: {
                name: '⌛ Verification timed out!'
            }
        })).catch(() => {});
    });

    // Timed-out
    if (!collected) return results;

    // Cancelled
    if (collected.content.toLowerCase().startsWith('!cancel')) {
        // Let the user know
        await channel.send(new MessageEmbed({
            author: {
                name: '❌ Verification cancelled!'
            }
        }));

        // Bail with the results we currently have
        return results;
    }

    // Check response was valid
    if (!question.validator(collected)) {
        // Invalid response
        await channel.send(new MessageEmbed({
            author: {
                name: `❌ ${question.failureMessage ?? 'Invalid response, try again!'}`
            }
        }));

        // Resend question
        return waitForQuestions(ticketNumber, originalMessage, userId, guildId, channel, questions, index, results);
    }

    return waitForQuestions(ticketNumber, originalMessage, userId, guildId, channel, questions, index + 1, {
        ...results,
        [index]: question.formatter(collected)
    });
};