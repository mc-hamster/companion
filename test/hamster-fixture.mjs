// Neutral local Hamsterimg pages and an API stub. The key and image data are test-only.
import { escapeHTML } from '../src/core.mjs';
import { HAMSTER_FIXTURE_PATH } from '../src/hamster-media.mjs';
import { forumFixtureScripts } from './forum-fixture.mjs';

const folder = HAMSTER_FIXTURE_PATH;
const testKey = 'chv_fixture_demo_key_only_0123456789';
const profile = folder + 'tester';

function tile(name, index, privacy = 'public', owner = profile) {
  const href = folder + 'images/library-' + index + '.svg';
  const object = { type: 'image', url: href, thumb: { url: href }, title: name, user: { url: owner } };
  return '<article class="list-item" data-type="image" data-media="image" data-privacy="' + privacy +
    '" data-object="' + escapeHTML(encodeURIComponent(JSON.stringify(object))) + '">' +
    '<img src="' + href + '" alt=""><p>' + escapeHTML(name) + '</p></article>';
}

function pageHTML(url) {
  const settings = url.pathname === folder + 'settings/api';
  const albums = url.pathname.endsWith('/albums');
  const masked = url.searchParams.has('masked');
  const content = settings
    ? '<h1>API settings</h1><label>Chevereto API key ' +
      '<input id="api_v1_key" name="api_v1_key" readonly value="' + (masked ? 'chv_fixture_***' : testKey) + '"></label>'
    : albums ? '<h1>My albums</h1><a href="' + folder + 'album/field-notes">Field notes</a>'
      : '<h1>My files</h1><section class="gallery">' + tile('Cloud study', 1) + tile('Field notes', 2, 'private_but_link') +
        tile('Private study', 3, 'private') + tile('Another user’s image', 4, 'public', folder + 'another') + '</section>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="ep-companion-fixture" content="local-test-only"><title>Hamsterimg local fixture</title><style>' +
    'body{background:#f2f6fb;color:#152741;font:15px/1.5 system-ui;margin:24px}a{color:#274f9d}' +
    'header{display:flex;justify-content:space-between;align-items:center}li{list-style:none}.gallery{display:flex;flex-wrap:wrap;gap:12px}' +
    '.gallery img{display:block;width:170px;height:105px;border-radius:8px}.gallery p{margin:3px 0}' +
    '@media(prefers-color-scheme:dark){body{background:#151c28;color:#dce6f8}a{color:#b9cdff}}</style>' + forumFixtureScripts +
    '</head><body><header><strong>Hamsterimg</strong><ul><li id="top-bar-user" data-nav="user"><div class="pop-box-menu">' +
    '<a href="' + profile + '"><span class="fas fa-id-card"></span>Test account</a> · ' +
    '<a href="' + profile + '"><span class="fas fa-photo-film"></span>Files</a> · ' +
    '<a href="' + profile + '/albums"><span class="fas fa-images"></span>Albums</a></div></li></ul></header>' +
    '<main>' + content + '</main></body></html>';
}

export function createHamsterFixture() {
  let uploaded = 0;
  return async (req, res, url) => {
    if (!url.pathname.startsWith(folder)) return false;
    const path = url.pathname.slice(folder.length);
    res.setHeader('Cache-Control', 'no-store');
    if (path === 'api/1/upload' && req.method === 'POST') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf8');
      const filename = /name="source"; filename="([^"]+)"/.exec(body)?.[1];
      const keyOK = req.headers['x-api-key'] === testKey && !url.search && !body.includes(testKey);
      const status = !keyOK ? 403 : !filename ? 400 : filename.startsWith('too-large') ? 413 : 200;
      const href = new URL(folder + 'images/upload-' + (status === 200 ? ++uploaded : uploaded) + '.svg', url).href;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status === 200
        ? { status_code: 200, image: { type: 'image', title: filename, url: href, thumb: { url: href } } }
        : { status_code: status }));
    } else if (/^images\/(?:library|upload)-\d+\.svg$/.test(path)) {
      res.setHeader('Content-Type', 'image/svg+xml');
      res.end('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="150"><rect width="240" height="150" rx="11" fill="#234c92"/><circle cx="175" cy="46" r="19" fill="#dbe8fa"/><path d="M0 150L72 60l60 65 40-40 68 65z" fill="#8bb7ec"/></svg>');
    } else {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(pageHTML(url));
    }
    return true;
  };
}
