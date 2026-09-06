package com.houseofkiran;

import android.webkit.JavascriptInterface;

/** Restricted session-token bridge for the bundled appassets page. */
public final class SecureSessionBridge {
    private final SecureTokenStore tokenStore;

    public SecureSessionBridge(SecureTokenStore tokenStore) {
        this.tokenStore = tokenStore;
    }

    @JavascriptInterface
    public String getToken() {
        try {
            String token = tokenStore.get();
            return token == null ? "" : token;
        } catch (Exception ignored) {
            return "";
        }
    }

    @JavascriptInterface
    public void putToken(String token) {
        if (token == null || token.length() > 4096) return;
        try {
            tokenStore.put(token);
        } catch (Exception ignored) {
            // Keep keystore details out of the WebView.
        }
    }

    @JavascriptInterface
    public void clearToken() {
        tokenStore.clear();
    }
}
