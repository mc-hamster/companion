// Integration bridge; original upstream filtering semantics stay in epFilterRows.
const epSeenRows = new WeakSet(torrents);
bridge.newRows = function(root, rows) {
    if(nseUnfilteredPages.includes(currentPage)) return;
    const selector = currentPage === "Requests" ? "#request_table tr" : "tr.torrent";
    const candidates = new Set(rows || (root.matches(selector) ? [root] : root.querySelectorAll(selector)));
    if(!rows) { const parent = root.closest(selector); if(parent) candidates.add(parent); }
    const fresh = Array.from(candidates).filter(row => !epSeenRows.has(row) &&
        row.querySelector("td > div.tags") && row.querySelector("td > a,td > strong > a"));
    if(!fresh.length) return;
    for(const row of fresh) epSeenRows.add(row);
    epFilterRows(fresh, rows);
    torrents = [...torrents, ...fresh];
    for(const row of fresh) {
        if(nseRightClickManagementEnabled) {
            if(nseRCMTagsEnabled) for(const tag of row.querySelectorAll("div.tags > a")) tag.classList.add("nseTagElement");
            if(nseRCMTitlesEnabled) row.querySelector("td > a,td > strong > a")?.classList.add("nseTitleElement");
            if(nseRCMUploadersEnabled) row.querySelector("td.user > a,td:nth-child(10) > a")?.classList.add("nseUploaderElement");
        }
        if(nseHideCategoryIconsEnabled) {
            const category = row.querySelector("td.cats_col");
            if(category?.nextElementSibling) { category.style.display = "none"; category.nextElementSibling.colSpan = 2; }
        }
        if(nseHardPassEnabled && nseRemoveHardPassResults && row.classList.contains("nseHardPassRemove")) {
            app.detachFilteredRow(row);
        }
    }
    adjustHiddenHeaderCount(count);
    if(nseRenumberTorrentsEnabled && currentPage === "Top 10") renumberTorrents();
};
bridge.flush = saveData;
