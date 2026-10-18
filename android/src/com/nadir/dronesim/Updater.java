package com.nadir.dronesim;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.res.AssetManager;
import android.net.ConnectivityManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.security.PublicKey;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Properties;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Android side of the self-updater (protocol in UpdateCore). One per process, so a download keeps going if
 * the Activity is rebuilt. All network / disk work runs on one background thread, so checks never overlap and
 * never touch the UI thread; results reach the Activity through Listener on the UI thread.
 *
 *  - Web content: downloaded + verified + extracted in the background, served from the next cold start,
 *    as soon as the page shows a menu screen (MainActivity.pollApply), or at once when the page calls
 *    NativeUpdate.applyNow(). No reinstall, localStorage untouched.
 *  - APK: downloaded + verified (manifest signature, SHA-256, package name, versionCode, signer), then the
 *    Activity asks the user and ApkInstaller hands it to Android's own "update" screen (data kept).
 */
final class Updater {
    static final String TAG = "DroneSim";
    static final long RESUME_CHECK_MS = 30L * 60 * 1000;
    /** A failed check (PC not serving yet, offline) is repeated on the next resume, but not more often than this. */
    static final long RETRY_AFTER_FAIL_MS = 15L * 1000;
    static final long SNOOZE_MS = 24L * 60 * 60 * 1000;

    interface Listener {
        /** UI thread. json is the event for window.onNativeUpdate (P8). */
        void onUpdateEvent(String state, String reason, String json, boolean manual);
    }

    /** A verified newer APK waiting to be installed. */
    static final class PendingApk {
        final long code;
        final String name, notes;
        final File file;

        PendingApk(long code, String name, String notes, File file) {
            this.code = code;
            this.name = name;
            this.notes = notes;
            this.file = file;
        }
    }

    private static Updater instance;

    static synchronized Updater get(Context c) {
        if (instance == null) {
            UpdateCore.log = new UpdateCore.Logger() {
                @Override public void i(String msg) { Log.i(TAG, "update: " + msg); }
                @Override public void w(String msg, Throwable t) { Log.w(TAG, "update: " + msg, t); }
            };
            instance = new Updater(c.getApplicationContext());
        }
        return instance;
    }

    private final Context app;
    final UpdateCore.Store store;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService exec;
    private final AtomicBoolean busy = new AtomicBoolean();
    private volatile boolean manualRequested;
    private volatile boolean again;
    private volatile Listener listener;
    final long bundledContent;
    final long ownCode;
    final String ownName;
    private final List<String> configSources;
    private volatile List<PublicKey> keys;
    private volatile boolean releaseKey;
    private volatile UpdateCore.Selection served;
    private volatile String state = "none";
    private volatile String reason = "";
    private volatile double progress = -1;

    private Updater(Context app) {
        this.app = app;
        store = new UpdateCore.Store(new File(app.getFilesDir(), "updates"));
        exec = Executors.newSingleThreadExecutor(new ThreadFactory() {
            @Override
            public Thread newThread(Runnable r) {
                Thread t = new Thread(r, "ds-updater");
                t.setDaemon(true);
                t.setPriority(Thread.MIN_PRIORITY + 1); // never compete with the WebGL renderer
                return t;
            }
        });
        AssetManager am = app.getAssets();
        long b = 0;
        try {
            b = UpdateCore.readVersion(am.open(UpdateCore.CONTENT_VERSION_FILE));
        } catch (IOException e) {
            Log.w(TAG, "no assets/" + UpdateCore.CONTENT_VERSION_FILE + " (old build): bundled content = 0");
        }
        bundledContent = b;
        List<String> src = new ArrayList<String>();
        try {
            InputStream in = am.open("update-config.properties");
            try {
                Properties p = new Properties();
                p.load(new InputStreamReader(in, UpdateCore.UTF8));
                src = UpdateCore.parseSources(p.getProperty("sources"));
            } finally {
                UpdateCore.closeQuietly(in);
            }
        } catch (Exception e) {
            Log.w(TAG, "no assets/update-config.properties: using sources=lan");
        }
        if (src.isEmpty()) src.add(UpdateCore.SOURCE_LAN);
        configSources = src;
        long code = 0;
        String name = "0";
        try {
            PackageInfo pi = app.getPackageManager().getPackageInfo(app.getPackageName(), 0);
            code = versionCode(pi);
            if (pi.versionName != null) name = pi.versionName;
        } catch (PackageManager.NameNotFoundException e) {
            Log.e(TAG, "own package not found", e);
        }
        ownCode = code;
        ownName = name;
        Log.i(TAG, "updater: apk " + ownCode + " (" + ownName + "), bundled content " + bundledContent
                + ", native api " + UpdateCore.NATIVE_API + ", sources " + configSources);
    }

