// Type definitions for Posterrama Config
// This extends the base Config type with runtime properties

export interface CacheConfig {
    maxSizeGB?: number;
    autoCleanup?: boolean;
    cleanupIntervalMinutes?: number;
}

export interface ConfigExtensions {
    serverPort?: number;
    cache?: CacheConfig;
    backgroundRefreshMinutes?: number;
    transitionIntervalSeconds?: number;
    syncEnabled?: boolean;
}

// Extend the imported Config type
declare module '../config/index.js' {
    interface Config extends ConfigExtensions {}
}
