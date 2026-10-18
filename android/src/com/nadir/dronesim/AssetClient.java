package com.nadir.dronesim;

import android.content.res.AssetManager;
import android.net.Uri;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Collections;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Serves https://appassets.androidplatform.net/assets/** - a hand-written equivalent of androidx
 * WebViewAssetLoader, so no AAR is needed. A real https origin (not file://) keeps localStorage, fetch() and
 * WebGL texture loads working, and the origin never changes between the APK's own files and an installed
 * update, so the progress in localStorage survives every update.
 *
 * Files come from Host.contentRoot(): an installed update folder (filesDir/updates/content/&lt;ver&gt;/, every path
 * checked to stay inside it after canonicalisation) or, when that is null, the APK's assets/ folder.
 * Other hosts: https goes to the network as usual (three.js CDN fallback); plain http and other schemes are
 * refused unless the build is debuggable (LAN dev server). Also keeps top-level navigation inside the app.
 */
class AssetClient extends WebViewClient {
    static final String TAG = "DroneSim";
    static final String HOST = "appassets.androidplatform.net";
    static final String PREFIX = "/assets/";

    interface Host {
        /** The WebView's renderer died; the host must drop that WebView and may build a new one. */
        void onRendererGone(WebView view, boolean crashed);
        /** A main-frame load failed (e.g. LAN dev server down). */
        void onMainFrameError(WebView view, String url, String description);
        /** A page finished loading (main frame). */
        void onPageFinished(WebView view, String url);
        /** "scheme://host[:port]" of the dev server, or null in normal use. */
        String devOrigin();
        /** Installed web content to serve, or null for the APK's own assets. Called on WebView IO threads. */
        Root contentRoot();
        /** Debuggable builds only: plain-http loads allowed (LAN dev server). */
        boolean allowCleartext();
    }

    /** An installed content folder plus its canonical path (computed once). */
    static final class Root {
        final File dir;
        final String canon; // ends with File.separator

        Root(File dir) throws IOException {
            this.dir = dir;
            this.canon = dir.getCanonicalPath() + File.separator;
        }
    }

    private static final Map<String, String> HEADERS;
    static {
        Map<String, String> h = new HashMap<String, String>();
        h.put("Cache-Control", "no-cache");
        h.put("Access-Control-Allow-Origin", "*");
        HEADERS = Collections.unmodifiableMap(h);
    }
    private static final byte[] EMPTY = new byte[0];

    private final AssetManager assets;
    final Host host;

    AssetClient(AssetManager assets, Host host) {
        this.assets = assets;
        this.host = host;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
        Uri u = req.getUrl();
        if (u == null) return refused();
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
        if (!HOST.equalsIgnoreCase(u.getHost())) {
            if (isAllowedExternal(scheme, host.allowCleartext())) return null; // normal network load
            Log.w(TAG, "refused insecure load " + u);
            return refused();
        }
        if (!"https".equals(scheme) || !"GET".equalsIgnoreCase(req.getMethod())) return notFound();
        String path = u.getPath(); // already percent-decoded, no query / fragment
        if (path == null || !path.startsWith(PREFIX)) return notFound();
        String rel = path.substring(PREFIX.length());
        if (rel.length() == 0 || rel.endsWith("/")) rel = rel + "index.html";
        if (rel.contains("..") || rel.startsWith("/") || rel.indexOf('\\') >= 0 || rel.indexOf('\0') >= 0) return notFound();
        try {
            Root root = host.contentRoot();
            InputStream in = root == null ? assets.open(rel, AssetManager.ACCESS_STREAMING) : openInstalled(root, rel);
            if (in == null) return notFound();
            String mime = mimeFor(rel);
            WebResourceResponse r = new WebResourceResponse(mime, isText(mime) ? "utf-8" : null, in);
            r.setResponseHeaders(HEADERS);
            return r;
        } catch (IOException e) {
            return notFound();
        }
    }

    /** https always; http only in debuggable builds; data:/blob:/about: never reach the network. */
    static boolean isAllowedExternal(String scheme, boolean cleartext) {
        if (scheme.equals("https") || scheme.equals("data") || scheme.equals("blob") || scheme.equals("about")) return true;
        return cleartext && (scheme.equals("http") || scheme.equals("ws"));
    }

    /** File inside the installed folder only (canonical-path guard against "..", symlinks, odd encodings). */
    static InputStream openInstalled(Root root, String rel) throws IOException {
        File f = new File(root.dir, rel.replace('/', File.separatorChar));
        String c = f.getCanonicalPath();
        if (!c.startsWith(root.canon) || !f.isFile()) return null;
        return new FileInputStream(f);
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
        Uri u = req.getUrl();
        if (u == null) return true;
        if (HOST.equalsIgnoreCase(u.getHost()) && "https".equalsIgnoreCase(u.getScheme())) return false;
        String dev = host.devOrigin();
        if (dev != null && host.allowCleartext() && dev.equalsIgnoreCase(originOf(u))) return false;
        Log.w(TAG, "blocked navigation to " + u);
        return true; // never leave the simulator (the JS bridges must not be exposed to other sites)
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        host.onPageFinished(view, url);
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
        if (req != null && req.isForMainFrame()) {
            String d = err == null ? "" : String.valueOf(err.getDescription());
            Log.w(TAG, "main frame error " + req.getUrl() + ": " + d);
            host.onMainFrameError(view, String.valueOf(req.getUrl()), d);
        }
    }

    static String originOf(Uri u) {
        String scheme = u.getScheme(), h = u.getHost();
        if (scheme == null || h == null) return "";
        int port = u.getPort();
        return scheme.toLowerCase(Locale.ROOT) + "://" + h.toLowerCase(Locale.ROOT) + (port == -1 ? "" : ":" + port);
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", HEADERS, new ByteArrayInputStream(EMPTY));
    }

    private static WebResourceResponse refused() {
        return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", HEADERS, new ByteArrayInputStream(EMPTY));
    }

    static boolean isText(String mime) {
        return mime.startsWith("text/") || mime.endsWith("json") || mime.endsWith("javascript") || mime.endsWith("xml");
    }

    static String mimeFor(String file) {
        int dot = file.lastIndexOf('.');
        String ext = dot < 0 ? "" : file.substring(dot + 1).toLowerCase(Locale.ROOT);
        switch (ext) {
            case "html": case "htm": return "text/html";
            case "js": case "mjs": return "text/javascript";
            case "css": return "text/css";
            case "json": case "map": return "application/json";
            case "txt": case "md": return "text/plain";
            case "xml": return "application/xml";
            case "svg": return "image/svg+xml";
            case "png": return "image/png";
            case "jpg": case "jpeg": return "image/jpeg";
            case "webp": return "image/webp";
            case "gif": return "image/gif";
            case "ico": return "image/x-icon";
            case "ktx2": return "image/ktx2";
            case "wasm": return "application/wasm";
            case "glb": return "model/gltf-binary";
            case "gltf": return "model/gltf+json";
            case "bin": return "application/octet-stream";
            case "woff": return "font/woff";
            case "woff2": return "font/woff2";
            case "ttf": return "font/ttf";
            case "otf": return "font/otf";
            case "mp3": return "audio/mpeg";
            case "ogg": return "audio/ogg";
            case "wav": return "audio/wav";
            case "m4a": return "audio/mp4";
            case "mp4": return "video/mp4";
            case "webm": return "video/webm";
            default: return "application/octet-stream";
        }
    }

    /**
     * API 26+ variant. RenderProcessGoneDetail only exists from API 26, so this override lives in a subclass
     * that MainActivity instantiates only on 26+ (never loaded on Android 7).
     */
    static final class RendererAware extends AssetClient {
        RendererAware(AssetManager assets, Host host) {
            super(assets, host);
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // WebGL out-of-memory on 2 GB boxes kills the renderer; returning true keeps the app alive,
            // but that WebView is dead and must be destroyed (host does it).
            host.onRendererGone(view, detail != null && detail.didCrash());
            return true;
        }
    }
}
