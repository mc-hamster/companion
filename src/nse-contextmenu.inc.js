if(currentPage !== "Notification filters") {
    document.addEventListener("contextmenu", function(event) {
        if(event.defaultPrevented || event.shiftKey || !nseRightClickManagementEnabled) return;
        const target = event.target.closest(".nseTagElement,.nseUploaderElement,div.tags>a,ul#torrent_tags_list>li>a,tr.torrent td.user>a");
        if(!target) return;
        const copy = target.cloneNode(true);
        for(const annotation of copy.querySelectorAll("color")) annotation.remove();
        const kind = target.matches(".nseTagElement,div.tags>a,ul#torrent_tags_list>li>a") ? "tag" : "uploader";
        if(kind === "tag" && !nseRCMTagsEnabled || kind === "uploader" && !nseRCMUploadersEnabled) return;
        event.preventDefault();
        showRCMBox(kind, copy.textContent.trim(), event.pageX, event.pageY);
        app.adoptRuleMenu(event, kind, copy.textContent.trim());
    });
    document.getElementById("nseRCMClose").onclick = function() {
        this.parentNode.classList.add("hidden");
    };
}
