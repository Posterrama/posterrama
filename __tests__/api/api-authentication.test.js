const request = require('supertest');
const express = require('express');
const session = require('express-session');

describe('API Authentication Integration', () => {
    let app;

    beforeEach(() => {
        // Minimal app setup for authentication testing
        app = express();
        app.use(session({
            secret: 'test-secret',
            resave: false,
            saveUninitialized: false,
            cookie: { secure: false }
        }));
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));
    });

    describe('Login endpoint', () => {
        it('should reject invalid credentials', (done) => {
            // Simple test route that mimics login behavior
            app.post('/admin/login', (req, res) => {
                const { username, password } = req.body;
                if (username !== 'admin' || password !== 'correct') {
                    return res.status(401).json({ error: 'Invalid credentials' });
                }
                res.status(200).json({ success: true });
            });

            request(app)
                .post('/admin/login')
                .send({ username: 'wrong', password: 'wrong' })
                .expect(401)
                .expect(res => {
                    expect(res.body.error).toContain('Invalid');
                })
                .end(done);
        });

        it('should accept valid credentials', (done) => {
            app.post('/admin/login', (req, res) => {
                const { username, password } = req.body;
                if (username === 'admin' && password === 'correct') {
                    req.session.user = { id: 1, username: 'admin' };
                    return res.status(200).json({ success: true });
                }
                res.status(401).json({ error: 'Invalid credentials' });
            });

            request(app)
                .post('/admin/login')
                .send({ username: 'admin', password: 'correct' })
                .expect(200, done);
        });
    });

    describe('Protected routes', () => {
        it('should protect admin routes', (done) => {
            app.get('/api/admin/config', (req, res) => {
                if (!req.session.user) {
                    return res.status(401).json({ error: 'Unauthorized' });
                }
                res.status(200).json({ config: 'data' });
            });

            request(app)
                .get('/api/admin/config')
                .expect(401, done);
        });
    });
});
