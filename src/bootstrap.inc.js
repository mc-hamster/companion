const epPage = new URL(location.href);
const epHost = epPage.protocol === 'https:' && COMPANION_HOSTS.includes(epPage.hostname);
const epFixture = ['127.0.0.1', 'localhost'].includes(epPage.hostname) &&
  Boolean(document.querySelector('meta[name="ep-companion-fixture"][content="local-test-only"]'));
const epHamster = epPage.origin === /*HAMSTER_ORIGIN*/ ||
  (epFixture && epPage.pathname.startsWith(/*HAMSTER_FIXTURE_PATH*/));
if (epHamster) {
  let pending = new URLSearchParams(epPage.hash.slice(1)).has(/*HAMSTER_PICKER_HASH*/);
  if (!pending) {
    try { pending = Boolean(sessionStorage.getItem(/*HAMSTER_PICKER_SESSION*/)); } catch {}
  }
  if (!pending) return;
} else if ((!epHost && !epFixture) || !isCompanionPage(epPage)) return;

const epStyle = /*COMPANION_CSS*/;
const epForumStyle = /*FORUM_CSS*/;
const epStorage = {
  get: (key, fallback) => GM_getValue(key, fallback),
  set: (key, value) => GM_setValue(key, value),
  list: () => GM_listValues(),
  delete: key => GM_deleteValue(key),
  watch: (key, fn) => {
    if (typeof GM_addValueChangeListener !== 'function' || typeof GM_removeValueChangeListener !== 'function') return null;
    const id = GM_addValueChangeListener(key, fn);
    return () => GM_removeValueChangeListener(id);
  }
};
const epRequest = typeof GM_xmlhttpRequest === 'function' ? details => GM_xmlhttpRequest(details) : null;

const epForum = companionForumPage(epPage);
if (epForum || epHamster) {
  const startForum = () => {
    const bundle = epLoadForum();
    const addStyle = css => GM_addStyle(css);
    const service = bundle.hamsterServiceBase(epPage, epFixture);
    if (epHamster) bundle.mountHamsterPicker(window, epStorage, service, addStyle, epStyle + epForumStyle);
    else {
      const forum = bundle.mountCompanionForum(window, epStorage, epPage, epForum, addStyle, epStyle + epForumStyle,
        { service, request: epRequest });
      if (forum && typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand('Companion settings', () => {
          forum.openSettings();
          forum.workspace.root.scrollIntoView({ block: 'start' });
        });
      }
    }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startForum, { once: true });
  else startForum();
  return;
}

// The account header arrives before the covers. Start there to keep the early
// image gate, and check for browsing markup once parsing ends on other layouts.
const epAccountNav = '#userinfo_username a[href*="user.php?id="],a.username[href*="user.php?id="]';
if (epFixture || document.readyState !== 'loading' || document.querySelector(epAccountNav)) {
  epStart();
} else {
  const observer = new MutationObserver(() => {
    if (document.querySelector(epAccountNav)) ready();
  });
  function ready() {
    observer.disconnect();
    document.removeEventListener('DOMContentLoaded', ready);
    epStart();
  }
  observer.observe(document, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', ready, { once: true });
}

function epStart() {
  if (document.querySelector('body#login,#loginform,form[action="/login.php"],input[type="password"]')) return;
  if (!epFixture && !document.querySelector(epAccountNav +
    ',#search_form,table.torrent_table,.torrent_grid,#request_table,#collages,textarea.long[name="tags"]')) return;
  // The document is shared by userscript sandboxes.
  const epRunningEvent = 'ep-companion:running';
  if (!document.dispatchEvent(new Event(epRunningEvent, { cancelable: true }))) return;
  const epSchema = /*NSE_SCHEMA*/;
  GM_addStyle(epStyle);
  const epBridge = {};
  function epRunNSE(app) {
    const run = () => app.batchDOM(() => {
      try {
        if (isNSEPage(epPage)) epNSEEngine(app, epBridge);
      } catch { app.report('Filters could not start on this page. Reload the page and try again.'); }
      finally { app.adoptEngine(); app.filtersFinished(); }
    });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
    else run();
  }
  const epApp = createApp(window, epStorage, {
    waitForFilters: true, startNSE: epRunNSE,
    requestImage: epRequest,
    empTemplate: epHost ? {
      nseSchema: epSchema,
      prompt: window.prompt?.bind(window),
      copyPassphrase: typeof GM_setClipboard === 'function' ? text => GM_setClipboard(text, 'text') : null
    } : null,
    localImageCache: !!epFixture,
    newRows: (root, rows) => epBridge.newRows?.(root, rows),
    flushNSE: () => epBridge.flush?.(),
    refreshFilters: syncInputs => epBridge.refresh?.(syncInputs),
    validateDraftFilters: () => epBridge.validateDraft?.(),
    openVisible: () => epBridge.openVisible?.(),
    hideVisible: () => epBridge.hideVisible?.(),
    resultActionsAvailable: () => epBridge.resultActions,
    addStyle: css => GM_addStyle(css),
    validateNSE: input => validateNSE(input, epSchema)
  }).start();
  document.addEventListener(epRunningEvent, event => event.preventDefault());
  GM_registerMenuCommand('Companion settings', () => {
    epApp.openPane('settings'); epApp.root?.scrollIntoView({ block: 'start' });
  });
  function epNSEEngine(app, bridge) {
    // NSE can only enumerate/delete its own settings, so its Reset and Export
    // controls cannot accidentally erase saved searches or image preferences.
    const GM_info = { script: { version: '2.8.2' } };
    const GM_listValues = () => epStorage.list().filter(key => Object.hasOwn(epSchema, key));
    const GM_deleteValue = key => { if(Object.hasOwn(epSchema, key)) epStorage.delete(key); };
    const GM_getValue = (key, fallback) => {
      const value = epStorage.get(key, NSE_EMPTY_LISTS.includes(key) ? '' : fallback);
      try { return validateNSE({ [key]: value }, epSchema)[key]; }
      catch { return NSE_EMPTY_LISTS.includes(key) ? '' : fallback; }
    };
    const GM_setValue = (key, value) => {
      const checked = validateNSE({ [key]: value }, epSchema);
      epStorage.set(key, checked[key]);
    };
    /*NSE_BODY*/
  }
}
