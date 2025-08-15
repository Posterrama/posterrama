const request = require('supertest');
const express = require('express');
const session = require('express-session');
const { sessionAuth, requireRole } = require('../../middleware/auth');

describe('Auth Middleware', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false,
            cookie: { secure: false }
        }));
        app.use(express.json());
    });

    describe('sessionAuth', () => {
        it('should reject requests without authentication', (done) => {
            app.get('/test', sessionAuth, (req, res) => {
                res.status(200).json({ success: true });
            });

            request(app)
                .get('/test')
                .expect(401, done);
        });

        it('should pass requests with valid session', (done) => {
            app.get('/login', (req, res) => {
                req.session.user = { id: 1, username: 'test' };
                res.status(200).json({ success: true });
            });

            app.get('/test', sessionAuth, (req, res) => {
                res.status(200).json({ success: true });
            });

            const agent = request.agent(app);
            agent
                .get('/login')
                .expect(200)
                .then(() => {
                    return agent
                        .get('/test')
                        .expect(200);
                })
                .then(() => done())
                .catch(done);
        });
    });

    describe('requireRole', () => {
        it('should reject non-admin users', (done) => {
            app.get('/login', (req, res) => {
                req.session.user = { id: 1, username: 'user', role: 'user' };
                res.status(200).json({ success: true });
            });

            app.get('/admin', sessionAuth, requireRole('admin'), (req, res) => {
                res.status(200).json({ success: true });
            });

            const agent = request.agent(app);
            agent
                .get('/login')
                .expect(200)
                .then(() => {
                    return agent
                        .get('/admin')
                        .expect(403);
                })
                .then(() => done())
                .catch(done);
        });

        it('should accept admin users', (done) => {
            app.get('/login', (req, res) => {
                req.session.user = { id: 1, username: 'admin', role: 'admin' };
                res.status(200).json({ success: true });
            });

            app.get('/admin', sessionAuth, requireRole('admin'), (req, res) => {
                res.status(200).json({ success: true });
            });

            const agent = request.agent(app);
            agent
                .get('/login')
                .expect(200)
                .then(() => {
                    return agent
                        .get('/admin')
                        .expect(200);
                })
                .then(() => done())
                .catch(done);
        });
    });
});
