const authManager = require('../../utils/auth');
const {
	jwtAuth,
	apiKeyAuth,
	authenticate,
	requireRole,
	requirePermission,
	requireTwoFactor,
	optionalAuth,
	sessionAuth,
	checkAccountLockout
} = require('../../middleware/auth');

jest.mock('../../utils/auth');
jest.mock('../../logger');

describe('Auth Middleware - Comprehensive (migrated)', () => {
	let req, res, next;
	beforeEach(() => {
		req = { headers: {}, body: {}, session: {}, user: null };
		res = { status: jest.fn().mockReturnThis(), json: jest.fn(), redirect: jest.fn() };
		next = jest.fn();
		jest.clearAllMocks();
	});
	describe('requirePermission', () => {
		test('allows API key permission', () => { req.user={userId:1,permissions:['read'],authMethod:'api-key'}; requirePermission('read')(req,res,next); expect(next).toHaveBeenCalled(); });
		test('wildcard', () => { req.user={userId:1,permissions:['*'],authMethod:'api-key'}; requirePermission('x')(req,res,next); expect(next).toHaveBeenCalled(); });
		test('JWT path', () => { req.user={userId:1}; authManager.hasPermission.mockReturnValue(true); requirePermission('read')(req,res,next); expect(next).toHaveBeenCalled(); });
		test('rejects missing perm', () => { req.user={userId:1,permissions:['read'],authMethod:'api-key'}; requirePermission('write')(req,res,next); expect(res.status).toHaveBeenCalledWith(403); });
		test('rejects JWT missing perm', () => { req.user={userId:1}; authManager.hasPermission.mockReturnValue(false); requirePermission('admin')(req,res,next); expect(res.status).toHaveBeenCalledWith(403); });
		test('unauthenticated', () => { requirePermission('read')(req,res,next); expect(res.status).toHaveBeenCalledWith(401); });
	});
	describe('requireTwoFactor', () => {
		beforeEach(()=>{ authManager.twoFactorSecrets = new Map(); });
		test('no setup', ()=>{ req.user={userId:1}; requireTwoFactor(req,res,next); expect(next).toHaveBeenCalled(); });
		test('disabled', ()=>{ req.user={userId:1}; authManager.twoFactorSecrets.set(1,{enabled:false}); requireTwoFactor(req,res,next); expect(next).toHaveBeenCalled(); });
		test('valid token', ()=>{ req.user={userId:1}; req.headers['x-2fa-token']='123456'; authManager.twoFactorSecrets.set(1,{enabled:true}); authManager.verifyTwoFactor.mockReturnValue(true); requireTwoFactor(req,res,next); expect(next).toHaveBeenCalled(); });
		test('missing token', ()=>{ req.user={userId:1}; authManager.twoFactorSecrets.set(1,{enabled:true}); requireTwoFactor(req,res,next); expect(res.status).toHaveBeenCalledWith(403); });
		test('invalid token', ()=>{ req.user={userId:1}; req.headers['x-2fa-token']='x'; authManager.twoFactorSecrets.set(1,{enabled:true}); authManager.verifyTwoFactor.mockReturnValue(false); requireTwoFactor(req,res,next); expect(res.status).toHaveBeenCalledWith(403); });
		test('error path', ()=>{ req.user={userId:1}; req.headers['x-2fa-token']='x'; authManager.twoFactorSecrets.set(1,{enabled:true}); authManager.verifyTwoFactor.mockImplementation(()=>{ throw new Error('boom');}); requireTwoFactor(req,res,next); expect(res.status).toHaveBeenCalledWith(403); });
		test('unauthenticated', ()=>{ requireTwoFactor(req,res,next); expect(res.status).toHaveBeenCalledWith(401); });
	});
	describe('optionalAuth', ()=>{
		test('API key', ()=>{ req.headers['x-api-key']='k'; authManager.authenticateApiKey.mockReturnValue({userId:1,permissions:['r']}); optionalAuth(req,res,next); expect(req.user.authMethod).toBe('api-key'); });
		test('JWT', ()=>{ const u={userId:1}; req.headers.authorization='Bearer t'; authManager.verifyToken.mockReturnValue(u); optionalAuth(req,res,next); expect(req.user).toEqual(u); });
		test('invalid API key', ()=>{ req.headers['x-api-key']='k'; authManager.authenticateApiKey.mockImplementation(()=>{ throw new Error('bad');}); optionalAuth(req,res,next); expect(req.user).toBeNull(); });
		test('invalid JWT', ()=>{ req.headers.authorization='Bearer t'; authManager.verifyToken.mockImplementation(()=>{ throw new Error('bad');}); optionalAuth(req,res,next); expect(req.user).toBeNull(); });
		test('priority API key', ()=>{ req.headers['x-api-key']='k'; req.headers.authorization='Bearer t'; authManager.authenticateApiKey.mockReturnValue({userId:1,permissions:['r']}); optionalAuth(req,res,next); expect(authManager.verifyToken).not.toHaveBeenCalled(); });
	});
	describe('sessionAuth', ()=>{
		test('valid session', ()=>{ const u={userId:1}; req.session={user:u}; sessionAuth(req,res,next); expect(req.user).toEqual(u); });
		test('missing session', ()=>{ sessionAuth(req,res,next); expect(res.status).toHaveBeenCalledWith(401); });
		test('empty session', ()=>{ req.session={}; sessionAuth(req,res,next); expect(res.status).toHaveBeenCalledWith(401); });
		test('no user', ()=>{ req.session={other:'x'}; sessionAuth(req,res,next); expect(res.status).toHaveBeenCalledWith(401); });
	});
	describe('checkAccountLockout', ()=>{
		beforeEach(()=>{ authManager.users = new Map(); });
		test('no username', ()=>{ req.body={}; checkAccountLockout(req,res,next); expect(next).toHaveBeenCalled(); });
		test('non-existent user', ()=>{ req.body={ username:'nouser' }; checkAccountLockout(req,res,next); expect(next).toHaveBeenCalled(); });
		test('unlocked user', ()=>{ req.body={ username:'u' }; authManager.users.set('u',{ userId:1, locked:false }); checkAccountLockout(req,res,next); expect(next).toHaveBeenCalled(); });
		test('user without locked prop', ()=>{ req.body={ username:'u' }; authManager.users.set('u',{ userId:1 }); checkAccountLockout(req,res,next); expect(next).toHaveBeenCalled(); });
		test('locked user', ()=>{ req.body={ username:'u' }; authManager.users.set('u',{ userId:1, locked:true }); checkAccountLockout(req,res,next); expect(res.status).toHaveBeenCalledWith(423); expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('Account locked') })); });
	});
});
