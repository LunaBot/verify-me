import { Message, User } from 'discord.js';
import { createEmbed } from '../create-embed';

export const waitForAnswer = async <T = unknown>({ user, question, attempt, validator, formatter, failureText }: {
    user: User;
    question: string;
    attempt?: number;
    validator: (message: Message) => Promise<boolean> | boolean;
    formatter: (message: Message) => T;
    failureText?: string;
}): Promise<T | undefined> => {
    // Only ask on the first attempt
    if (!attempt || attempt === 0) {
        // Ask user question
        await user.send(createEmbed({ text: question }));
    }

    // Wait for answer
    const answer = await user.dmChannel!.awaitMessages(message => message.author.id == user.id, {
        // Only collect a single message
        max: 1,
        // 10 mins
        time: 10 * 60 * 1000,
        // Throw error on timeout
        errors: ['time']
    }).then(response => response.first());

    // Timed out
    if (!answer) {
        throw new Error('TIMED_OUT');
    }

    // Verification cancelled
    if (answer.content.includes('!cancel')) {
        throw new Error('CANCELLED');
    }

    // Validate answer
    const isValid = await Promise.resolve(validator(answer)).catch(error => {
        const validatorError = new Error('VALIDATOR_ERROR');
        // @ts-expect-error
        validatorError.error = error;
        throw validatorError;
    });

    // Handle validation
    if (isValid) {
        return formatter(answer);
    }

    // Ask them to try again
    const tryAgainEmbed = createEmbed({ author: failureText ?? 'Invalid response, try again' });
    await user.send(tryAgainEmbed);

    // Wait for the answer again
    return waitForAnswer({ user, question, attempt: 1, validator, formatter });
};
