chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'openSettingsWindow') {
        chrome.windows.create({
            url: chrome.runtime.getURL('popup.html'),
            type: 'popup',
            width: 420,
            height: 720,
            focused: true
        }, () => {
            sendResponse({ success: !chrome.runtime.lastError });
        });
        return true;
    }
});
