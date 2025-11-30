// Type definitions for Express Router extensions
import 'express';

declare module 'express' {
    interface Router {
        // admin-cache.js custom method
        initCacheReferences?: (cacheManager: any, apiCache: any) => void;

        // config-backups.js custom method
        scheduleConfigBackups?: () => Promise<void>;
    }
}
