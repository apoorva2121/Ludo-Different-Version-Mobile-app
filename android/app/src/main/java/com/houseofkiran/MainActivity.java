package com.houseofkiran;

import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.view.WindowInsets;
import android.graphics.Insets;
import android.graphics.Color;
import android.widget.FrameLayout;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.net.Uri;
import androidx.webkit.WebViewAssetLoader;

/** Bundled, offline-first game with an optional authenticated online service. */
public final class MainActivity extends Activity {
    private WebView webView;

    WebView gameView() { return webView; }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(15, 23, 42));
        getWindow().setNavigationBarColor(Color.rgb(15, 23, 42));
        FrameLayout container = new FrameLayout(this);
        container.setBackgroundColor(Color.rgb(15, 23, 42));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(15, 23, 42));
        container.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        setContentView(container);
        // Android 15 draws edge-to-edge: keep controls above system bars and the keyboard.
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            container.setOnApplyWindowInsetsListener((view, insets) -> {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return insets;
            });
        }

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        // The testing build can reach a LAN HTTP server from the HTTPS asset origin.
        settings.setMixedContentMode(BuildConfig.DEBUG ? WebSettings.MIXED_CONTENT_ALWAYS_ALLOW : WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        CookieManager.getInstance().setAcceptCookie(false);
        webView.addJavascriptInterface(new SecureSessionBridge(new SecureTokenStore(this)), "AndroidSession");
        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
                return !isBundledPage(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String requestUrl) {
                return !isBundledPage(Uri.parse(requestUrl));
            }

            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, android.webkit.WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, String requestUrl) {
                return assetLoader.shouldInterceptRequest(Uri.parse(requestUrl));
            }
        });
        String release = BuildConfig.DEBUG ? "0" : "1";
        String homeUrl = "https://appassets.androidplatform.net/assets/game/House_of_Kiran_AI_Stage3_6_PRODUCTION.html?release=" + release + "&baseUrl=" + Uri.encode(BuildConfig.SERVER_BASE_URL);
        webView.loadUrl(homeUrl);
    }

    private boolean isBundledPage(Uri uri) {
        return "https".equals(uri.getScheme()) && "appassets.androidplatform.net".equals(uri.getHost())
                && uri.getPath() != null && uri.getPath().startsWith("/assets/game/");
    }

    @Override
    public void onBackPressed() {
        webView.evaluateJavascript("Boolean(window.HOKApp && window.HOKApp.handleBack())", handled -> {
            if (!"true".equals(handled)) finish();
        });
    }

    @Override
    protected void onPause() {
        if (webView != null) {
            webView.evaluateJavascript("if(window.HOKApp) window.HOKApp.remember();", null);
            webView.onPause();
            webView.pauseTimers();
        }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) { webView.onResume(); webView.resumeTimers(); }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
        }
        super.onDestroy();
    }
}
