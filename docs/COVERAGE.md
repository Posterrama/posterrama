# Coverage Report (Per-file)

This table is generated from Istanbul JSON and LCOV after running tests with coverage.
To regenerate: npm run coverage:table

## Files below thresholds

| File                       | Statements % | Branches % | Functions % | Lines % | Threshold status                                                                          |
| -------------------------- | -----------: | ---------: | ----------: | ------: | ----------------------------------------------------------------------------------------- |
| sources/plex.js            |         1.59 |          0 |           0 |    1.77 | statements 1.59% < 68%; branches 0% < 59%; functions 0% < 73%; lines 1.77% < 69%          |
| utils/errors.js            |         1.61 |          0 |           0 |    1.72 | statements 1.61% < 100%; branches 0% < 100%; functions 0% < 100%; lines 1.72% < 100%      |
| utils/array-utils.js       |        16.67 |        100 |           0 |      20 | statements 16.67% < 100%; functions 0% < 100%; lines 20% < 100%                           |
| utils/metrics.js           |        16.67 |       8.65 |       13.79 |   17.53 | statements 16.67% < 88%; branches 8.65% < 79%; functions 13.79% < 94%; lines 17.53% < 88% |
| utils/rating-cache.js      |        22.45 |          0 |          25 |   22.45 | statements 22.45% < 90%; branches 0% < 85%; functions 25% < 90%; lines 22.45% < 90%       |
| middleware/validation.js   |           30 |          0 |          20 |   33.33 | statements 30% < 63%; branches 0% < 50%; functions 20% < 60%; lines 33.33% < 62%          |
| middleware/validate.js     |         31.3 |      18.87 |       21.05 |   32.73 | statements 31.3% < 65%; branches 18.87% < 55%; functions 21.05% < 45%; lines 32.73% < 65% |
| middleware/errorHandler.js |        42.31 |       12.9 |       55.56 |   39.19 | statements 42.31% < 94%; branches 12.9% < 91%; functions 55.56% < 88%; lines 39.19% < 94% |
| middleware/cache.js        |         47.5 |      40.35 |          45 |   48.72 | statements 47.5% < 92%; branches 40.35% < 74%; functions 45% < 89%; lines 48.72% < 93%    |
| middleware/index.js        |        64.21 |      66.04 |          75 |   72.62 | statements 64.21% < 90%; branches 66.04% < 85%; functions 75% < 100%; lines 72.62% < 96%  |
| utils/logger.js            |        67.09 |      35.64 |          55 |   71.23 | branches 35.64% < 38%; functions 55% < 64%                                                |
| middleware/rateLimiter.js  |           80 |         25 |          50 |      80 | statements 80% < 100%; branches 25% < 100%; functions 50% < 100%; lines 80% < 100%        |
| middleware/metrics.js      |        89.74 |      72.09 |          75 |   89.74 | statements 89.74% < 94%; functions 75% < 100%; lines 89.74% < 94%                         |

## Full per-file coverage

