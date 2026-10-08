const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ URL });
vm.runInContext(fs.readFileSync('assets/js/news-images.js', 'utf8').replace('export function', 'function') + '; this.resolveImages = newsImageCandidates;', context);
const images = article => Array.from(context.resolveImages(article, 'https://koratv.click', html => ({ querySelectorAll: () => [{ getAttribute: key => key === 'src' ? html : null }] })));
test('RSS enclosure images and thumbnails are preferred over the site logo', () => {
  assert.deepEqual(images({ thumbnail: 'https://publisher.test/first.jpg', enclosure: { link: 'https://publisher.test/second.jpg', type: 'image/jpeg' } }), ['https://publisher.test/first.jpg', 'https://publisher.test/second.jpg']);
  assert.deepEqual(images({ enclosure: { link: 'https://publisher.test/photo.jpg', type: 'image/jpeg' } }), ['https://publisher.test/photo.jpg']);
});
test('description images resolve relative URLs and deduplicate candidates', () => {
  assert.deepEqual(images({ link: 'https://publisher.test/story', thumbnail: '/photo.jpg', content: '/photo.jpg' }), ['https://publisher.test/photo.jpg']);
});
test('unsafe image URLs and video enclosures are rejected', () => {
  assert.deepEqual(images({ thumbnail: 'javascript:alert(1)', image: 'https://secret:password@publisher.test/photo.jpg', enclosure: { link: 'https://publisher.test/video.mp4', type: 'video/mp4' }, content: 'data:text/html,test' }), []);
});