    void setListener(Listener l) {
        listener = l;
    }

    void clearListener(Listener l) {
        if (listener == l) listener = null;
    }

    // ------------------------------------------------------------------ content selection (UI thread)

    /**
     * Cold start: what to serve now (P6). Installed content that already took the app down twice before its
     * health check (crash loop across restarts, P7) is marked bad here. Clean-up follows on the updater thread.
     */
    UpdateCore.Selection selectForStart() {
        final UpdateCore.Selection s = store.selectForStart(bundledContent, UpdateCore.NATIVE_API, UpdateCore.MAX_START_ATTEMPTS);
        served = s;
        exec.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    store.gc(s.installed() ? s.version : 0, bundledContent);
                    keys(); // also logs whether this APK carries the release key
                    if (store.getLong(UpdateCore.K_APK_CODE, 0) != 0 && store.getLong(UpdateCore.K_APK_CODE, 0) <= ownCode) {
                        store.clearApk(); // this APK already is that update (or newer)
                        store.set(UpdateCore.K_INSTALL_TOKEN, null);
                        store.set(UpdateCore.K_INSTALL_SESSION, null);
                        store.save();
                    }
                } catch (Throwable t) {
                    Log.w(TAG, "update clean-up", t);
                }
            }
        });
        Log.i(TAG, "serving " + s);
        return s;
    }

    UpdateCore.Selection served() {
        return served;
    }

    /** P7: the served installed version failed; returns what to serve instead. */
    UpdateCore.Selection rollback(long version) {
        UpdateCore.Selection s = store.rollback(version, bundledContent, UpdateCore.NATIVE_API);
        served = s;
        Log.w(TAG, "content " + version + " is bad, now serving " + s);
        return s;
    }

    /**
     * P7 across restarts: called (UI thread, saved at once) right before installed version v is loaded.
     * Returns false when v already passed a health check (no trial needed).
     */
    boolean beginTrial(long v) {
        if (store.isGood(v)) return false;
        store.beginTrial(v);
        return true;
    }

    /** passed: the health check passed (v is good); else that run ended cleanly before the check. */
    void endTrial(long v, boolean passed) {
        if (passed) store.passTrial(v);
        else store.cancelTrial(v);
    }

    boolean hasPendingContent() {
        UpdateCore.Selection cur = served;
        UpdateCore.Selection next = store.select(bundledContent, UpdateCore.NATIVE_API);
        return cur == null || next.version != cur.version || next.installed() != cur.installed();
    }

    /** NativeUpdate.applyNow(): the newer selection, or null when nothing changes. */
    UpdateCore.Selection applyPending() {
        if (!hasPendingContent()) return null;
        UpdateCore.Selection next = store.select(bundledContent, UpdateCore.NATIVE_API);
        served = next;
        Log.i(TAG, "applying " + next + " now");
        return next;
    }

    // ------------------------------------------------------------------ checks

    /** On resume: every 30 min, or again soon after a check that found nothing reachable. */
    boolean dueForCheck() {
        return UpdateCore.checkDue(store.getLong(UpdateCore.K_LAST_CHECK, 0), store.getLong(UpdateCore.K_LAST_OK, 0),
                System.currentTimeMillis(), RESUME_CHECK_MS, RETRY_AFTER_FAIL_MS);
    }

    /** Starts a check on the updater thread; a second request while one runs is folded into it. */
    void check(final boolean manual) {
        if (manual) manualRequested = true;
        if (!busy.compareAndSet(false, true)) {
            if (manual) { // fold into the running check, then run once more (e.g. setServer() just changed)
                again = true;
                emit("checking", "", 0, -1, "");
            }
            return;
        }
        exec.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    runCheck();
                } catch (Throwable t) {
                    Log.e(TAG, "update check crashed", t);
                    emit("error", "", 0, -1, "internal");
                } finally {
                    manualRequested = false;
                    busy.set(false);
                }
                if (again) {
                    again = false;
                    check(true);
                }
            }
        });
    }

    private void runCheck() {
        if (!hasNetwork()) {
            store.set(UpdateCore.K_LAST_CHECK, System.currentTimeMillis());
            store.save();
            emit("error", "", 0, -1, "offline");
            offerStoredApk();
            return;
        }
        List<PublicKey> k = keys();
        if (k.isEmpty()) {
            emit("error", "", 0, -1, "internal");
            return;
        }
        UpdateCore.Env env = new UpdateCore.Env();
        env.keys = k;
        env.ownApkCode = ownCode;
        env.bundledContent = bundledContent;
        UpdateCore.Selection s = served;
        env.servedContent = s == null ? bundledContent : s.version;
        env.configSources = configSources;
        env.now = System.currentTimeMillis();
        UpdateCore.check(store, env, new UpdateCore.Events() {
            @Override
            public void event(String st, String kind, long version, double prog, String why) {
                emit(st, kind, version, prog, why);
            }
        });
        offerStoredApk();
    }

    /** A verified newer APK on disk (from this check or an earlier one) -> "apk-available". */
    private void offerStoredApk() {
        PendingApk p = pendingApk();
        if (p == null) return;
        try {
            String sha = store.get(UpdateCore.K_APK_SHA);
            if (sha == null || !sha.equals(UpdateCore.sha256Hex(p.file)) || !verifyArchive(p.file, p.code)) {
                Log.w(TAG, "downloaded APK " + p.code + " rejected");
                store.clearApk();
                emit("error", "apk", p.code, -1, "apk-invalid");
                return;
            }
        } catch (IOException e) {
            store.clearApk();
            emit("error", "apk", p.code, -1, "apk-invalid");
            return;
        }
        emit("apk-available", "apk", p.code, -1, "");
    }

    PendingApk pendingApk() {
        long code = store.getLong(UpdateCore.K_APK_CODE, 0);
        if (code <= ownCode) return null;
        File f = store.apkFile(code);
        if (!f.isFile()) return null;
        String name = store.get(UpdateCore.K_APK_NAME), notes = store.get(UpdateCore.K_APK_NOTES);
        return new PendingApk(code, name == null ? "" : name, notes == null ? "" : notes, f);
    }

    boolean promptAllowed(long code, boolean manual) {
        return UpdateCore.apkPromptAllowed(code, store.getLong(UpdateCore.K_SNOOZE_CODE, 0),
                store.getLong(UpdateCore.K_SNOOZE_UNTIL, 0), System.currentTimeMillis(), manual);
    }

    /** An explicit "later": do not ask again for this versionCode for 24 h, or until the PC publishes again. */
    void snooze(final long code) {
        exec.execute(new Runnable() {
            @Override
            public void run() {
                store.snooze(code, System.currentTimeMillis() + SNOOZE_MS);
            }
        });
    }

    /** NativeUpdate.setServer(url): LAN address (remembered as lanUrl) or https source; then a manual check. */
    boolean setServer(String url) {
        final String b = UpdateCore.normalizeUserServer(url);
        if (b == null) return false;
        exec.execute(new Runnable() {
            @Override
            public void run() {
                if (UpdateCore.isLanUrl(b)) {
                    store.set(UpdateCore.K_LAN, b);
                } else {
                    List<String> list = UpdateCore.parseSources(store.get(UpdateCore.K_SOURCES));
                    list.remove(b);
                    list.add(0, b);
                    while (list.size() > UpdateCore.MAX_SOURCES) list.remove(list.size() - 1);
                    store.set(UpdateCore.K_SOURCES, UpdateCore.joinSources(list));
                }
                store.save();
            }
        });
        check(true);
        return true;
    }

    // ------------------------------------------------------------------ APK install (P9)

    /** Re-verifies the downloaded APK and hands it to PackageInstaller (updater thread). */
    void install() {
        exec.execute(new Runnable() {
            @Override
            public void run() {
                PendingApk p = pendingApk();
                if (p == null) {
                    emit("error", "apk", 0, -1, "apk-invalid");
                    return;
                }
                try {
                    String sha = store.get(UpdateCore.K_APK_SHA);
                    if (sha == null || !sha.equals(UpdateCore.sha256Hex(p.file)) || !verifyArchive(p.file, p.code)) {
                        store.clearApk();
                        emit("error", "apk", p.code, -1, "apk-invalid");
                        return;
                    }
                    long token = new SecureRandom().nextLong();
                    if (token == 0) token = 1;
                    store.set(UpdateCore.K_INSTALL_TOKEN, token);
                    store.set(UpdateCore.K_INSTALL_SESSION, null);
                    store.save(); // before commit: the status intent can arrive at once
                    emit("installing", "apk", p.code, -1, "");
                    ApkInstaller.commit(app, p.file, token, new ApkInstaller.SessionListener() {
                        @Override
                        public void onSession(int id) {
                            store.set(UpdateCore.K_INSTALL_SESSION, id);
                            store.save();
                        }
                    });
                    Log.i(TAG, "APK " + p.code + " handed to the package installer");
                } catch (Throwable t) {
                    Log.e(TAG, "APK install failed", t);
                    emit("error", "apk", p.code, -1, "install-failed");
                }
            }
        });
    }

    /** True only for status intents of our own session (random token + session id, see ApkInstaller). */
    boolean acceptInstallStatus(Intent i) {
        if (i == null) return false;
        long token = i.getLongExtra(ApkInstaller.EXTRA_TOKEN, 0);
        long want = store.getLong(UpdateCore.K_INSTALL_TOKEN, 0);
        if (token == 0 || token != want) return false;
        long session = store.getLong(UpdateCore.K_INSTALL_SESSION, -1);
        int got = i.getIntExtra(android.content.pm.PackageInstaller.EXTRA_SESSION_ID, -1);
        return session == -1 || got == -1 || session == got;
    }

    /** Final status from the package installer (UI thread). */
    void installFinished(boolean ok, String why) {
        store.set(UpdateCore.K_INSTALL_TOKEN, null);
        store.set(UpdateCore.K_INSTALL_SESSION, null);
        store.save();
        PendingApk p = pendingApk();
        if (ok) emit("none", "apk", p == null ? 0 : p.code, -1, "");
        else emit("error", "apk", p == null ? 0 : p.code, -1, why);
    }

    void emitError(String kind, String why) {
        emit("error", kind, 0, -1, why);
    }

    // ------------------------------------------------------------------ verification helpers

    /** P9: our package name, the announced versionCode (newer than ours) and, when readable, our signer. */
    boolean verifyArchive(File f, long code) {
        try {
            PackageManager pm = app.getPackageManager();
            PackageInfo pi = pm.getPackageArchiveInfo(f.getPath(), 0);
            if (pi == null || !app.getPackageName().equals(pi.packageName)) {
                Log.w(TAG, "APK is not " + app.getPackageName());
                return false;
            }
            long vc = versionCode(pi);
            if (vc != code || vc <= ownCode) {
                Log.w(TAG, "APK versionCode " + vc + " (expected " + code + ", own " + ownCode + ")");
                return false;
            }
            List<byte[]> theirs = certs(f.getPath()), ours = certs(null);
            if (!theirs.isEmpty() && !ours.isEmpty() && !sameCerts(theirs, ours)) {
                Log.w(TAG, "APK is signed with another key");
                return false;
            }
            return true;
        } catch (Throwable t) {
            Log.w(TAG, "APK check", t);
            return false;
        }
    }

    private static boolean sameCerts(List<byte[]> a, List<byte[]> b) {
        if (a.size() != b.size()) return false;
        for (byte[] x : a) {
            boolean hit = false;
            for (byte[] y : b) if (Arrays.equals(x, y)) hit = true;
            if (!hit) return false;
        }
        return true;
    }

    /** Signer certificates of this app (archive == null) or of an APK file. */
    @SuppressWarnings("deprecation")
    private List<byte[]> certs(String archive) {
        PackageManager pm = app.getPackageManager();
        List<byte[]> out = new ArrayList<byte[]>();
        try {
            if (Build.VERSION.SDK_INT >= 28) return Compat.Api28.signingCerts(pm, app.getPackageName(), archive);
            PackageInfo p = archive == null
                    ? pm.getPackageInfo(app.getPackageName(), PackageManager.GET_SIGNATURES)
                    : pm.getPackageArchiveInfo(archive, PackageManager.GET_SIGNATURES);
            if (p != null && p.signatures != null) for (android.content.pm.Signature s : p.signatures) out.add(s.toByteArray());
        } catch (Throwable t) {
            Log.w(TAG, "signing certificates", t);
        }
        return out;
    }

    /** P2: trust only our own signing certificate(s), read at runtime. */
    private List<PublicKey> keys() {
        List<PublicKey> k = keys;
        if (k != null && !k.isEmpty()) return k;
        List<byte[]> c = certs(null);
        k = UpdateCore.keysFromCertificates(c);
        boolean rel = false;
        for (byte[] der : c) if (UpdateCore.RELEASE_CERT_SHA256.equals(UpdateCore.sha256Hex(der))) rel = true;
        releaseKey = rel;
        if (!rel) Log.w(TAG, "this APK is not signed with the release key " + UpdateCore.RELEASE_CERT_SHA256);
        keys = k;
        return k;
    }

    @SuppressWarnings("deprecation")
    static long versionCode(PackageInfo p) {
        return Build.VERSION.SDK_INT >= 28 ? Compat.Api28.versionCode(p) : p.versionCode;
    }

    @SuppressWarnings("deprecation")
    private boolean hasNetwork() {
        try {
            ConnectivityManager cm = (ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE);
            if (cm == null) return true;
            android.net.NetworkInfo ni = cm.getActiveNetworkInfo();
            return ni != null && ni.isConnected();
        } catch (Throwable t) {
            return true; // let the check find out
        }
    }

    // ------------------------------------------------------------------ events / info (P8)

    private void emit(final String st, String kind, long version, double prog, final String why) {
        state = st;
        reason = why == null ? "" : why;
        progress = prog;
        final boolean manual = manualRequested;
        final String json = new UpdateCore.Json().put("state", st).put("kind", kind == null ? "" : kind)
                .put("version", version).put("progress", prog).put("reason", reason)
                .put("message", message(st, reason)).put("manual", manual).toString();
        ui.post(new Runnable() {
            @Override
            public void run() {
                Listener l = listener;
                if (l != null) l.onUpdateEvent(st, why == null ? "" : why, json, manual);
            }
        });
    }

    /** NativeUpdate.info() (any thread). */
    String infoJson() {
        UpdateCore.Selection s = served;
        long sv = s == null ? bundledContent : s.version;
        UpdateCore.Json pending = new UpdateCore.Json();
        UpdateCore.Selection next = store.select(bundledContent, UpdateCore.NATIVE_API);
        if (s != null && (next.version != s.version || next.installed() != s.installed())) pending.put("content", next.version);
        PendingApk p = pendingApk();
        if (p != null) pending.put("apk", p.code).put("apkName", p.name).put("notes", p.notes);
        return new UpdateCore.Json()
                .put("apkCode", ownCode).put("apkName", ownName).put("nativeApi", UpdateCore.NATIVE_API)
                .put("contentVersion", sv).put("contentSource", s != null && s.installed() ? "installed" : "bundled")
                .put("bundledVersion", bundledContent)
                .put("state", state).put("progress", progress).put("reason", reason).put("message", message(state, reason))
                .put("lastCheck", store.getLong(UpdateCore.K_LAST_CHECK, 0)).put("lanUrl", store.get(UpdateCore.K_LAN))
                .put("sources", UpdateCore.joinSources(configSources)
                        + (store.get(UpdateCore.K_SOURCES) == null ? "" : ";" + store.get(UpdateCore.K_SOURCES)))
                .put("releaseKey", releaseKey)
                .raw("pending", pending.toString()).toString();
    }

    /** Short, simple Saudi Arabic text for a state / reason (page hook "message", native toasts). */
    static String message(String st, String why) {
        if ("checking".equals(st)) return "قاعد يدوّر على تحديث…";
        if ("downloading".equals(st)) return "قاعد ينزّل التحديث…";
        if ("ready".equals(st)) return "نزل تحديث جديد، بيشتغل أول ما ترجع للقائمة الرئيسية";
        if ("apk-available".equals(st)) return "فيه نسخة جديدة من التطبيق";
        if ("installing".equals(st)) return "قاعد يثبّت التحديث…";
        if ("none".equals(st)) return "عندك آخر نسخة، ما فيه تحديث جديد";
        if (!"error".equals(st)) return "";
        if ("offline".equals(why)) return "الجهاز مو متصل بالشبكة";
        if ("unreachable".equals(why)) return "ما لقينا التحديث. تأكد إن الكمبيوتر شغّال وعلى نفس الواي فاي";
        if ("signature".equals(why)) return "ملف التحديث مو موقّع بمفتاحك، ما ثبّتناه";
        if ("download".equals(why)) return "التحميل ما كمل، بنحاول مرة ثانية بعدين";
        if ("install".equals(why)) return "ملفات التحديث فيها مشكلة، ما ثبّتناها";
        if ("disk".equals(why)) return "المساحة ما تكفي للتحديث";
        if ("apk-invalid".equals(why)) return "ملف التحديث مو حق هالتطبيق، ما ثبّتناه";
        if ("aborted".equals(why)) return "ما تم التحديث. تقدر تحدّث بعدين";
        if ("permission".equals(why)) return "لازم تسمح للتطبيق يثبّت التحديثات";
        return "ما زبط التحديث، جرّب مرة ثانية بعدين";
    }
}
