'use strict';

var EventEmitter = require('events').EventEmitter;
var Promise      = require('bluebird');
var util         = require('util');
var request      = require('request-promise');
var headers      = require('plex-api-headers');
var parseString  = Promise.promisify(require('xml2js').parseString);
var errors       = require('request-promise/errors');

var rxAuthToken = /authenticationToken="([^"]+)"/;

// creds to https://github.com/mafintosh/to-buffer for knowing when Buffer.from() is available (Node 5 & above)
var makeBuffer = Buffer.from && Buffer.from !== Uint8Array.from ? Buffer.from : createBufferForNode4AndBelow;

function CredentialsAuthenticator(options) {
    EventEmitter.call(this);

    this.username = options.username;
    this.password = options.password;
    this.managedUser = options.managedUser;
}
util.inherits(CredentialsAuthenticator, EventEmitter);

CredentialsAuthenticator.prototype.authenticate = function authenticate(plexApi, callback) {
    var options;

    if (typeof plexApi !== 'object') {
        throw new TypeError('First argument should be the plex-api object to perform authentication for');
    }
    if (typeof callback !== 'function') {
        throw new TypeError('Second argument should be a callback function to be called when authentication has finished');
    }

    options = {
        url: 'https://plex.tv/users/sign_in.xml',
        headers: headers(plexApi, {
            Authorization: authHeaderVal(this.username, this.password)
        })
    };

    return request.post(options)
        .then(xmlBody => {
            let token = extractAuthToken(xmlBody);

            if (!token) {
                throw new Error('Couldnt not find authentication token in response from Plex.tv :(');
            }

            this.emit('token', token);
            return token;
        })
        .catch(errors.StatusCodeError, err => {
            throw new Error('Invalid status code in authentication response from Plex.tv, expected 201 but got ' + err.statusCode);
        })
        .catch(errors.RequestError, err => {
            throw new Error('Error while requesting https://plex.tv for authentication: ' + String(err));
        })
        .then(mainAuthToken => {
            // 'mainAuthToken' represents access token for main PlexHome user,
            // check whether or not we need to fetch token of managed user instead
            const hasManagedUserInfo = !!this.managedUser && !!this.managedUser.name;
            if (!hasManagedUserInfo) {
                return mainAuthToken;
            }

            let plexContext = { plexApi, token: mainAuthToken };

            return fetchHomeUsersXml(plexContext)
                .then(xml  => findUserByName(xml, this.managedUser.name))
                .then(user => switchUser(plexContext, user, this.managedUser.pin))
                .then(extractAuthToken)
                .then(managedAuthToken => fetchAccessToken({ plexApi, token: managedAuthToken }))
                .then(managedAccessToken => {
                    this.emit('token', managedAccessToken);
                    return managedAccessToken;
                });
        })
        .asCallback(callback);
};

function fetchHomeUsersXml(plexContext) {
    return request.get(createRequestOpts(plexContext, 'https://plex.tv/api/home/users'));
}

function createRequestOpts(plexContext, url) {
    return {
        url     : url,
        headers : headers(plexContext.plexApi, { 'X-Plex-Token': plexContext.token })
    };
}

function fetchAccessToken(plexContext, callback) {
    return request.get(createRequestOpts(plexContext, 'https://plex.tv/api/resources?includeHttps=1'))
        .then(parseString)
        .then(extractAccessToken);
}

function extractAccessToken(result) {
    let token = null;
    let hasDevices = result.MediaContainer.Device && result.MediaContainer.Device.some(device => {
        token = device.$.accessToken;
        return true;
    });

    if (hasDevices) {
        return token;
    }

    throw new Error('Couldn\'t find any devices this managed user has access to');
}

function switchUser(plexContext, user, pin, callback) {
    let url = 'https://plex.tv/api/home/users/' + user.id + '/switch?' + (user.protected && pin  ? ('pin=' + pin) : '');
    return request.post(createRequestOpts(plexContext, url));
}

function findUserByName(xml, homeUser) {
    return parseString(xml)
        .then(xmlResult => {
            let foundUser = {
                protected : false,
                name      : null,
                id        : null
            };

            let found = xmlResult.MediaContainer.User.some((user) => {
                if (user.$.title.toLocaleLowerCase() == homeUser.toLocaleLowerCase()) {
                    foundUser.id        = user.$.id;
                    foundUser.name      = user.$.title;
                    foundUser.protected = user.$.protected === '1';
                    return true;
                }
                return false;
            });

            if (found) {
                return foundUser;
            }

            throw new Error('Home user ' + homeUser + ' not found');
        });
}

function extractAuthToken(xmlBody) {
    return xmlBody.match(rxAuthToken)[1];
}

function createBufferForNode4AndBelow(buf, enc) {
    return new Buffer(buf, enc);
}

function authHeaderVal(username, password) {
    var authString = username + ':' + password;
    var buffer = makeBuffer(authString.toString(), 'binary');
    return 'Basic ' + buffer.toString('base64');
}

module.exports = function (options) {
    if (typeof (options) !== 'object') {
        throw new TypeError('An options object containing .username and .password is required');
    }
    if (typeof (options.username) !== 'string') {
        throw new TypeError('Options object requires a .username property as a string');
    }
    if (typeof (options.password) !== 'string') {
        throw new TypeError('Options object requires a .password property as a string');
    }
    return new CredentialsAuthenticator(options);
};
