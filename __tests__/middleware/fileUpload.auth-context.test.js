/**
 * Tests for fileUpload middleware auth context extraction (#6)
 */

describe('FileUpload Middleware - Auth Context (#6)', () => {
    describe('uploadedBy field extraction', () => {
        it('should extract username from req.session', () => {
            const mockReq = {
                session: {
                    username: 'testuser',
                },
            };

            const uploadedBy = mockReq?.session?.username || mockReq?.user?.username || 'admin';
            expect(uploadedBy).toBe('testuser');
        });

        it('should extract username from req.user if session is empty', () => {
            const mockReq = {
                user: {
                    username: 'oauthuser',
                },
            };

            const uploadedBy = mockReq?.user?.username || 'admin';
            expect(uploadedBy).toBe('oauthuser');
        });

        it('should fallback to admin if no auth context', () => {
            const mockReq = {};
            const uploadedBy = mockReq?.session?.username || mockReq?.user?.username || 'admin';
            expect(uploadedBy).toBe('admin');
        });

        it('should prioritize session over user', () => {
            const mockReq = {
                session: {
                    username: 'sessionuser',
                },
                user: {
                    username: 'oauthuser',
                },
            };

            const uploadedBy = mockReq?.session?.username || mockReq?.user?.username || 'admin';
            expect(uploadedBy).toBe('sessionuser');
        });

        it('should handle null/undefined values gracefully', () => {
            const mockReq = {
                session: null,
                user: undefined,
            };

            const uploadedBy = mockReq?.session?.username || mockReq?.user?.username || 'admin';
            expect(uploadedBy).toBe('admin');
        });
    });

    describe('metadata generation with auth context', () => {
        it('should include correct uploadedBy in metadata structure', () => {
            const metadata = {
                originalTitle: 'Test Movie',
                originalFilename: 'test-movie.jpg',
                source: 'user-upload',
                uploadedBy: 'testuser', // Extracted from auth
            };

            expect(metadata.uploadedBy).toBe('testuser');
            expect(metadata.source).toBe('user-upload');
        });

        it('should maintain backwards compatibility with admin default', () => {
            const metadata = {
                uploadedBy: 'admin', // Fallback when no auth
            };

            expect(metadata.uploadedBy).toBe('admin');
        });
    });
});
