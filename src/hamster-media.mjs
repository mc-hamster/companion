// SPDX-License-Identifier: GPL-3.0-or-later
import { COMPANION_HOSTS } from './core.mjs';
import { safeForumMediaURL } from './forum-bbcode.mjs';

export const HAMSTER_ORIGIN = 'https://hamsterimg.net';
export const HAMSTER_FIXTURE_PATH = '/forum-hamster/';
export const HAMSTER_JOB_PREFIX = 'ep.forum.hamster.request.';
export const HAMSTER_PICKER_SESSION = 'ep.forum.hamster.picker';
export const HAMSTER_PICKER_HASH = 'companion-media';
export const HAMSTER_SELECTION_LIMIT = 50;
const jobLifetime = 60 * 60 * 1000;
const validID = /^[1-9]\d{0,14}$/;
const validInlineContext = /^(?:topic|edit)\.[1-9]\d{0,14}$/;
const validTorrentContext = /^torrent\.[1-9]\d{0,14}\.(?:comment|edit\.[1-9]\d{0,14})$/;

function validComposer(job) {
  return job.context === undefined ? validID.test(job.thread || '') :
    job.thread === undefined && typeof job.context === 'string' &&
      (validInlineContext.test(job.context) || validTorrentContext.test(job.context));
}
const validNonce = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function hamsterServiceBase(page, fixture = false) {
  return fixture ? new URL(HAMSTER_FIXTURE_PATH, page) : new URL(HAMSTER_ORIGIN + '/');
}

export function hamsterAccountKey(origin, account) {
  return 'ep.forum.hamster.key.' + origin + '.' + account;
}

export function hamsterKey(value) {
  if (typeof value !== 'string') return '';
  const key = value.trim();
  return /^(?:chv_[a-zA-Z0-9_-]{16,240}|[0-9a-fA-F]{32}|[0-9a-fA-F]{64})$/.test(key) ? key : '';
}

export function readHamsterRequest(storage, id, service, now = Date.now()) {
  if (!validNonce.test(id || '')) return null;
  try {
    const job = storage.get(HAMSTER_JOB_PREFIX + id, null);
    if (!job || !['connect', 'browse'].includes(job.action) || !validID.test(job.account || '') ||
      !validComposer(job) || !Number.isFinite(job.started) || now - job.started > jobLifetime ||
      job.started > now || !URL.canParse(job.origin)) return null;
    const origin = new URL(job.origin);
    if (origin.origin !== job.origin) return null;
    const tracker = origin.protocol === 'https:' && COMPANION_HOSTS.includes(origin.hostname);
    const fixture = service.pathname === HAMSTER_FIXTURE_PATH && origin.origin === service.origin;
    return tracker || fixture ? job : null;
  } catch { return null; }
}

export function cleanupHamsterRequests(storage, now) {
  for (const key of storage.list()) {
    if (!key.startsWith(HAMSTER_JOB_PREFIX)) continue;
    const started = storage.get(key, null)?.started;
    if (!Number.isFinite(started) || now - started > jobLifetime) storage.delete(key);
  }
}

export function hamsterPageURL(value, service) {
  if (typeof value !== 'string' || !value || !URL.canParse(value, service)) return null;
  const url = new URL(value, service);
  return url.origin === service.origin && !url.username && !url.password && url.pathname.startsWith(service.pathname) ? url : null;
}

export function hamsterAssetURL(value, service) {
  if (typeof value !== 'string' || !value || !URL.canParse(value, service)) return '';
  const url = new URL(value, service);
  if (!safeForumMediaURL(url.href)) return '';
  if (service.pathname === HAMSTER_FIXTURE_PATH) return hamsterPageURL(url.href, service)?.href || '';
  return url.protocol === 'https:' && !url.port &&
    ['hamsterimg.net', 'hamster.is'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))
    ? url.href : '';
}

export function hamsterImage(value, service) {
  const href = hamsterAssetURL(value?.href, service);
  if (!href) return null;
  return {
    href, thumbnail: hamsterAssetURL(value.thumbnail, service) || href,
    name: typeof value.name === 'string' ? value.name.trim().slice(0, 120) || 'Image' : 'Image'
  };
}

