# plex-api-credentials [![Build Status](https://api.travis-ci.org/phillipj/node-plex-api-credentials.png)](http://travis-ci.org/phillipj/node-plex-api-credentials)

[plex-api](https://www.npmjs.com/package/plex-api) authenticator module which provides PlexHome credentials authentication.

*It's usually not required to install and handle this package explicitly, as username/password/managed user credentials
can be specified when creating an plex-api client.*

## Usage

```bash
$ npm install plex-api-credentials --save
```

Then provide the plex-api-credentials object to the plex-api client upon creation:

```js
const PlexAPI = require('plex-api');
const credentials = require('plex-api-credentials');

const userAndPass = credentials({
    username: 'MainParentUser',
    password: 'aSecretPassword',
    managedUser: {    // Required for Plex managed users
        name: 'RestrictedFamilyMember',
        pin: '1234' // Optional four digit pin code if user is protected
    }
});

const client = new PlexAPI({
    hostname: '192.168.0.1',
    authenticator: userAndPass
});

// use PlexAPI client as usual
client.find('/library/sections', ...);
```

## Events

### `token`

Emitted whenever a token has been retrieved from plex.tv.

### Usage

```js
userAndPass.on('token', function(token){
    // possibly cache retrieved token here?
});
```

## Contributing

Contributions are more than welcome! Create an issue describing what you want to do.
If that feature is seen to fit this project, send a pull request with the changes accompanied by tests.

### Running tests

```bash
$ npm install
$ npm test
```

To run all tests as soon as files or tests has been changed:

```bash
$ npm run test:watch
```

## Changelog

### v3.0.0

- Support for managed users by [@hyperlink](https://github.com/hyperlink)

**BREAKING CHANGES:**
- Requires at least Node.js v4.0
- `constructor(username, password)` -> `constructor(options)` <br>
    Previously the constructor accepted two simple string arguments,
        this has been changed to accepting a complex options object.

### v2.0.0

- Use plex-api-headers for generating X-Plex headers
- Changed .authenticate(apiOptions) -> .authenticate(plexApi)

### v1.0.0

Initial release. Pretty much extracted as was when the code once existed in the plex-api module itself.

## License
(The MIT License)

Copyright (c) 2015-2016 Phillip Johnsen &lt;johphi@gmail.com&gt;

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.