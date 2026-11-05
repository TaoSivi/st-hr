import { describe, expect, it } from 'vitest';
import { searchPlaces } from './geo';

const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('searchPlaces', () => {
  it('turns the answer into names with coordinates, and drops rows without a usable point', async () => {
    const found = await searchPlaces('ວຽງຈັນ', reply([
      { display_name: 'ວຽງຈັນ, ລາວ', lat: '17.9757', lon: '102.6331' },
      { display_name: 'no point', lat: 'x', lon: '1' },
      { display_name: 'too far', lat: '120', lon: '1' },
      { lat: '1', lon: '1' }
    ]));
    expect(found).toEqual([{ name: 'ວຽງຈັນ, ລາວ', lat: 17.9757, lng: 102.6331 }]);
  });
  it('asks for the words typed, encoded, and nothing else', async () => {
    let seen = '';
    await searchPlaces('a b&c', (async (u: string) => { seen = u; return new Response('[]'); }) as unknown as typeof fetch);
    expect(seen).toContain('q=a%20b%26c');
    expect(seen.startsWith('https://nominatim.openstreetmap.org/search?')).toBe(true);
  });
  it('refuses a search that is too short before asking anyone', async () => {
    await expect(searchPlaces(' a ', reply([]))).rejects.toThrow('ຍາວ');
  });
  it('says so when the service is busy, down, or the network fails', async () => {
    await expect(searchPlaces('xx', reply({}, 429))).rejects.toThrow('ຖີ່');
    await expect(searchPlaces('xx', reply({}, 500))).rejects.toThrow('ລອງໃໝ່');
    await expect(searchPlaces('xx', (async () => { throw new TypeError('x'); }) as unknown as typeof fetch)).rejects.toThrow('ອິນເຕີເນັດ');
    await expect(searchPlaces('xx', reply({ not: 'a list' }))).rejects.toThrow('ລອງໃໝ່');
  });
});
