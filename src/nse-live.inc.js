// Refresh the existing engine; no navigation, replacement form, or extra handlers.
bridge.resultActions = !nseUnfilteredPages.includes(currentPage);
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
        const fields = /*FILTER_CONTROLS*/;
        for(const [key, id] of Object.entries(fields)) {
            const input = document.getElementById(id); if(!input) continue;
            const value = values[key];
            if(value === undefined) continue;
            if(input.type === "checkbox") input.checked = value;
            else input.value = value;
        }
        const colors = {
            backgroundColor:"nseCustomThemeBgCol", backgroundHighlightColor:"nseCustomThemeBgHighCol",
            foregroundColor:"nseCustomThemeForeCol", accentColor:"nseCustomThemeAccentCol",
            highlightColor:"nseCustomThemeHighCol", hiddenBackgroundColor:"nseCustomThemeHiddenBgCol"
        };
        for(const [key,id] of Object.entries(colors)) document.getElementById(id).value = nseCustomTheme[key];
        document.getElementById("nseCustomCSSArea").value = nseCustomCSS.replace(/\\\\/g, "\\");
    }
}
bridge.validateDraft = function() {
    const fields = /*FILTER_CONTROLS*/;
    const data = {};
    for(const [key,id] of Object.entries(fields)) {
        const input = document.getElementById(id); if(!input) continue;
        data[key] = input.type === "checkbox" ? input.checked : key === "nseTimeout" ? Number(input.value) : input.value;
    }
    data.nseCustomTheme = {
        backgroundColor:document.getElementById("nseCustomThemeBgCol").value,
        backgroundHighlightColor:document.getElementById("nseCustomThemeBgHighCol").value,
        foregroundColor:document.getElementById("nseCustomThemeForeCol").value,
        accentColor:document.getElementById("nseCustomThemeAccentCol").value,
        highlightColor:document.getElementById("nseCustomThemeHighCol").value,
        hiddenBackgroundColor:document.getElementById("nseCustomThemeHiddenBgCol").value
    };
    validateNSE(data, epSchema);
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
        if(row.getAttribute("isNSEHidden") === "1" || row.classList.contains("epc-version-hidden")) continue;
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
    const visible = [...document.querySelectorAll("tr.torrent")].filter(row => !row.classList.contains("epc-version-hidden"));
    for(const row of visible) {
        if(row.getAttribute("isNSEHidden") !== "1") row.querySelector(".nseToggleIcon")?.click();
    }
};
if(currentPage === "Torrent details") recolorTags();
