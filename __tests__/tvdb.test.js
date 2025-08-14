const axios = require('axios');
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));
jest.mock('../logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
const TVDBSource = require('../sources/tvdb');

describe('TVDBSource smoke', () => {
  const cfg = { enabled:true, showCount:2, movieCount:2, category:'popular', minRating:0 };
  let src;
  beforeEach(()=>{ jest.clearAllMocks(); src = new TVDBSource(cfg); });
  const auth = (t='tok') => axios.post.mockResolvedValueOnce({ data:{ data:{ token:t } } });

  test('authenticate caches token', async () => { auth('a'); await src.authenticate(); const c=axios.post.mock.calls.length; await src.authenticate(); expect(axios.post).toHaveBeenCalledTimes(c); });
  test('authenticate failure', async () => { axios.post.mockRejectedValueOnce(new Error('auth fail')); await expect(src.authenticate()).rejects.toThrow(/auth fail/); });
  test('getShows error returns []', async () => { auth(); axios.get.mockRejectedValueOnce(new Error('series fail')); const r = await src.getShows(); expect(r).toEqual([]); });
  test('extractYear', () => { expect(src.extractYear('2023-01-02')).toBe(2023); expect(src.extractYear('bad')).toBeNull(); });
  test('getImageUrl', () => { expect(src.getImageUrl('/x.jpg')).toBe('https://artworks.thetvdb.com/x.jpg'); expect(src.getImageUrl('http://a/b.jpg')).toBe('http://a/b.jpg'); expect(src.getImageUrl(null)).toBeNull(); });
});
