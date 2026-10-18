package com.nadir.dronesim;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.AlertDialog;
import android.app.UiModeManager;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInstaller;
import android.content.res.Configuration;
import android.hardware.input.InputManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;
import android.view.Display;
import android.view.Gravity;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.io.IOException;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * One full-screen WebView running the simulator (https://appassets.androidplatform.net/assets/index.html?platform=tv),
 * served from the APK assets or from an installed web-content update (see Updater / UpdateCore).
 *
 * Input: the page reads controllers through the W3C Gamepad API (Chromium inside WebView maps Xbox/DualSense/
 * DualShock itself). Every controller event is still forwarded to the WebView; this Activity only (a) copies it
 * into NativePad for the fallback bridge and (b) consumes it afterwards so Android does not turn B into BACK,
 * A into DPAD_CENTER, SELECT into MENU or stick moves into D-pad keys. HOME/Guide is left to the system.
 *
 * BACK (TV remote): asks the page via window.onNativeBack(); true = the page handled it (pause menu, close a
 * screen). Otherwise a second BACK within 2 s leaves the app.
 *
 * Updates: checked at cold start, and on resume every 30 min (sooner again after a check that reached nothing).
 * Downloaded web content is applied at the next cold start, or as soon as the page sits on one of its menu screens
 * (never during a flight, a paused flight or a quiz).
 * Installed web content gets a health check (P7): 15 s after the page loaded (at the latest 30 s after loadUrl),
 * window.DS.app must exist and the page must answer within 8 s, and the renderer must not die twice within 60 s
 * while the app is in front; otherwise that version is marked bad and the previous good one (else the APK's own)
 * is loaded instead. A version that takes the whole app down twice before passing that check (process crash at
 * start) is marked bad at the next cold start (UpdateCore.Store trial keys).
 * App (APK) updates are offered in a D-pad friendly dialog (never during a flight) and installed through
 * Android's own update screen.
 */
public class MainActivity extends Activity
        implements AssetClient.Host, NativeVoice.Sink, Updater.Listener, NativeUpdate.Host, Compat.RendererWatch {
    static final String TAG = "DroneSim";
    static final String START_ORIGIN = "https://" + AssetClient.HOST + "/";
    static final String START_URL = "https://" + AssetClient.HOST + AssetClient.PREFIX + "index.html?platform=tv";

    private static final int BG = 0xFF0B1118; // index.html --bg, avoids a white flash while loading
    private static final long BACK_EXIT_MS = 2000;
    private static final int CRASH_LIMIT = 3;
    private static final long CRASH_WINDOW_MS = 60000;
    private static final long STARTUP_CHECK_MS = 5000;   // let the page load first
    private static final long HEALTH_DELAY_MS = 15000;   // P7
    private static final long LOAD_WATCHDOG_MS = 30000;  // P7: probe even if onPageFinished never comes (hung page)
    private static final long PROBE_TIMEOUT_MS = 8000;   // P7: no answer to the probe = the page is hung
    private static final long INSTALLED_CRASH_WINDOW_MS = 60000; // P7: 2 renderer deaths within 60 s
    private static final long APK_PROMPT_RETRY_MS = 5000; // the APK dialog waits while the user is flying
    private static final long APPLY_POLL_MS = 4000;       // downloaded content waits for a menu screen
    private static final long APPLY_RESUME_DELAY_MS = 1500;
    private static final long DIALOG_KEY_GUARD_MS = 1000; // keys pressed for the game must not answer a new dialog
    /** Menu screens of the page where new web content may be loaded (no flight, no quiz in progress). */
    private static final Set<String> HUB_SCREENS = new HashSet<String>(Arrays.asList(
            "title", "main", "course", "unit", "pro", "proLevel", "missions", "theoryHome"));
    // static: survives Activity recreation, so a renderer crash loop is detected
    private static final long[] crashTimes = new long[CRASH_LIMIT];
    private static int crashNext;

    private static final String MSG_BACK = "اضغط رجوع مرة ثانية عشان تطلع";
    private static final String MSG_RECOVERED = "صار خلل في الرسم ورجّعنا التطبيق من البداية";
    private static final String MSG_CRASH_LOOP = "الرسم طاح أكثر من مرة ورا بعض.\n"
            + "سكّر التطبيق وافتحه من جديد، ولو تكررت خلّ الجودة «منخفضة» من الإعدادات.\n\n"
            + "اضغط زر الرجوع للخروج.";
    private static final String MSG_NO_WEBVIEW = "متصفح النظام (Android System WebView) مو شغال أو قاعد يتحدّث.\n"
            + "حدّثه من Google Play وافتح التطبيق مرة ثانية.\n\nاضغط زر الرجوع للخروج.";
    private static final String MSG_DEV_DOWN = "سيرفر التطوير ما رد، فتحنا النسخة اللي داخل التطبيق";
    private static final String MSG_ROLLBACK = "التحديث الأخير ما اشتغل زين، رجّعنا النسخة اللي قبله";
    private static final String MSG_APK_TITLE = "فيه نسخة جديدة من التطبيق";
    private static final String MSG_APK_SAFE = "تقدّمك ما يضيع، كل شي محفوظ.\n"
            + "بعد التحديث التطبيق يتسكّر لحاله، افتحه من جديد.";
    private static final String MSG_APPLIED = "تحدّث المحاكي للنسخة الجديدة، وتقدّمك محفوظ";
    private static final String MSG_RELOADED = "رجّعنا المحاكي من البداية، وتقدّمك محفوظ";
    private static final String MSG_APK_NOW = "حدّث الحين";
    private static final String MSG_LATER = "بعدين";
    private static final String MSG_PERM_TITLE = "نحتاج إذن بسيط مرة وحدة";
    private static final String MSG_PERM_TEXT = "عشان التطبيق يقدر يحدّث نفسه، لازم تسمح له مرة وحدة.\n"
            + "بنفتح لك الإعدادات: شغّل «محاكي الدرون» وبعدين ارجع بزر الرجوع.";
    private static final String MSG_PERM_OPEN = "افتح الإعدادات";
    private static final String MSG_PERM_PATH = "في الإعدادات: التطبيقات ← الأمان والقيود ← مصادر غير معروفة ← شغّل «محاكي الدرون»";
    private static final String MSG_PERM_MISSING = "ما انعطى الإذن، التحديث ينتظرك بعدين";

    /** Returns true only when the page says it handled BACK. Old pages without the hook get an Escape key. */
    private static final String BACK_JS = "(function(){try{"
            + "if(typeof window.onNativeBack==='function')return window.onNativeBack()===true;"
            + "var o={key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true};"
            + "window.dispatchEvent(new KeyboardEvent('keydown',o));window.dispatchEvent(new KeyboardEvent('keyup',o));"
            + "}catch(e){}return false;})()";
    /** P8 event delivery: 'nohook' (native toasts instead), 'handled' (hook returned true) or 'seen'. */
    private static final String HOOK_JS = "(function(j){try{if(typeof window.onNativeUpdate!=='function')return 'nohook';"
            + "return window.onNativeUpdate(j)===true?'handled':'seen';}catch(e){return 'seen';}})(";
    /**
     * P7 health probe: the page must have finished starting (main.js sets DS.app.ready = true at the end of init(),
     * after the first menu is shown). DS.app alone exists as soon as main.js loads, even when init() then failed.
     * Content from before the ready flag (no "ready" key at all) keeps the old rule, so it is not rolled back for nothing.
     * A WebGL failure (DS.app.no3d) is a device condition, not bad content: it still counts as healthy.
     */
    private static final String HEALTH_JS = "!!(window.DS&&DS.app&&(DS.app.ready===true||!('ready' in DS.app)))";
    /** "state:screen" of the page, e.g. "menu:main", "fly:", "pause:pause"; "" for pages without DS.app. */
    private static final String STATE_JS = "(function(){try{var D=window.DS,a=D&&D.app;if(!a)return '';"
            + "var u=D.UI&&D.UI.cur;return String(a.state)+':'+(u&&u.name?String(u.name):'');}catch(e){return '';}})()";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final NativePad pad = new NativePad(this);
    private final NativeUpdate nativeUpdate = new NativeUpdate(this);
    private NativeVoice voice;
    private InputManager inputManager;
    private FrameLayout root;
    private WebView web;
    private boolean dev;
    private String startUrl = START_URL;
    private volatile String devOrigin;
    private long lastBackMs;

    private Updater updater;
    private volatile UpdateCore.Selection served;
    private volatile AssetClient.Root contentRoot; // null = APK assets
    private boolean resumed, resumedOnce;
    private int healthGen, probeSeq, unresponsive;
    private boolean healthPassed, healthDeferred, probing;
    private long installedCrashMs;
    private long armedTrial;                 // installed version whose start is counted in state.properties
    private boolean rebuildPending, fatalShown, expectRendererGone;
    private String rebuildMsg;
    private AlertDialog apkDialog, permDialog;
    private boolean apkPromptPending, apkPromptManual, apkRetryManual, installAfterPermission, readyToastPending;
    private String lastDownloadToast = "";

    private final InputManager.InputDeviceListener deviceListener = new InputManager.InputDeviceListener() {
        @Override public void onInputDeviceAdded(int id) { pad.refreshConnected(); }
        @Override public void onInputDeviceRemoved(int id) { pad.onDeviceRemoved(id); }
        @Override public void onInputDeviceChanged(int id) { pad.refreshConnected(); }
    };

    private final Runnable startupCheck = new Runnable() {
        @Override public void run() {
            if (updater != null && !isFinishing()) updater.check(false);
        }
    };

    private final Runnable apkPromptRetry = new Runnable() {
        @Override public void run() {
            boolean manual = apkRetryManual;
            apkRetryManual = false;
            if (updater != null && !isFinishing() && !isDestroyed()) maybeShowApkDialog(manual);
        }
    };

    private final Runnable applyPoll = new Runnable() {
        @Override public void run() {
            pollApply();
        }
    };

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        dev = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;

        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        w.getDecorView().setBackgroundColor(BG);
        if (Build.VERSION.SDK_INT >= 30) Compat.Api30.preferMinimalPostProcessing(w); // HDMI ALLM / game mode
        prefer60Hz(w);

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        setContentView(root);
        applyImmersive();

        inputManager = (InputManager) getSystemService(Context.INPUT_SERVICE);
        pad.refreshConnected();
        voice = new NativeVoice(this, this);
        Intent start = getIntent();
        startUrl = resolveStartUrl(start);

        updater = Updater.get(this);
        updater.setListener(this);
        setServed(updater.selectForStart()); // P6: highest valid of bundled / installed (also fills pad info)

        try {
            WebView.setWebContentsDebuggingEnabled(dev); // chrome://inspect from the PC, dev builds only
            createWebView();
        } catch (Throwable t) { // WebView package missing, disabled or updating
            Log.e(TAG, "WebView unavailable", t);
            showFatal(MSG_NO_WEBVIEW);
            return;
        }
        loadPage(startUrl);
        ui.postDelayed(startupCheck, STARTUP_CHECK_MS);
        if (ApkInstaller.isInstallStatus(start)) handleInstallStatus(start); // started by the package installer
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (ApkInstaller.isInstallStatus(intent)) { // P9: never reloads the WebView
            handleInstallStatus(intent);
            return;
        }
        // dev loop: "am start ... --es url http://PC:8080/index.html" while the app is already open
        if (dev && intent != null && intent.hasExtra("url") && web != null) {
            startUrl = resolveStartUrl(intent);
            loadPage(startUrl);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        if (rebuildPending && web == null && !fatalShown) { // the renderer was taken away while we were away
            rebuildPending = false;
            String msg = rebuildMsg;
            rebuildMsg = null;
            rebuildWebView(msg);
        }
        if (inputManager != null) inputManager.registerInputDeviceListener(deviceListener, ui);
        pad.refreshConnected();
        if (web != null) {
            web.onResume();
            web.resumeTimers();
            web.requestFocus();
        }
        applyImmersive();
        if (resumedOnce && updater != null && updater.dueForCheck()) updater.check(false);
        resumedOnce = true;
        if (installAfterPermission) { // back from the "install unknown apps" screen
            installAfterPermission = false;
            if (ApkInstaller.mayInstall(this)) startApkInstall();
            else toast(MSG_PERM_MISSING);
        } else if (apkPromptPending) {
            apkPromptPending = false;
            maybeShowApkDialog(apkPromptManual);
            apkPromptManual = false;
        }
        if (web != null && START_URL.equals(startUrl)) armTrial(); // back in front before the health check
        if (healthDeferred) {
            healthDeferred = false;
            scheduleHealth();
        }
        if (updater != null && (readyToastPending || updater.hasPendingContent())) scheduleApplyPoll(APPLY_RESUME_DELAY_MS);
    }

    @Override
    protected void onPause() {
        resumed = false;
        if (inputManager != null) inputManager.unregisterInputDeviceListener(deviceListener);
        if (voice != null) voice.stop();
        pad.clear(); // buttons held while leaving would otherwise stay "down"
        ui.removeCallbacks(applyPoll);
        if (web != null) {
            web.onPause();
            web.pauseTimers();
        }
        super.onPause();
    }

    @Override
    protected void onStop() {
        // P7 across restarts: leaving the foreground cleanly is not a crash, so this start does not count
        if (armedTrial != 0 && !healthPassed && updater != null) {
            updater.endTrial(armedTrial, false);
            armedTrial = 0;
        }
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        if (updater != null) updater.clearListener(this);
        dismiss(apkDialog);
        dismiss(permDialog);
        apkDialog = permDialog = null;
        if (voice != null) {
            voice.shutdown();
            voice = null;
        }
        destroyWebView();
        ui.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            applyImmersive();
            if (web != null) web.requestFocus();
        }
    }

    /** 2 GB boxes: let the page lower quality before the system kills the WebGL renderer (optional hook). */
    @Override
    @SuppressWarnings("deprecation")
    public void onTrimMemory(int level) {
        super.onTrimMemory(level);
        if (web != null && level >= TRIM_MEMORY_RUNNING_LOW && level < TRIM_MEMORY_UI_HIDDEN) {
            web.evaluateJavascript("window.onNativeLowMemory&&window.onNativeLowMemory(" + level + ")", null);
        }
    }

    // ------------------------------------------------------------------ input

    @Override
    public boolean dispatchKeyEvent(KeyEvent e) {
        final int code = e.getKeyCode();
        final int action = e.getAction();
        if (code == KeyEvent.KEYCODE_BACK) {
            if (action == KeyEvent.ACTION_UP && !e.isCanceled()) handleBack();
            return true; // the page decides; see handleBack()
        }
        if (isPadKey(e) && NativePad.bitFor(code) >= 0) {
            if (action == KeyEvent.ACTION_DOWN || action == KeyEvent.ACTION_UP) pad.onKey(e, action == KeyEvent.ACTION_DOWN);
            if (web != null && !web.hasFocus()) web.requestFocus(); // first press must not be lost to focus
            boolean handled = super.dispatchKeyEvent(e);  // WebView's Gamepad API sees the button too
            return code == KeyEvent.KEYCODE_BUTTON_MODE ? handled : true; // keep Guide->HOME, block the rest
        }
        return super.dispatchKeyEvent(e); // TV remote D-pad/OK/keyboard reach the page as normal keys
    }

    @Override
    public boolean dispatchGenericMotionEvent(MotionEvent e) {
        if ((e.getSource() & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK
                && e.getActionMasked() == MotionEvent.ACTION_MOVE) {
            pad.onMotion(e);
            super.dispatchGenericMotionEvent(e); // WebView's Gamepad API still gets it
            return true;                         // stop Android turning stick/hat moves into D-pad keys
        }
        return super.dispatchGenericMotionEvent(e);
    }

    private static boolean isPadKey(KeyEvent e) {
        return NativePad.isPadSource(e.getSource()) || KeyEvent.isGamepadButton(e.getKeyCode());
    }

    private void handleBack() {
        if (web == null) {
            finish();
            return;
        }
        web.evaluateJavascript(BACK_JS, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if ("true".equals(value)) return;
                long now = SystemClock.uptimeMillis();
                if (now - lastBackMs < BACK_EXIT_MS) {
                    finish();
                } else {
                    lastBackMs = now;
                    toast(MSG_BACK);
                }
            }
        });
    }

    // ------------------------------------------------------------------ WebView

    private void createWebView() {
        WebView v = new WebView(this);
        v.setBackgroundColor(BG);
        WebSettings s = v.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // localStorage = progress + settings
        s.setMediaPlaybackRequiresUserGesture(false); // WebAudio motor sound without a touch (gamepads are not "gestures")
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setGeolocationEnabled(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);                           // ignore the system font scale; the HUD layout is fixed
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setCacheMode(dev ? WebSettings.LOAD_NO_CACHE : WebSettings.LOAD_DEFAULT);
        s.setUserAgentString(s.getUserAgentString() + " DroneSimTV/" + appVersion());

        v.setWebViewClient(Build.VERSION.SDK_INT >= 26
                ? new AssetClient.RendererAware(getAssets(), this)
                : new AssetClient(getAssets(), this));
        if (Build.VERSION.SDK_INT >= 29) {
            try {
                Compat.Api29.watchRenderer(v, this); // P7: a page that hangs before its health check
            } catch (Throwable t) {
                Log.w(TAG, "renderer watch", t);
            }
        }
        v.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                if (!dev || m == null) return false;
                Log.println(logLevel(m), TAG, "js: " + m.message() + " @" + m.sourceId() + ":" + m.lineNumber());
                return true;
            }
        });
        v.addJavascriptInterface(pad, "NativePad");
        if (voice != null) v.addJavascriptInterface(voice, "NativeVoice");
        v.addJavascriptInterface(nativeUpdate, "NativeUpdate");

        v.setFocusable(true);
        v.setFocusableInTouchMode(true);
        v.setOverScrollMode(View.OVER_SCROLL_NEVER);
        v.setVerticalScrollBarEnabled(false);
        v.setHorizontalScrollBarEnabled(false);
        root.addView(v, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        web = v;
        v.requestFocus();
    }

    private void destroyWebView() {
        WebView v = web;
        web = null;
        destroyQuietly(v);
    }

    /** Remove + destroy only: after a renderer loss the WebView must not be used for anything else. */
    private void destroyQuietly(WebView v) {
        if (v == null) return;
        try {
            ViewGroup parent = (ViewGroup) v.getParent();
            if (parent != null) parent.removeView(v);
            v.destroy();
        } catch (Throwable t) {
            Log.w(TAG, "WebView destroy", t);
        }
    }

    /**
     * The WebView's renderer died. In front: rebuild and reload (P7 counts it for installed content; a 4th loss
     * within 60 s shows the crash screen). In the background (Home, another app) Android reclaims the renderer
     * of 2 GB boxes all the time: that is not the content's fault, so nothing is counted and the WebView is
     * rebuilt only when the user comes back (a rebuild in the background would just be killed again).
     */
    @Override
    public void onRendererGone(WebView view, boolean crashed) {
        Log.e(TAG, "WebView renderer gone, crashed=" + crashed + (resumed ? "" : " (app in the background)"));
        if (view != web) { // an old instance; just get rid of it
            destroyQuietly(view);
            return;
        }
        destroyWebView();
        probing = false;
        probeSeq++; // an outstanding health probe will never be answered
        if (expectRendererGone) { // we ended a hung page ourselves (rollbackHung); already rolled back
            expectRendererGone = false;
            rebuildSoon(null);
            return;
        }
        if (!resumed) {
            rebuildPending = true;
            rebuildMsg = MSG_RELOADED;
            return;
        }
        boolean rolledBack = false;
        UpdateCore.Selection s = served;
        if (s != null && s.installed() && START_URL.equals(startUrl)) { // P7: 2 renderer deaths within 60 s
            long now = SystemClock.elapsedRealtime();
            if (installedCrashMs != 0 && now - installedCrashMs < INSTALLED_CRASH_WINDOW_MS) {
                setServed(updater.rollback(s.version));
                Arrays.fill(crashTimes, 0L); // the fallback content gets a fresh crash budget
                rolledBack = true;
            } else {
                installedCrashMs = now;
            }
        }
        if (!rolledBack && crashLoop()) {
            showFatal(MSG_CRASH_LOOP);
            return;
        }
        rebuildSoon(rolledBack ? MSG_ROLLBACK : MSG_RECOVERED);
    }

    /** Rebuild after the renderer callback has returned; waits for onResume if the app left meanwhile. */
    private void rebuildSoon(final String msg) {
        ui.post(new Runnable() {
            @Override
            public void run() {
                if (!resumed) {
                    rebuildPending = true;
                    if (msg != null) rebuildMsg = msg;
                    return;
                }
                rebuildWebView(msg);
            }
        });
    }

    private void rebuildWebView(String msg) {
        if (isFinishing() || isDestroyed() || web != null || fatalShown) return;
        try {
            createWebView();
            loadPage(startUrl);
            if (msg != null) toast(msg);
        } catch (Throwable t) {
            Log.e(TAG, "WebView rebuild failed", t);
            showFatal(MSG_NO_WEBVIEW);
        }
    }

    /** API 29+ (Compat.Api29.watchRenderer): the renderer did not answer input / navigation for ~5 s. */
    @Override
    public void onRendererUnresponsive(WebView view) {
        if (view != web) return;
        UpdateCore.Selection s = served;
        if (healthPassed || !resumed || s == null || !s.installed() || !START_URL.equals(startUrl)) return;
        if (++unresponsive < 2) return; // reported again about every 5 s while it lasts: ~10 s = hung
        Log.w(TAG, "content " + s.version + ": renderer unresponsive before its health check");
        rollbackHung();
    }

    @Override
    public void onRendererResponsive(WebView view) {
        if (view == web) unresponsive = 0;
    }

    @Override
    public void onMainFrameError(WebView view, String url, String description) {
        String origin = devOrigin;
        if (origin == null || view != web || url == null || !url.toLowerCase(Locale.ROOT).startsWith(origin)) return;
        devOrigin = null;
        startUrl = START_URL;
        toast(MSG_DEV_DOWN);
        loadPage(START_URL);
    }

    @Override
    public String devOrigin() {
        return devOrigin;
    }

    @Override
    public AssetClient.Root contentRoot() {
        return contentRoot;
    }

    @Override
    public boolean allowCleartext() {
        return dev;
    }

    // ------------------------------------------------------------------ P7 health check

    /**
     * Every page load goes through here. For installed content that has not passed its health check yet this
     * also counts the start (crash-loop guard across restarts) and arms a watchdog: the probe runs 15 s after
     * onPageFinished, or 30 s after loadUrl if onPageFinished never comes (script stuck in a loop at load).
     */
    private void loadPage(String url) {
        WebView v = web;
        if (v == null) return;
        healthGen++;
        probing = false;
        probeSeq++;
        healthDeferred = false;
        unresponsive = 0;
        v.loadUrl(url);
        final UpdateCore.Selection s = served;
        if (s == null || !s.installed() || healthPassed || !START_URL.equals(url)) return;
        armTrial();
        final int gen = healthGen;
        ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                runHealth(gen, s.version);
            }
        }, LOAD_WATCHDOG_MS);
    }

    /** Counts this start of installed content that never passed the health check (saved before it can crash). */
    private void armTrial() {
        UpdateCore.Selection s = served;
        if (armedTrial != 0 || healthPassed || s == null || !s.installed() || updater == null) return;
        try {
            if (updater.beginTrial(s.version)) armedTrial = s.version;
        } catch (Throwable t) {
            Log.w(TAG, "trial", t);
        }
    }

    /** P7: installed content must show window.DS.app 15 s after the page finished loading. */
    @Override
    public void onPageFinished(WebView view, String url) {
        if (view != web || healthPassed || url == null || !url.startsWith(START_ORIGIN)) return;
        UpdateCore.Selection s = served;
        if (s == null || !s.installed() || !START_URL.equals(startUrl)) return;
        scheduleHealth();
    }

    private void scheduleHealth() {
        final UpdateCore.Selection s = served;
        if (s == null || !s.installed() || healthPassed) return;
        final int gen = healthGen;
        ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                runHealth(gen, s.version);
            }
        }, HEALTH_DELAY_MS);
    }

    private void runHealth(final int gen, final long version) {
        UpdateCore.Selection s = served;
        if (gen != healthGen || web == null || s == null || !s.installed() || s.version != version || healthPassed || probing) return;
        if (!resumed) { // in the background the page may be frozen: check again 15 s after coming back
            healthDeferred = true;
            return;
        }
        probing = true;
        final int id = ++probeSeq;
        web.evaluateJavascript(HEALTH_JS, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (id != probeSeq) return; // timed out or superseded
                probing = false;
                UpdateCore.Selection now = served;
                if (gen != healthGen || now == null || now.version != version || !now.installed() || healthPassed) return;
                if ("true".equals(value)) {
                    healthPassed = true;
                    healthDeferred = false;
                    armedTrial = 0;
                    try {
                        updater.endTrial(version, true); // good from now on, no more trials
                    } catch (Throwable t) {
                        Log.w(TAG, "trial", t);
                    }
                    Log.i(TAG, "content " + version + " health check ok");
                } else {
                    Log.w(TAG, "content " + version + " health check failed: " + value);
                    rollbackAndReload();
                }
            }
        });
        ui.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (id != probeSeq || !probing) return;
                probing = false;
                probeSeq++; // a late answer is ignored
                UpdateCore.Selection now = served;
                if (gen != healthGen || now == null || now.version != version || !now.installed() || healthPassed) return;
                if (!resumed) { // a paused WebView may not answer: ask again after coming back
                    healthDeferred = true;
                    return;
                }
                Log.w(TAG, "content " + version + " health probe got no answer in " + PROBE_TIMEOUT_MS + " ms: page hung");
                rollbackHung();
            }
        }, PROBE_TIMEOUT_MS);
    }

    private void rollbackAndReload() {
        UpdateCore.Selection s = served;
        if (s == null || !s.installed()) return;
        setServed(updater.rollback(s.version));
        toast(MSG_ROLLBACK);
        if (web != null && START_URL.equals(startUrl)) {
            web.clearCache(false); // RAM cache only; localStorage is not touched
            loadPage(START_URL);
        }
    }

    /**
     * The page of an installed version is hung (no answer / unresponsive renderer): mark it bad, then get rid of
     * the stuck renderer (API 29+: terminate it, onRendererGone rebuilds) or at least of this WebView.
     */
    private void rollbackHung() {
        UpdateCore.Selection s = served;
        if (s == null || !s.installed()) return;
        setServed(updater.rollback(s.version));
        toast(MSG_ROLLBACK);
        final WebView v = web;
        if (v == null) return;
        if (Build.VERSION.SDK_INT >= 29) {
            boolean killed = false;
            try {
                killed = Compat.Api29.terminateRenderer(v);
            } catch (Throwable t) {
                Log.w(TAG, "terminate renderer", t);
            }
            if (killed) {
                expectRendererGone = true;
                ui.postDelayed(new Runnable() { // in case onRenderProcessGone never arrives
                    @Override
                    public void run() {
                        if (!expectRendererGone || web != v) return;
                        expectRendererGone = false;
                        destroyWebView();
                        rebuildSoon(null);
                    }
                }, 3000);
                return;
            }
        }
        destroyWebView();
        rebuildSoon(null);
    }

    /** Points AssetClient at the chosen content; a folder that cannot be resolved counts as bad. */
    private void setServed(UpdateCore.Selection s) {
        if (armedTrial != 0) { // switching content before the check: that start ended cleanly
            try {
                updater.endTrial(armedTrial, false);
            } catch (Throwable t) {
                Log.w(TAG, "trial", t);
            }
            armedTrial = 0;
        }
        AssetClient.Root r = null;
        for (int i = 0; i < 4 && s.installed(); i++) {
            try {
                r = new AssetClient.Root(s.dir);
                break;
            } catch (IOException e) {
                Log.w(TAG, "content folder " + s.dir, e);
                s = updater.rollback(s.version);
            }
        }
        contentRoot = s.installed() ? r : null;
        served = s;
        healthGen++;
        healthPassed = false;
        healthDeferred = false;
        probing = false;
        probeSeq++;
        unresponsive = 0;
        installedCrashMs = 0;
        pad.setInfo(buildInfo());
    }

    /** NativeUpdate.applyNow() / pollApply() on the UI thread; false = nothing new to load. */
    private boolean applyPendingContent() {
        UpdateCore.Selection s = updater.applyPending();
        if (s == null) return false;
        setServed(s);
        if (web != null && START_URL.equals(startUrl)) {
            web.clearCache(false);
            loadPage(START_URL);
        }
        return true;
    }

    private void scheduleApplyPoll(long delayMs) {
        ui.removeCallbacks(applyPoll);
        ui.postDelayed(applyPoll, delayMs);
    }

    /**
     * Downloaded web content is loaded as soon as the page shows one of its menu screens (HUB_SCREENS): the user
     * does not have to close the app, and a flight, a paused flight or a quiz is never interrupted. Runs while
     * the app is in front and something is pending (started by the 'ready' event and by onResume).
     */
    private void pollApply() {
        ui.removeCallbacks(applyPoll);
        if (!resumed || isFinishing() || isDestroyed() || updater == null) return; // onResume starts it again
        final WebView v = web;
        if (v == null || !START_URL.equals(startUrl) || !updater.hasPendingContent()) {
            flushReadyToast();
            return;
        }
        if (isShowing(apkDialog) || isShowing(permDialog)) {
            scheduleApplyPoll(APPLY_POLL_MS);
            return;
        }
        v.evaluateJavascript(STATE_JS, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (!resumed || isFinishing() || isDestroyed() || web != v) return;
                if (isHub(unquote(value)) && !isShowing(apkDialog) && !isShowing(permDialog)) {
                    readyToastPending = false;
                    if (applyPendingContent()) {
                        Log.i(TAG, "new web content loaded at the menu");
                        toast(MSG_APPLIED);
                    }
                    return;
                }
                flushReadyToast(); // "starts as soon as you are back at the main menu"
                scheduleApplyPoll(APPLY_POLL_MS);
            }
        });
    }

    private void flushReadyToast() {
        if (!readyToastPending) return;
        readyToastPending = false;
        toast(Updater.message("ready", ""));
    }

    /** "menu:main" etc.: no flight, no quiz. Pages without DS.app ("") never count as a menu. */
    static boolean isHub(String pageState) {
        if (pageState == null || !pageState.startsWith("menu:")) return false;
        return HUB_SCREENS.contains(pageState.substring(5));
    }

    /**
     * No dialog now: flying, any screen of the timed theory exam (its clock keeps running on the question grid and
     * the submit / quit confirmations), or the stick calibration / button remap wizards (they read the controller,
     * which a native dialog would take away). The pause menu ("pause:*") is allowed. Unknown / old pages ("") do not block.
     */
    static boolean isBusy(String pageState) {
        if (pageState == null) return false;
        if (pageState.startsWith("fly:")) return true;
        int i = pageState.indexOf(':');
        String scr = i < 0 ? "" : pageState.substring(i + 1);
        return scr.equals("thExam") || scr.equals("thGrid") || scr.equals("thSubmit") || scr.equals("thQuit")
                || scr.equals("calib") || scr.equals("remap");
    }

    /** evaluateJavascript result (a JSON value) -> plain string; "" for null / non-strings. */
    static String unquote(String json) {
        if (json == null || json.length() < 2 || json.charAt(0) != '"' || json.charAt(json.length() - 1) != '"') return "";
        return json.substring(1, json.length() - 1).replace("\\\"", "\"").replace("\\\\", "\\");
    }

    /** NativeVoice callbacks (any thread) -> page. type/id are already restricted to [A-Za-z0-9_-]. */
    @Override
    public void voiceEvent(final String type, final String id) {
        ui.post(new Runnable() {
            @Override
            public void run() {
                WebView v = web;
                if (v != null) v.evaluateJavascript("window.__dsVoiceEvt&&window.__dsVoiceEvt('" + type + "','" + id + "')", null);
            }
        });
    }

    // ------------------------------------------------------------------ updates: events (UI thread)

    @Override
    public void onUpdateEvent(final String state, final String reason, String json, final boolean manual) {
        if (isFinishing() || isDestroyed()) return;
        ValueCallback<String> cb = new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                String r = value == null ? "" : value;
                boolean hook = r.contains("seen") || r.contains("handled");
                if ("apk-available".equals(state)) {
                    if (!r.contains("handled")) maybeShowApkDialog(manual);
                    return;
                }
                if ("ready".equals(state)) { // load it at once if the page is at a menu, else say when it starts
                    if (!hook) readyToastPending = true;
                    pollApply();
                    return;
                }
                if (!hook || isInstallProblem(reason)) nativeToast(state, reason, manual, version(json));
            }
        };
        WebView v = web;
        if (v == null) cb.onReceiveValue("nohook");
        else v.evaluateJavascript(HOOK_JS + UpdateCore.quote(json) + ")", cb);
    }

    /**
     * Pages without window.onNativeUpdate get short Arabic toasts, only where they help: content ready (see
     * pollApply), the answer to a manual check, and (always, P9) a failed / cancelled app install.
     */
    private void nativeToast(String state, String reason, boolean manual, String version) {
        String msg = Updater.message(state, reason);
        if (msg.length() == 0 || "installing".equals(state)) return;
        if ("downloading".equals(state)) { // progress events: one toast per download
            if (!manual || lastDownloadToast.equals(version)) return;
            lastDownloadToast = version;
            toast(msg);
            return;
        }
        if ("ready".equals(state) || manual || ("error".equals(state) && isInstallProblem(reason))) toast(msg);
    }

    private static boolean isInstallProblem(String reason) {
        return "aborted".equals(reason) || "install-failed".equals(reason)
                || "apk-invalid".equals(reason) || "permission".equals(reason);
    }

    /** "kind:version" of an event JSON (cheap, no parser needed). */
    private static String version(String json) {
        int k = json.indexOf("\"kind\":"), v = json.indexOf("\"version\":");
        if (k < 0 || v < 0) return "";
        int e = json.indexOf(',', v);
        return json.substring(k, json.indexOf(',', k)) + json.substring(v, e < 0 ? json.length() : e);
    }

    // ------------------------------------------------------------------ updates: APK (P9)

    /** Offers a downloaded APK, but never in the middle of a flight: the page is asked first (STATE_JS). */
    private void maybeShowApkDialog(final boolean manual) {
        Updater.PendingApk p = updater.pendingApk();
        if (p == null || !updater.promptAllowed(p.code, manual)) return;
        if (!resumed || isFinishing()) {
            apkPromptPending = true;
            apkPromptManual |= manual;
            return;
        }
        if (isShowing(apkDialog) || isShowing(permDialog)) return;
        WebView v = web;
        if (v == null) {
            showApkDialog(manual);
            return;
        }
        v.evaluateJavascript(STATE_JS, new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (isBusy(unquote(value))) { // the dialog would take the controller away mid-flight
                    apkRetryManual |= manual;
                    ui.removeCallbacks(apkPromptRetry);
                    ui.postDelayed(apkPromptRetry, APK_PROMPT_RETRY_MS);
                    return;
                }
                showApkDialog(manual);
            }
        });
    }

    private void showApkDialog(boolean manual) {
        Updater.PendingApk p = updater.pendingApk();
        if (p == null || !updater.promptAllowed(p.code, manual)) return;
        if (!resumed || isFinishing() || isDestroyed()) {
            apkPromptPending = true;
            apkPromptManual |= manual;
            return;
        }
        if (isShowing(apkDialog) || isShowing(permDialog)) return;
        final long code = p.code;
        StringBuilder msg = new StringBuilder();
        if (p.notes.length() > 0) msg.append(p.notes).append("\n\n");
        msg.append(MSG_APK_SAFE);
        AlertDialog d = new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(MSG_APK_TITLE + (p.name.length() > 0 ? " (" + p.name + ")" : ""))
                .setMessage(msg.toString())
                .setPositiveButton(MSG_APK_NOW, new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface dlg, int which) { startApkInstall(); }
                })
                .setNegativeButton(MSG_LATER, new DialogInterface.OnClickListener() {
                    // only this explicit choice snoozes (24 h, or until the PC publishes again); BACK / B just
                    // closes the dialog and the next check asks again
                    @Override public void onClick(DialogInterface dlg, int which) { updater.snooze(code); }
                })
                .create();
        apkDialog = d;
        showFocused(d);
    }

    /** "Update now": permission first (API 26+), then PackageInstaller. */
    private void startApkInstall() {
        if (updater.pendingApk() == null) {
            updater.check(true);
            return;
        }
        if (!ApkInstaller.mayInstall(this)) {
            showPermissionDialog();
            return;
        }
        updater.install();
    }

    private void showPermissionDialog() {
        if (isShowing(permDialog)) return;
        Updater.PendingApk p = updater.pendingApk();
        final long code = p == null ? 0 : p.code;
        AlertDialog d = new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(MSG_PERM_TITLE)
                .setMessage(MSG_PERM_TEXT)
                .setPositiveButton(MSG_PERM_OPEN, new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface dlg, int which) { openInstallPermission(); }
                })
                .setNegativeButton(MSG_LATER, new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface dlg, int which) { if (code != 0) updater.snooze(code); }
                })
                .create();
        permDialog = d;
        showFocused(d);
    }

    private void openInstallPermission() {
        int r = ApkInstaller.openUnknownSourcesSettings(this);
        if (r == ApkInstaller.SETTINGS_NONE) {
            toast(MSG_PERM_PATH);
            updater.emitError("apk", "permission");
            return;
        }
        installAfterPermission = true; // continue in onResume
        if (r == ApkInstaller.SETTINGS_GENERIC) toast(MSG_PERM_PATH);
    }

    /** Status from PackageInstaller (explicit PendingIntent to this singleTask Activity). */
    private void handleInstallStatus(Intent intent) {
        if (!updater.acceptInstallStatus(intent)) {
            Log.w(TAG, "ignored an install status that is not from our session");
            return;
        }
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, Integer.MIN_VALUE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = ApkInstaller.confirmIntent(intent);
            if (confirm != null) {
                try {
                    startActivity(confirm); // Android's own "update this app?" screen
                    return;
                } catch (Throwable t) {
                    Log.w(TAG, "cannot open the install screen", t);
                }
            }
            updater.installFinished(false, "install-failed");
            return;
        }
        if (status == PackageInstaller.STATUS_SUCCESS) {
            updater.installFinished(true, "");
            return;
        }
        String why = ApkInstaller.failureReason(status);
        Log.w(TAG, "install failed: status " + status + " " + intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
        // "aborted" (Cancel / BACK on Android's screen) is not snoozed: the next check offers it again
        updater.installFinished(false, why);
    }

    /**
     * D-pad friendly: right-to-left, focus on the main button, no outside-touch dismiss. Keys in the first second
     * are swallowed (a button meant for the game must not answer the dialog), and the controller state the page
     * reads is released (the dialog takes the input).
     */
    private void showFocused(final AlertDialog d) {
        d.setCanceledOnTouchOutside(false);
        final long guardUntil = SystemClock.uptimeMillis() + DIALOG_KEY_GUARD_MS;
        d.setOnKeyListener(new DialogInterface.OnKeyListener() {
            @Override
            public boolean onKey(DialogInterface dlg, int keyCode, KeyEvent event) {
                return SystemClock.uptimeMillis() < guardUntil;
            }
        });
        pad.clear();
        d.setOnShowListener(new DialogInterface.OnShowListener() {
            @Override
            public void onShow(DialogInterface dlg) {
                Button b = d.getButton(AlertDialog.BUTTON_POSITIVE);
                if (b != null) {
                    b.setFocusable(true);
                    b.requestFocus();
                }
            }
        });
        try {
            d.show();
            Window w = d.getWindow();
            if (w != null) w.getDecorView().setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        } catch (Throwable t) { // activity going away
            Log.w(TAG, "dialog", t);
        }
    }

    private static boolean isShowing(AlertDialog d) {
        return d != null && d.isShowing();
    }

    private static void dismiss(AlertDialog d) {
        try {
            if (d != null && d.isShowing()) d.dismiss();
        } catch (Throwable ignored) {
            // window already gone
        }
    }

    // ------------------------------------------------------------------ NativeUpdate.Host (JavaBridge thread)

    @Override
    public String updateInfo() {
        return updater.infoJson();
    }

    @Override
    public boolean updateCheck() {
        updater.check(true);
        return true;
    }

    @Override
    public boolean updateApplyNow() {
        if (!updater.hasPendingContent()) return false;
        ui.post(new Runnable() {
            @Override public void run() {
                if (!isFinishing() && !isDestroyed()) {
                    readyToastPending = false;
                    applyPendingContent();
                }
            }
        });
        return true;
    }

    @Override
    public boolean updateSetServer(String url) {
        return updater.setServer(url);
    }

    @Override
    public boolean updateInstallApk() {
        boolean have = updater.pendingApk() != null;
        ui.post(new Runnable() {
            @Override public void run() {
                if (!isFinishing() && !isDestroyed()) startApkInstall();
            }
        });
        return have;
    }

    // ------------------------------------------------------------------ helpers

    /** Dev builds only: --es url <http(s)://...>; plain http only to LAN / loopback addresses. */
    private String resolveStartUrl(Intent intent) {
        devOrigin = null;
        if (!dev || intent == null) return START_URL;
        String extra = intent.getStringExtra("url");
        if (extra == null || extra.trim().length() == 0) return START_URL;
        Uri u = Uri.parse(extra.trim());
        if (!isAllowedDevUrl(u)) {
            Log.w(TAG, "ignored dev url " + extra);
            return START_URL;
        }
        if (u.getQueryParameter("platform") == null) u = u.buildUpon().appendQueryParameter("platform", "tv").build();
        devOrigin = AssetClient.originOf(u);
        Log.i(TAG, "dev url " + u);
        return u.toString();
    }

    static boolean isAllowedDevUrl(Uri u) {
        String scheme = u.getScheme(), host = u.getHost();
        if (scheme == null || host == null) return false;
        scheme = scheme.toLowerCase(Locale.ROOT);
        host = host.toLowerCase(Locale.ROOT);
        if (scheme.equals("https")) return true;
        if (!scheme.equals("http")) return false;
        if (host.equals("localhost")) return true; // with "adb reverse tcp:8080 tcp:8080"
        if (!host.matches("\\d{1,3}(\\.\\d{1,3}){3}")) return false;
        String[] p = host.split("\\.");
        int a = Integer.parseInt(p[0]), b = Integer.parseInt(p[1]);
        return a == 127 || a == 10 || (a == 192 && b == 168) || (a == 172 && b >= 16 && b <= 31);
    }

    /** If the box outputs 50 Hz, ask for a 60 Hz mode at the same resolution (requestAnimationFrame follows it). */
    @SuppressWarnings("deprecation")
    private void prefer60Hz(Window w) {
        try {
            Display d = getWindowManager().getDefaultDisplay();
            Display.Mode cur = d.getMode();
            if (cur == null || cur.getRefreshRate() >= 55f) return;
            for (Display.Mode m : d.getSupportedModes()) {
                if (m.getPhysicalWidth() == cur.getPhysicalWidth() && m.getPhysicalHeight() == cur.getPhysicalHeight()
                        && Math.abs(m.getRefreshRate() - 60f) < 1.5f) {
                    WindowManager.LayoutParams lp = w.getAttributes();
                    lp.preferredDisplayModeId = m.getModeId();
                    w.setAttributes(lp);
                    Log.i(TAG, "display " + cur.getRefreshRate() + " Hz -> " + m.getRefreshRate() + " Hz");
                    return;
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "display mode", t);
        }
    }

    private void applyImmersive() {
        try {
            Window w = getWindow();
            if (Build.VERSION.SDK_INT >= 30) Compat.Api30.hideSystemBars(w);
            else Compat.hideSystemBarsLegacy(w.getDecorView());
        } catch (Throwable t) {
            Log.w(TAG, "immersive", t);
        }
    }

    private void showFatal(String msg) {
        fatalShown = true;
        rebuildPending = false;
        destroyWebView();
        root.removeAllViews();
        TextView t = new TextView(this);
        t.setText(msg);
        t.setTextColor(0xFFEEF3F8);
        t.setTextSize(22f); // sp
        t.setGravity(Gravity.CENTER);
        t.setLineSpacing(0f, 1.3f);
        int px = (int) (32 * getResources().getDisplayMetrics().density);
        t.setPadding(px, px, px, px);
        root.addView(t, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }

    /** True when this is the CRASH_LIMIT+1-th renderer loss within CRASH_WINDOW_MS. */
    private static boolean crashLoop() {
        long now = SystemClock.elapsedRealtime();
        long oldest = crashTimes[crashNext];
        crashTimes[crashNext] = now;
        crashNext = (crashNext + 1) % CRASH_LIMIT;
        return oldest != 0 && now - oldest < CRASH_WINDOW_MS;
    }

    private String appVersion() {
        return updater != null ? updater.ownName : "0";
    }

    private String buildInfo() {
        boolean tv = false, lowRam = false;
        try {
            UiModeManager m = (UiModeManager) getSystemService(Context.UI_MODE_SERVICE);
            tv = m != null && m.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
        } catch (Throwable ignored) {
            // keep false
        }
        try {
            ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
            lowRam = am != null && am.isLowRamDevice();
        } catch (Throwable ignored) {
            // keep false
        }
        String wv = "";
        if (Build.VERSION.SDK_INT >= 26) {
            try {
                wv = Compat.Api26.webViewPackage();
            } catch (Throwable ignored) {
                // unknown
            }
        }
        UpdateCore.Selection s = served;
        return "{\"app\":" + json(appVersion()) + ",\"sdk\":" + Build.VERSION.SDK_INT + ",\"tv\":" + tv
                + ",\"lowRam\":" + lowRam + ",\"webview\":" + json(wv)
                + ",\"model\":" + json(Build.MANUFACTURER + " " + Build.MODEL) + ",\"dev\":" + dev
                + ",\"apkCode\":" + (updater == null ? 0 : updater.ownCode)
                + ",\"content\":" + (s == null ? 0 : s.version)
                + ",\"contentSource\":\"" + (s != null && s.installed() ? "installed" : "bundled") + "\""
                + ",\"nativeApi\":" + UpdateCore.NATIVE_API + "}";
    }

    private static String json(String s) {
        StringBuilder b = new StringBuilder(s.length() + 2).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c < 0x20) b.append(' ');
            else b.append(c);
        }
        return b.append('"').toString();
    }

    private static int logLevel(ConsoleMessage m) {
        ConsoleMessage.MessageLevel l = m.messageLevel();
        if (l == ConsoleMessage.MessageLevel.ERROR) return Log.ERROR;
        if (l == ConsoleMessage.MessageLevel.WARNING) return Log.WARN;
        if (l == ConsoleMessage.MessageLevel.DEBUG) return Log.DEBUG;
        return Log.INFO;
    }
}