export function hamsterGalleryImage(tile, service, profile) {
  // Chevereto attaches image URL, ownership, and preview metadata to its gallery tiles.
  const raw = tile.getAttribute('data-object');
  if (!raw || !['', 'public', 'private_but_link'].includes(tile.getAttribute('data-privacy') || '')) return null;
  let data;
  try { data = JSON.parse(raw.startsWith('{') ? raw : decodeURIComponent(raw)); } catch { return null; }
  if (data?.type !== 'image' || (tile.dataset.media && tile.dataset.media !== 'image')) return null;
  const owner = hamsterPageURL(data.user?.url, service);
  if (!owner || owner.pathname.replace(/\/$/, '') !== profile.pathname.replace(/\/$/, '') ||
    owner.search !== profile.search) return null;
  return hamsterImage({
    href: data.url || data.image?.url, thumbnail: data.thumb?.url || tile.getAttribute('data-thumb'),
    name: data.title || data.name || tile.dataset.title
  }, service);
}

function uploadFailure(status) {
  let message = 'The upload could not be confirmed. Check My images before retrying.';
  if (status === 401 || status === 403) message = 'Hamsterimg rejected the key or upload permission. Check your connection.';
  else if (status === 413) message = 'This file exceeds Hamsterimg’s upload limit.';
  else if (status === 429) message = 'Hamsterimg is limiting uploads. Try again in a moment.';
  else if (status >= 400 && status < 500) message = 'Hamsterimg rejected this file.';
  return Object.assign(new Error(message), { status });
}

function uploadResult(response, service, endpoint, name) {
  const { finalUrl, status } = response;
  if (finalUrl && new URL(finalUrl, endpoint).href !== endpoint.href) throw new Error('Hamsterimg returned an unexpected upload address.');
  if (status < 200 || status >= 300) throw uploadFailure(status);
  let data = response.response;
  if (typeof data !== 'object' || !data) {
    try { data = JSON.parse(response.responseText); } catch {}
  }
  const code = Number(data?.status_code || status);
  if (code < 200 || code >= 300) throw uploadFailure(code);
  const item = data?.image;
  const image = hamsterImage({ href: item?.url, thumbnail: item?.thumb?.url, name: item?.title || name }, service);
  if (!image || (item.type && item.type !== 'image')) throw new Error('Hamsterimg did not return an image link.');
  return image;
}

export async function uploadHamsterImage({ win, service, request, key, file, signal, progress = () => {} }) {
  const endpoint = new URL('api/1/upload', service);
  const body = new win.FormData();
  body.append('source', file, file.name);
  const headers = { 'X-API-Key': key };
  if (signal.aborted) throw new Error('Upload stopped.');
  if (service.pathname === HAMSTER_FIXTURE_PATH && win.location.origin === service.origin) {
    const response = await win.fetch(endpoint.href, { method: 'POST', body, headers, signal, redirect: 'error' });
    return uploadResult({ status: response.status, finalUrl: response.url, responseText: await response.text() }, service, endpoint, file.name);
  }
  if (!request) throw new Error('The userscript manager could not start an upload to Hamsterimg.');
  return new Promise((resolve, reject) => {
    let operation;
    const finish = callback => value => {
      signal.removeEventListener('abort', abort);
      callback(value);
    };
    const interrupted = finish(() => reject(uploadFailure(0)));
    function abort() {
      operation?.abort?.();
      interrupted();
    }
    signal.addEventListener('abort', abort, { once: true });
    try {
      operation = request({
        method: 'POST', url: endpoint.href, headers, data: body, responseType: 'json', timeout: 90000,
        anonymous: true, redirect: 'error',
        upload: { onprogress: event => {
          if (event.lengthComputable && event.total > 0) progress(event.loaded / event.total);
        } },
        onload: finish(response => {
          try { resolve(uploadResult(response, service, endpoint, file.name)); } catch (error) { reject(error); }
        }),
        onerror: interrupted, ontimeout: interrupted, onabort: interrupted
      });
      if (signal.aborted) abort();
    } catch { interrupted(); }
  });
}
