(function setPaneFavicon() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) {
        return;
    }
    const href = chrome.runtime.getURL('icon/32.png');
    for (const rel of ['icon', 'shortcut icon', 'apple-touch-icon']) {
        let link = document.querySelector(`link[rel="${rel}"]`);
        if (!link) {
            link = document.createElement('link');
            link.rel = rel;
            document.head.appendChild(link);
        }
        link.type = 'image/png';
        link.href = href;
    }
})();
