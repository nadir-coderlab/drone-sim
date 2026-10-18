package com.nadir.dronesim;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.content.pm.SigningInfo;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.WebView;
import android.webkit.WebViewRenderProcess;
import android.webkit.WebViewRenderProcessClient;
import java.util.ArrayList;
import java.util.List;

/**
 * Calls that need a newer API level than minSdk 24 live in nested classes, so their classes are only
 * resolved on devices that have them (callers check Build.VERSION.SDK_INT first). Same trick AndroidX uses.
 */
final class Compat {
    private Compat() {}

    /** Renderer health callbacks (API 29+ only, see Api29.watchRenderer); UI thread. */
    interface RendererWatch {
        void onRendererUnresponsive(WebView view);
        void onRendererResponsive(WebView view);
    }

    /** API 26 (Android 8.0). */
    static final class Api26 {
        private Api26() {}

        static void vibrate(Vibrator v, long ms, int amplitude) {
            int amp = v.hasAmplitudeControl() ? Math.max(1, Math.min(255, amplitude)) : VibrationEffect.DEFAULT_AMPLITUDE;
            v.vibrate(VibrationEffect.createOneShot(ms, amp));
        }

        static String webViewPackage() {
            PackageInfo p = WebView.getCurrentWebViewPackage();
            return p == null ? "" : p.packageName + " " + p.versionName;
        }

        /** "Install unknown apps" granted to this app (Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES). */
        static boolean canRequestPackageInstalls(PackageManager pm) {
            return pm.canRequestPackageInstalls();
        }
    }

    /** API 28 (Android 9). */
    static final class Api28 {
        private Api28() {}

        static long versionCode(PackageInfo p) {
            return p.getLongVersionCode();
        }

        /** Current signer certificates (DER) of an installed package, or of an APK file when archive != null. */
        static List<byte[]> signingCerts(PackageManager pm, String pkg, String archive) throws PackageManager.NameNotFoundException {
            PackageInfo p = archive == null
                    ? pm.getPackageInfo(pkg, PackageManager.GET_SIGNING_CERTIFICATES)
                    : pm.getPackageArchiveInfo(archive, PackageManager.GET_SIGNING_CERTIFICATES);
            List<byte[]> out = new ArrayList<byte[]>();
            SigningInfo si = p == null ? null : p.signingInfo;
            if (si == null) return out;
            Signature[] sigs = si.getApkContentsSigners(); // current signer(s) only, never older rotated keys
            if (sigs != null) for (Signature s : sigs) out.add(s.toByteArray());
            return out;
        }
    }

    /** API 29 (Android 10). */
    static final class Api29 {
        private Api29() {}

        /** Reports a renderer that stops answering input / navigation (called again about every 5 s). */
        static void watchRenderer(WebView v, final RendererWatch w) {
            v.setWebViewRenderProcessClient(new WebViewRenderProcessClient() {
                @Override
                public void onRenderProcessUnresponsive(WebView view, WebViewRenderProcess process) {
                    w.onRendererUnresponsive(view);
                }

                @Override
                public void onRenderProcessResponsive(WebView view, WebViewRenderProcess process) {
                    w.onRendererResponsive(view);
                }
            });
        }

        /** Kills this WebView's renderer (a hung page); onRenderProcessGone follows. False if not possible. */
        static boolean terminateRenderer(WebView v) {
            WebViewRenderProcess p = v.getWebViewRenderProcess();
            return p != null && p.terminate();
        }
    }

    /** API 30 (Android 11). */
    static final class Api30 {
        private Api30() {}

        static void hideSystemBars(Window w) {
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.systemBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        }

        /** Ask the TV for ALLM / "game mode" (no motion smoothing, lowest latency) over HDMI. */
        static void preferMinimalPostProcessing(Window w) {
            w.setPreferMinimalPostProcessing(true);
        }
    }

    /** API 19..29 immersive mode. */
    @SuppressWarnings("deprecation")
    static void hideSystemBarsLegacy(View decor) {
        decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }
}
