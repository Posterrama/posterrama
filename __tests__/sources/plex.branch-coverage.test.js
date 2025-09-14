jest.mock('../../utils/logger', () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
}));
const PlexSource = require('../../sources/plex');

describe('PlexSource branch coverage', () => {
    const stub = () => ({});
    const shuffle = a => a;
    const libs = async () => new Map();
    const server = {
        name: 'PlexBranch',
        ratingFilter: ['R', 'G'],
        genreFilter: '',
        qualityFilter: 'SD,720p,unknownXYZ', // include unknown to trigger pass-through
        yearFilter: '1990-2000, 2010',
        recentlyAddedOnly: false,
        recentlyAddedDays: 0,
    };

    test('applyContentFiltering covers year, rating array, quality unknown pass-through', () => {
        const src = new PlexSource(server, stub, stub, libs, shuffle, 0, false);
        const items = [
            { title: 'A', contentRating: 'R', Media: [{ videoResolution: 'sd' }], year: 1995 }, // keep
            {
                title: 'B',
                contentRating: 'PG-13',
                Media: [{ videoResolution: '720p' }],
                year: 1998,
            }, // filtered by rating
            {
                title: 'C',
                contentRating: 'G',
                Media: [{ videoResolution: 'weird' }],
                originallyAvailableAt: '2010-01-01',
            }, // keep due to unknown quality pass-through and 2010 year
            {
                title: 'D',
                contentRating: 'G',
                Media: [{ videoResolution: '' }],
                firstAired: '1985-05-05',
            }, // filtered by year (1985)
        ];
        const out = src.applyContentFiltering(items);
        expect(out.map(x => x.title).sort()).toEqual(['A', 'C']);
    });
});