| File                          | Statements (cov/total) | Statements % | Branches (cov/total) | Branches % | Functions (cov/total) | Functions % | Lines (cov/total) | Lines % | Meets thresholds |
| ----------------------------- | ---------------------: | -----------: | -------------------: | ---------: | --------------------: | ----------: | ----------------: | ------: | :--------------: |
| utils/ratings.js              |                  1/107 |         0.93 |                 0/46 |          0 |                  0/11 |           0 |             1/104 |    0.96 |                  |
| sources/tmdb.js               |                  4/386 |         1.04 |                0/311 |          0 |                  0/51 |           0 |             4/368 |    1.09 |                  |
| sources/plex.js               |                  6/377 |         1.59 |                0/306 |          0 |                  0/61 |           0 |             6/339 |    1.77 |                  |
| utils/errors.js               |                   1/62 |         1.61 |                 0/64 |          0 |                  0/14 |           0 |              1/58 |    1.72 |                  |
| sources/jellyfin.js           |                  6/272 |         2.21 |                0/264 |          0 |                  0/30 |           0 |             6/256 |    2.34 |                  |
| sources/romm.js               |                  5/157 |         3.18 |                0/352 |          0 |                  0/22 |           0 |             5/147 |     3.4 |                  |
| utils/romm-http-client.js     |                  6/145 |         4.14 |                0/102 |          0 |                  0/16 |           0 |             6/132 |    4.55 |                  |
| utils/wsHub.js                |                 11/219 |         5.02 |                0/138 |          0 |                  0/24 |           0 |            11/218 |    5.05 |                  |
| utils/source-error-context.js |                   2/39 |         5.13 |                 0/31 |          0 |                   0/7 |           0 |              2/38 |    5.26 |                  |
| utils/errorLogger.js          |                   2/38 |         5.26 |                 0/46 |          0 |                  0/14 |           0 |              2/35 |    5.71 |                  |
| utils/configBackup.js         |                  9/159 |         5.66 |                 0/99 |          0 |                  0/15 |           0 |             9/143 |    6.29 |                  |
| utils/source-error-handler.js |                   5/60 |         8.33 |                 0/28 |          0 |                   0/9 |           0 |              5/58 |    8.62 |                  |
| middleware/adminAuth.js       |                   3/29 |        10.34 |                 0/44 |          0 |                   2/5 |          40 |              3/29 |   10.34 |                  |
| utils/deviceStore.js          |                 42/353 |         11.9 |               14/325 |       4.31 |                  6/53 |       11.32 |            40/291 |   13.75 |                  |
| utils/github.js               |                   9/71 |        12.68 |                 0/18 |          0 |                  1/14 |        7.14 |              9/71 |   12.68 |                  |
| utils/request-deduplicator.js |                   9/66 |        13.64 |                 3/17 |      17.65 |                  3/22 |       13.64 |              9/63 |   14.29 |                  |
| utils/userAgent.js            |                   3/20 |           15 |                 0/15 |          0 |                   0/7 |           0 |              3/20 |      15 |                  |
| utils/groupsStore.js          |                  11/70 |        15.71 |                 2/49 |       4.08 |                  0/14 |           0 |             11/60 |   18.33 |                  |
| utils/array-utils.js          |                    1/6 |        16.67 |                  0/0 |        100 |                   0/1 |           0 |               1/5 |      20 |                  |
| utils/metrics.js              |                 67/402 |        16.67 |               18/208 |       8.65 |                 12/87 |       13.79 |            64/365 |   17.53 |                  |
| utils/wsMessageValidator.js   |                   6/35 |        17.14 |                 0/20 |          0 |                   1/8 |        12.5 |              6/34 |   17.65 |                  |
| middleware/testSessionShim.js |                    1/5 |           20 |                  0/6 |          0 |                   0/1 |           0 |               1/5 |      20 |                  |
| utils/rating-cache.js         |                  11/49 |        22.45 |                 0/12 |          0 |                   2/8 |          25 |             11/49 |   22.45 |                  |
| middleware/validation.js      |                   6/20 |           30 |                  0/8 |          0 |                   1/5 |          20 |              6/18 |   33.33 |                  |
| utils/safeFileStore.js        |                 39/125 |         31.2 |                12/41 |      29.27 |                  3/10 |          30 |            39/125 |    31.2 |                  |
| middleware/validate.js        |                 36/115 |         31.3 |                10/53 |      18.87 |                  4/19 |       21.05 |            36/110 |   32.73 |                  |
| config/validators.js          |                   6/15 |           40 |                  1/4 |         25 |                   1/5 |          20 |              6/14 |   42.86 |                  |
| config/environment.js         |                  28/67 |        41.79 |                19/55 |      34.55 |                  5/12 |       41.67 |             28/67 |   41.79 |                  |
| middleware/errorHandler.js    |                  33/78 |        42.31 |                 8/62 |       12.9 |                   5/9 |       55.56 |             29/74 |   39.19 |                  |
| middleware/cache.js           |                  38/80 |         47.5 |                23/57 |      40.35 |                  9/20 |          45 |             38/78 |   48.72 |                  |
| middleware/index.js           |                  61/95 |        64.21 |               70/106 |      66.04 |                 12/16 |          75 |             61/84 |   72.62 |                  |
| middleware/deviceBypass.js    |                  56/86 |        65.12 |                17/46 |      36.96 |                  9/14 |       64.29 |             51/72 |   70.83 |                  |
| utils/auditLogger.js          |                    6/9 |        66.67 |                 0/12 |          0 |                   0/2 |           0 |               6/9 |   66.67 |                  |
| utils/logger.js               |                106/158 |        67.09 |               36/101 |      35.64 |                 22/40 |          55 |           104/146 |   71.23 |                  |
| middleware/user-context.js    |                  21/30 |           70 |                28/46 |      60.87 |                   2/4 |          50 |             21/30 |      70 |                  |
| middleware/rateLimiter.js     |                    4/5 |           80 |                  1/4 |         25 |                   1/2 |          50 |               4/5 |      80 |                  |
| middleware/metrics.js         |                  35/39 |        89.74 |                31/43 |      72.09 |                   3/4 |          75 |             35/39 |   89.74 |                  |
| middleware/asyncHandler.js    |                    3/3 |          100 |                  0/0 |        100 |                   2/2 |         100 |               3/3 |     100 |                  |
| middleware/auth.js            |                    4/4 |          100 |                  0/0 |        100 |                   2/2 |         100 |               3/3 |     100 |                  |
| utils/deep-merge.js           |                  13/13 |          100 |                11/13 |      84.62 |                   2/2 |         100 |             11/11 |     100 |                  |
