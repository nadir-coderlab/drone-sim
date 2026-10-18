package com.nadir.dronesim;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInstaller;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Self-update through Android's own PackageInstaller session API (P9): no FileProvider, no androidx. The
 * downloaded APK (same package, same key, higher versionCode) is written into a session and committed with an
 * explicit PendingIntent back to MainActivity (singleTask -> onNewIntent, the WebView is not reloaded). Android
 * then shows its "update this app?" screen; installing over the old version keeps all app data (localStorage).
 */
final class ApkInstaller {
    private ApkInstaller() {}

    static final String TAG = "DroneSim";
    static final String ACTION_INSTALL_STATUS = "com.nadir.dronesim.action.INSTALL_STATUS";
    static final String EXTRA_TOKEN = "com.nadir.dronesim.extra.INSTALL_TOKEN";
    private static final int REQUEST_INSTALL = 4711;

    /** openUnknownSourcesSettings() results. */
    static final int SETTINGS_EXACT = 0, SETTINGS_GENERIC = 1, SETTINGS_NONE = -1;

    interface SessionListener {
        /** Called with the new session id before the session is committed. */
        void onSession(int id);
    }

    static boolean isInstallStatus(Intent i) {
        return i != null && ACTION_INSTALL_STATUS.equals(i.getAction());
    }

    /** API 26+: has the user allowed this app to install updates ("install unknown apps")? */
    static boolean mayInstall(Context c) {
        if (Build.VERSION.SDK_INT < 26) return true; // Android 7: the system checks "Unknown sources" itself
        try {
            return Compat.Api26.canRequestPackageInstalls(c.getPackageManager());
        } catch (Throwable t) {
            return true; // let the installer explain
        }
    }

    /** Writes the APK into a new session and commits it (any thread; IO). */
    static void commit(Context c, File apk, long token, SessionListener l) throws IOException {
        PackageInstaller pi = c.getPackageManager().getPackageInstaller();
        abandonMine(pi);
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
        params.setAppPackageName(c.getPackageName());
        params.setSize(apk.length());
        int id = pi.createSession(params);
        if (l != null) l.onSession(id);
        PackageInstaller.Session s = null;
        boolean ok = false;
        try {
            s = pi.openSession(id);
            InputStream in = new FileInputStream(apk);
            try {
                OutputStream out = s.openWrite("base.apk", 0, apk.length());
                try {
                    byte[] buf = new byte[64 * 1024];
                    int n;
                    while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
                    s.fsync(out);
                } finally {
                    out.close();
                }
            } finally {
                in.close();
            }
            Intent i = new Intent(c, MainActivity.class)
                    .setAction(ACTION_INSTALL_STATUS)
                    .putExtra(EXTRA_TOKEN, token)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 31) flags |= PendingIntent.FLAG_MUTABLE; // the installer fills in the status
            PendingIntent p = PendingIntent.getActivity(c, REQUEST_INSTALL, i, flags);
            s.commit(p.getIntentSender());
            ok = true;
        } finally {
            if (s != null) s.close();
            if (!ok) {
                try {
                    pi.abandonSession(id);
                } catch (Throwable ignored) {
                    // already gone
                }
            }
        }
    }

    /** Old sessions of ours (an earlier attempt the user never confirmed) only block storage. */
    private static void abandonMine(PackageInstaller pi) {
        try {
            for (PackageInstaller.SessionInfo si : pi.getMySessions()) {
                try {
                    pi.abandonSession(si.getSessionId());
                } catch (Throwable ignored) {
                    // committed or finished meanwhile
                }
            }
        } catch (Throwable t) {
            Log.w(TAG, "old install sessions", t);
        }
    }

    /**
     * STATUS_PENDING_USER_ACTION: the system's confirmation screen. URI grant flags are stripped so a forged
     * status intent could never make us hand out access to our files (callers check the token first anyway).
     */
    @SuppressWarnings("deprecation")
    static Intent confirmIntent(Intent status) {
        try {
            Object o = status.getParcelableExtra(Intent.EXTRA_INTENT);
            if (!(o instanceof Intent)) return null;
            Intent c = (Intent) o;
            c.setFlags(c.getFlags() & ~(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                    | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION));
            return c;
        } catch (Throwable t) {
            Log.w(TAG, "confirm intent", t);
            return null;
        }
    }

    /** PackageInstaller status -> reason code used in events / messages. */
    static String failureReason(int status) {
        switch (status) {
            case PackageInstaller.STATUS_FAILURE_ABORTED: return "aborted";
            case PackageInstaller.STATUS_FAILURE_STORAGE: return "disk";
            case PackageInstaller.STATUS_FAILURE_CONFLICT:
            case PackageInstaller.STATUS_FAILURE_INCOMPATIBLE:
            case PackageInstaller.STATUS_FAILURE_INVALID: return "apk-invalid";
            default: return "install-failed";
        }
    }

    /**
     * Opens the "install unknown apps" switch for this app, else the closest screen this TV has.
     * Returns SETTINGS_EXACT, SETTINGS_GENERIC (the user has to find the switch) or SETTINGS_NONE.
     */
    static int openUnknownSourcesSettings(Activity a) {
        Uri pkg = Uri.parse("package:" + a.getPackageName());
        List<Intent> tries = new ArrayList<Intent>();
        if (Build.VERSION.SDK_INT >= 26) {
            tries.add(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, pkg));
            tries.add(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES));
        }
        tries.add(new Intent(Settings.ACTION_SECURITY_SETTINGS));
        tries.add(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, pkg));
        tries.add(new Intent(Settings.ACTION_SETTINGS));
        for (int i = 0; i < tries.size(); i++) {
            try {
                a.startActivity(tries.get(i));
                return i == 0 && Build.VERSION.SDK_INT >= 26 ? SETTINGS_EXACT : SETTINGS_GENERIC;
            } catch (ActivityNotFoundException e) {
                // try the next one
            } catch (SecurityException e) {
                // try the next one
            }
        }
        return SETTINGS_NONE;
    }
}
