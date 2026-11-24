// Refresh the existing engine; no navigation, replacement form, or extra handlers.
bridge.resultActions = !nseUnfilteredPages.includes(currentPage);
const epFilterFields = /*FILTER_CONTROLS*/;
const epThemeFields = {
    backgroundColor:"nseCustomThemeBgCol", backgroundHighlightColor:"nseCustomThemeBgHighCol",
    foregroundColor:"nseCustomThemeForeCol", accentColor:"nseCustomThemeAccentCol",
    highlightColor:"nseCustomThemeHighCol", hiddenBackgroundColor:"nseCustomThemeHiddenBgCol"
};
const epFilterListBases = new Map(NSE_EMPTY_LISTS.map(key => [key, document.getElementById(epFilterFields[key]).value]));
function epListValues(key, value) {
    const separator = key.endsWith("Titles") ? ";" : /\s+/;
    return [...new Set(value.toLowerCase().split(separator).map(part => part.trim()).filter(Boolean))].sort();
}
function epReloadFilterPreferences(syncInputs) {
    /*FILTER_READERS*/
    nseBlacklistTags = nseBlacklistTaglist.trim().split(/\s+/).filter(Boolean);
    nseHardPassTags = nseHardPassTaglist.trim().split(/\s+/).filter(Boolean);
    nseWhitelistTags = nseWhitelistTaglist.trim().split(/\s+/).filter(Boolean);
    nseBlacklistTitlePhrases = nseBlacklistTitleList.split(";").filter(Boolean);
    nseHardPassTitlePhrases = nseHardPassTitleList.split(";").filter(Boolean);
    nseWhitelistTitlePhrases = nseWhitelistTitleList.split(";").filter(Boolean);
    nseBlacklistUploaders = nseBlacklistUploadersList.split(/\s+/).filter(Boolean);
    nseWhitelistUploaders = nseWhitelistUploadersList.split(/\s+/).filter(Boolean);
    nseCustomTheme.hiddenBackgroundColor ||= "#aaf";
    themes.nseThemeCustom = {...nseCustomTheme};
    if(syncInputs) {
        const values = /*FILTER_VALUES*/;
        for(const [key, id] of Object.entries(epFilterFields)) {
            const input = document.getElementById(id); if(!input) continue;
            const value = values[key];
            if(value === undefined) continue;
            if(epFilterListBases.has(key)) {
                epFilterListBases.set(key, value);
                // Keep a trailing separator or in-progress typing if the saved terms match the draft.
                if(input === document.activeElement && samePreference(epListValues(key, input.value), epListValues(key, value))) continue;
            }
            if(input.type === "checkbox") input.checked = value;
            else input.value = value;
        }
        for(const [key,id] of Object.entries(epThemeFields)) document.getElementById(id).value = nseCustomTheme[key];
        document.getElementById("nseCustomCSSArea").value = nseCustomCSS.replace(/\\\\/g, "\\");
    }
}
bridge.syncInputs = () => epReloadFilterPreferences(true);
bridge.readFilterDraft = function(edited) {
    const data = {};
    for(const [key,id] of Object.entries(epFilterFields)) {
        if(!edited.has(id)) continue;
        const input = document.getElementById(id);
        if(epFilterListBases.has(key)) {
            const base = new Set(epListValues(key, epFilterListBases.get(key)));
            const draft = new Set(epListValues(key, input.value));
            const stored = new Set(epListValues(key, GM_getValue(key)));
            for(const value of base) if(!draft.has(value)) stored.delete(value);
            for(const value of draft) if(!base.has(value)) stored.add(value);
            data[key] = [...stored].sort().join(key.endsWith("Titles") ? ";" : " ");
        } else if(key === "nseCustomCSS") data[key] = input.value.replace(/\\/g, "\\\\");
        else data[key] = input.type === "checkbox" ? input.checked : key === "nseTimeout" ? Number(input.value) : input.value;
    }
    for(const [key,id] of Object.entries(epThemeFields)) if(edited.has(id)) {
        data.nseCustomTheme ??= {...GM_getValue("nseCustomTheme", nseCustomTheme)};
        data.nseCustomTheme[key] = document.getElementById(id).value;
    }
    return validateNSE(data, epSchema);
};
bridge.refresh = function(syncInputs = false) {
    epReloadFilterPreferences(syncInputs);
    app.restoreFilterBaseline();
    count = 0;
    torrents = document.querySelectorAll(currentPage === "Requests" ? "#request_table tr" : "tr.torrent");
    for(const row of torrents) epSeenRows.add(row);
    epFilterRows(torrents);
    if(currentPage === "Torrent details") recolorTags();
    if(nseHideCategoryIconsEnabled) for(const category of document.querySelectorAll(".cats_col,.cats_cols")) {
        if(category.nextElementSibling) category.nextElementSibling.colSpan = 2;
        category.style.display = "none";
    }
    if(nseHardPassEnabled && nseRemoveHardPassResults) {
        for(const row of document.querySelectorAll("tr.nseHardPassRemove")) app.detachFilteredRow(row);
    }
    if(!nseUnfilteredPages.includes(currentPage)) adjustHiddenHeaderCount(count);
    if(nseRenumberTorrentsEnabled && currentPage === "Top 10") renumberTorrents();
    app.syncGridFilters();
    app.schedule(document.querySelector("#content") || document.body);
};
bridge.openVisible = function() {
    if(nseUnfilteredPages.includes(currentPage)) return;
    const visited = new Set();
    for(const row of document.querySelectorAll(currentPage === "Requests" ? "#request_table tr" : "tr.torrent")) {
        if(row.getAttribute("isNSEHidden") === "1" || row.matches(".epc-version-hidden,.epc-filter-hidden")) continue;
        const title = row.querySelector(currentPage === "Collage" ? "td > strong > a" : "td > a");
        if(!title?.href) continue;
        const url = new URL(title.href, location.href);
        if(url.origin !== location.origin || !["/torrents.php","/requests.php"].includes(url.pathname) ||
           url.searchParams.get("action") === "download" || visited.has(url.href)) continue;
        visited.add(url.href); window.open(url.href,"_blank");
    }
    if(nseOpenAllGoNextEnabled) nseGoForward();
};
bridge.hideVisible = function() {
    if(!confirm("Hide the results currently shown? You can restore them with Undo changes.")) return;
    const visible = document.querySelectorAll("tr.torrent:not(.epc-version-hidden,.epc-filter-hidden)");
    for(const row of visible) {
        if(row.getAttribute("isNSEHidden") !== "1") row.querySelector(".nseToggleIcon")?.click();
    }
};
if(currentPage === "Torrent details") recolorTags();
