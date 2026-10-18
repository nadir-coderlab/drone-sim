package com.nadir.dronesim;

import android.webkit.JavascriptInterface;

/**
 * Update bridge, exposed to the page as window.NativeUpdate (P8). Methods run on the WebView JavaBridge thread
 * and only hand work over (updater thread / UI thread); they never block on the network.
 *
 *   info()          JSON string: {apkCode, apkName, nativeApi, contentVersion, contentSource:'bundled'|'installed',
 *                   bundledVersion, state, progress, reason, message, lastCheck, lanUrl, sources, releaseKey,
 *                   pending:{content?, apk?, apkName?, notes?}}
 *   check()         look for updates now (results also as toasts when the page has no hook)
 *   applyNow()      switch to downloaded web content right away (reloads the page); false = nothing to apply
 *   setServer(url)  "192.168.1.5", "192.168.1.5:47801", "http://LAN-IP:port/" or "https://host/path/", then check()
 *   installApk()    start installing a downloaded app update; false = none yet (a check is started instead)
 *
 * Events: window.onNativeUpdate(jsonString) with {state:'checking'|'none'|'downloading'|'ready'|'apk-available'|
 * 'installing'|'error', kind:'content'|'apk'|'', version, progress (0..1, -1 = n/a), reason, message (Arabic),
 * manual}. For 'apk-available', returning true from the hook means "the page asks the user itself" and the
 * native dialog is not shown.
 */
public final class NativeUpdate {
    interface Host {
        String updateInfo();
        boolean updateCheck();
        boolean updateApplyNow();
        boolean updateSetServer(String url);
        boolean updateInstallApk();
    }

    private final Host host;

    NativeUpdate(Host host) {
        this.host = host;
    }

    @JavascriptInterface
    public String info() {
        return host.updateInfo();
    }

    @JavascriptInterface
    public boolean check() {
        return host.updateCheck();
    }

    @JavascriptInterface
    public boolean applyNow() {
        return host.updateApplyNow();
    }

    @JavascriptInterface
    public boolean setServer(String url) {
        return host.updateSetServer(url);
    }

    @JavascriptInterface
    public boolean installApk() {
        return host.updateInstallApk();
    }
}
