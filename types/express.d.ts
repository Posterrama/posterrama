// Type definitions for Express extensions
import 'express';
import 'express-session';

declare module 'express' {
    interface Request {
        id?: string;
    }

    interface Application {
        cleanup?: () => Promise<void>;
    }
}

declare module 'express-serve-static-core' {
    interface Request {
        id?: string;
    }
}
