import { logger } from '../logger';

export const onError = function onError(error: unknown) {
    logger.error(error as any);
};
