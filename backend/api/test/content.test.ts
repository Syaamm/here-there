import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { contentProblem } from '../src/common/validate';

describe('content rules for titles, descriptions and chat', () => {
  it('lets ordinary text through, including words that only contain a bad word', () => {
    for (const ok of ['After-work aperitivo', 'Coffee near the Duomo', 'Classic cars meetup', 'Scunthorpe football', 'Pasta night, 7 people', 'Sono Assunta, ci vediamo alle 7', 'Un caffè in centro'])
      assert.equal(contentProblem(ok), null, ok);
  });

  it('refuses strong swear words in English and Italian, even with look-alike digits, accents and stretched letters', () => {
    for (const bad of ['what the fuck', 'You are a bitch', 'that is bullshit', 'sei uno stronzo', 'vaffanculo a tutti', 'che cazzo fai', 'sh1t event', 'fuuuuck', 'Merda!', 'CAZZO', 'fùck'])
      assert.equal(contentProblem(bad), 'Please keep the language respectful', bad);
  });

  it('still catches spam links, repetition, shouting, scams and requests for money', () => {
    assert.equal(contentProblem('see www.a.com and https://b.com'), 'Too many links');
    assert.equal(contentProblem('aaaaaaaaaaaa'), 'Spam-like repetition');
    assert.equal(contentProblem('buy now buy now buy now buy now buy now buy now'), 'Spam-like repetition');
    assert.equal(contentProblem('JOIN US TONIGHT FOR A GREAT NIGHT OUT'), 'Please do not write everything in capitals');
    assert.equal(contentProblem('OK GREAT'), null, 'short shouting is fine');
    assert.equal(contentProblem('please send me money'), 'Financial solicitation is not allowed');
    assert.equal(contentProblem('click here for free followers'), 'This looks like spam');
  });
});

describe('suspicious links and requests for money (spec 7.5)', () => {
  it('allows one ordinary link and normal talk about prices', () => {
    for (const ok of ['Here is the menu https://www.trattoria-rossi.it/menu', 'See www.visitlisbon.travel/en', 'Dinner is about 25 euro each, we split at the table', 'Tickets are 12 EUR at the door', 'Call me on +39 333 1234567 when you arrive', 'Taylor Swift tribute night', 'The pizzeria is at via Roma 3', 'Apple pie and coffee'])
      assert.equal(contentProblem(ok), null, ok);
  });
  it('refuses links that hide where they go or imitate a site', () => {
    const cases: [string, RegExp][] = [
      ['book here https://bit.ly/3xyz', /Shortened/],
      ['http://192.168.4.5/login', /number address/],
      ['https://xn--pypal-4ve.com/pay', /look-alike/],
      ['https://google.com@evil.example/', /hides/],
      ['https://secure-paypal-login.net/verify', /imitates/],
      ['https://free-trip.zip/now', /scams/],
      ['javascript:alert(1)', /not allowed/],
    ];
    for (const [text, why] of cases) assert.match(contentProblem(text) ?? '', why, text);
  });
  it('refuses requests to send money, deposits and payment details', () => {
    for (const bad of ['please send me 50 euro first', 'Pay me €20 to hold your spot', 'a deposit is required to reserve', 'transfer the booking fee to my account', 'my paypal.me/anna', 'revolut.me/anna', 'bank transfer only', 'pay by gift card', 'IT60 X054 2811 1010 0000 0123 456', 'card 4111 1111 1111 1111', 'send usdt please', 'wire me some cash'])
      assert.ok(contentProblem(bad), bad);
    assert.equal(contentProblem('please send me money'), 'Financial solicitation is not allowed');
  });
});
