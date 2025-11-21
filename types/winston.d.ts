// Type definitions for custom Winston extensions
import 'winston';
import { EventEmitter } from 'events';

declare module 'winston' {
    interface Logger {
        memoryLogs: Array<{
            timestamp: string;
            level: string;
            message: string;
            [key: string]: any;
        }>;
        events: EventEmitter;
        fatal: (...args: any[]) => Logger;
        __resetMemory: () => void;
        __ping: () => boolean;
        shouldExcludeFromAdmin?: (message: string) => boolean;
        getRecentLogs?: (
            level?: string | null,
            limit?: number,
            offset?: number,
            testOnly?: boolean
        ) => Array<{
            timestamp: string;
            level: string;
            message: string;
            [key: string]: any;
        }>;
        updateLogLevelFromDebug?: () => void;
    }
}
