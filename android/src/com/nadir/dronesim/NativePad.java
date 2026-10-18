package com.nadir.dronesim;

import android.app.Activity;
import android.os.Build;
import android.os.SystemClock;
import android.os.Vibrator;
import android.util.Log;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.webkit.JavascriptInterface;
import java.util.Locale;

/**
 * Gamepad bridge, exposed to the page as window.NativePad. The page uses the W3C Gamepad API first and only
 * falls back to this when getGamepads() reports nothing (see V2_CONTRACT section 5 / tv.md section 4).
 *
 * state() returns "seq,buttons,lx,ly,rx,ry,lt,rt,hatX,hatY,rawRX,rawRY":
 *   seq      0 = no controller input yet (or the active controller was removed): treat NativePad as absent.
 *            Otherwise it increments on every change.
 *   buttons  bit mask in W3C "standard gamepad" order: 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT,
 *            8 View/Select/Create, 9 Menu/Start/Options, 10 LS, 11 RS, 12 Up, 13 Down, 14 Left, 15 Right,
 *            16 Guide/Home, extras: 17 C, 18 Z, 19 Share/Record. Bits 12..15 also follow the hat axes.
 *            Bits 6/7 stay 0 on controllers with analog triggers (Xbox, DualShock 4, DualSense): read lt/rt.
 *            They are only used for pads with digital-only L2/R2 (then lt/rt are 0 or 1 as well).
 *   lx..ry   sticks -1..1, y down = + (same convention as the Gamepad API)
 *   lt, rt   0..1 = max(LTRIGGER, BRAKE) / max(RTRIGGER, GAS); for the legacy DualSense mapping (Android 11
 *            and older put the triggers on AXIS_RX/RY as -1..1) also max with (raw+1)/2 once -1 has been seen.
 *   hatX/Y   -1 / 0 / 1
 *   rawRX/RY AXIS_RX / AXIS_RY untouched.
 * Numbers have at most 4 decimals.
 *
 * Threading: onMotion/onKey run on the UI thread, the @JavascriptInterface methods on the WebView JavaBridge
 * thread, so all state is guarded by this object's monitor.
 */
public final class NativePad {
    private static final String TAG = "DroneSim";
    /** Another controller takes over when the active one has been silent this long. */
    private static final long SWITCH_IDLE_MS = 2000;
    private static final int AXES = 10;

    private final Activity activity;
    private final float[] ax = new float[AXES];
    private final StringBuilder sb = new StringBuilder(128);
    private int buttons;
    private int seq;
    private int deviceId = -1;
    private long lastEventMs;
    private String deviceName = "";
    private boolean analogTriggers;  // device reports LTRIGGER/BRAKE/RTRIGGER/GAS (or legacy Sony RX/RY)
    private boolean legacyCandidate; // Sony pad with RX/RY but no trigger axes (old Android, no hid-playstation)
    private boolean legacyTriggers;  // ... and RX/RY rested at -1, so they really are the triggers
    private int padCount;
    private String info = "{}";

    NativePad(Activity activity) {
        this.activity = activity;
    }

    // ------------------------------------------------------------------ fed by MainActivity (UI thread)

    /** Joystick ACTION_MOVE (sticks, triggers, hat). */
    synchronized void onMotion(MotionEvent e) {
        if (!accept(e.getDeviceId(), false)) return;
        ax[0] = e.getAxisValue(MotionEvent.AXIS_X);
        ax[1] = e.getAxisValue(MotionEvent.AXIS_Y);
        ax[2] = e.getAxisValue(MotionEvent.AXIS_Z);
        ax[3] = e.getAxisValue(MotionEvent.AXIS_RZ);
        ax[4] = Math.max(e.getAxisValue(MotionEvent.AXIS_LTRIGGER), e.getAxisValue(MotionEvent.AXIS_BRAKE));
        ax[5] = Math.max(e.getAxisValue(MotionEvent.AXIS_RTRIGGER), e.getAxisValue(MotionEvent.AXIS_GAS));
        ax[6] = e.getAxisValue(MotionEvent.AXIS_HAT_X);
        ax[7] = e.getAxisValue(MotionEvent.AXIS_HAT_Y);
        ax[8] = e.getAxisValue(MotionEvent.AXIS_RX);
        ax[9] = e.getAxisValue(MotionEvent.AXIS_RY);
        if (ax[4] > 0.05f || ax[5] > 0.05f) analogTriggers = true;
        if (legacyCandidate && (ax[8] <= -0.9f || ax[9] <= -0.9f)) legacyTriggers = true;
        seq++;
    }

    /** Gamepad button down/up. Returns false when the key is not a pad button we track. */
    synchronized boolean onKey(KeyEvent e, boolean down) {
        int bit = bitFor(e.getKeyCode());
        if (bit < 0) return false;
        if (!accept(e.getDeviceId(), down)) return true;
        int before = buttons;
        if (down) buttons |= 1 << bit; else buttons &= ~(1 << bit);
        if (buttons != before) seq++;
        return true;
    }

    /** Release everything (app paused). Keeps seq at 0 when no controller has been used yet. */
    synchronized void clear() {
        for (int i = 0; i < AXES; i++) ax[i] = 0f;
        buttons = 0;
        if (seq > 0) seq++;
    }

    synchronized void onDeviceRemoved(int id) {
        if (id == deviceId) {
            for (int i = 0; i < AXES; i++) ax[i] = 0f;
            buttons = 0;
            deviceId = -1;
            deviceName = "";
            seq = 0; // the page falls back to keyboard / "connect a controller"
        }
        refreshConnected();
    }

    /** Count connected physical controllers (UI thread: start, resume, device added/removed). */
    synchronized void refreshConnected() {
        int n = 0;
        int[] ids = InputDevice.getDeviceIds();
        for (int id : ids) {
            InputDevice d = InputDevice.getDevice(id);
            if (d != null && !d.isVirtual() && isPadSource(d.getSources())) n++;
        }
        padCount = n;
    }

    synchronized void setInfo(String json) {
        info = json == null ? "{}" : json;
    }

    static boolean isPadSource(int src) {
        return (src & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
                || (src & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK;
    }

    /** Android key code -> W3C standard button index (or -1). */
    static int bitFor(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_BUTTON_A: return 0;
            case KeyEvent.KEYCODE_BUTTON_B: return 1;
            case KeyEvent.KEYCODE_BUTTON_X: return 2;
            case KeyEvent.KEYCODE_BUTTON_Y: return 3;
            case KeyEvent.KEYCODE_BUTTON_L1: return 4;
            case KeyEvent.KEYCODE_BUTTON_R1: return 5;
            case KeyEvent.KEYCODE_BUTTON_L2: return 6;
            case KeyEvent.KEYCODE_BUTTON_R2: return 7;
            case KeyEvent.KEYCODE_BUTTON_SELECT: return 8;
            case KeyEvent.KEYCODE_BUTTON_START: return 9;
            case KeyEvent.KEYCODE_BUTTON_THUMBL: return 10;
            case KeyEvent.KEYCODE_BUTTON_THUMBR: return 11;
            case KeyEvent.KEYCODE_DPAD_UP: return 12;
            case KeyEvent.KEYCODE_DPAD_DOWN: return 13;
            case KeyEvent.KEYCODE_DPAD_LEFT: return 14;
            case KeyEvent.KEYCODE_DPAD_RIGHT: return 15;
            case KeyEvent.KEYCODE_BUTTON_MODE: return 16;
            case KeyEvent.KEYCODE_BUTTON_C: return 17;
            case KeyEvent.KEYCODE_BUTTON_Z: return 18;
            case KeyEvent.KEYCODE_MEDIA_RECORD: return 19; // Xbox Series "Share"
            default: return -1;
        }
    }

    /**
     * One controller drives the state at a time: the first one seen, or another one that presses a button
     * or moves after the active one has been idle for SWITCH_IDLE_MS. Caller holds the lock.
     */
    private boolean accept(int id, boolean buttonDown) {
        long now = SystemClock.uptimeMillis();
        if (id != deviceId) {
            boolean idle = deviceId == -1 || now - lastEventMs > SWITCH_IDLE_MS;
            if (!buttonDown && !idle) return false;
            deviceId = id;
            for (int i = 0; i < AXES; i++) ax[i] = 0f;
            buttons = 0;
            InputDevice d = InputDevice.getDevice(id);
            deviceName = d == null ? "Gamepad"
                    : String.format(Locale.ROOT, "%s (Vendor: %04x Product: %04x)", d.getName(), d.getVendorId(), d.getProductId());
            analogTriggers = d != null && (d.getMotionRange(MotionEvent.AXIS_LTRIGGER) != null
                    || d.getMotionRange(MotionEvent.AXIS_RTRIGGER) != null
                    || d.getMotionRange(MotionEvent.AXIS_BRAKE) != null
                    || d.getMotionRange(MotionEvent.AXIS_GAS) != null);
            legacyCandidate = d != null && !analogTriggers && d.getVendorId() == 0x054c
                    && d.getMotionRange(MotionEvent.AXIS_RX) != null;
            legacyTriggers = false;
            Log.i(TAG, "active controller: " + deviceName + (analogTriggers ? " [analog triggers]" : "")
                    + (legacyCandidate ? " [legacy Sony triggers?]" : ""));
        }
        lastEventMs = now;
        return true;
    }

    // ------------------------------------------------------------------ page API (JavaBridge thread)

    /** "seq,buttons,lx,ly,rx,ry,lt,rt,hatX,hatY,rawRX,rawRY" (see class comment). */
    @JavascriptInterface
    public synchronized String state() {
        int b = buttons;
        float lt = ax[4], rt = ax[5];
        if (legacyTriggers) {
            lt = Math.max(lt, (ax[8] + 1f) * 0.5f);
            rt = Math.max(rt, (ax[9] + 1f) * 0.5f);
        }
        if (analogTriggers || legacyCandidate) {
            b &= ~((1 << 6) | (1 << 7)); // analog value lives in lt/rt; a "pressed" bit would hide it
        } else {
            if ((b & (1 << 6)) != 0) lt = 1f; // digital-only L2/R2
            if ((b & (1 << 7)) != 0) rt = 1f;
        }
        if (ax[7] < -0.5f) b |= 1 << 12;
        if (ax[7] > 0.5f) b |= 1 << 13;
        if (ax[6] < -0.5f) b |= 1 << 14;
        if (ax[6] > 0.5f) b |= 1 << 15;
        sb.setLength(0);
        sb.append(seq).append(',').append(b);
        for (int i = 0; i < AXES; i++) {
            sb.append(',');
            appendFixed4(sb, i == 4 ? lt : (i == 5 ? rt : ax[i]));
        }
        return sb.toString();
    }

    /** Active controller "Name (Vendor: 045e Product: 0b13)", or "" before any controller input. */
    @JavascriptInterface
    public synchronized String device() {
        return deviceName;
    }

    /** Number of connected physical controllers (0 = show the pairing help instead of "press A"). */
    @JavascriptInterface
    public synchronized int count() {
        return padCount;
    }

    /** JSON: {"app","sdk","tv","lowRam","webview","dev"} filled in by MainActivity. */
    @JavascriptInterface
    public synchronized String info() {
        return info;
    }

    /** Close the app (e.g. an "exit" item in the main menu). */
    @JavascriptInterface
    public void exit() {
        activity.runOnUiThread(new Runnable() {
            @Override public void run() {
                activity.finish();
            }
        });
    }

    /**
     * Rumble the active controller. strong/weak 0..1, ms > 0 (capped at 2 s); ms <= 0 or both 0 stops.
     * Android exposes one combined motor per InputDevice before API 31, so the stronger value wins.
     */
    @JavascriptInterface
    public void rumble(double strong, double weak, double ms) {
        int id;
        synchronized (this) {
            id = deviceId;
        }
        if (id == -1) return;
        try {
            InputDevice d = InputDevice.getDevice(id);
            if (d == null) return;
            @SuppressWarnings("deprecation") Vibrator v = d.getVibrator();
            if (v == null || !v.hasVibrator()) return;
            double amp = Math.max(0, Math.min(1, Math.max(strong, weak)));
            long dur = (long) Math.min(2000, ms);
            if (dur <= 0 || amp <= 0.01) {
                v.cancel();
            } else if (Build.VERSION.SDK_INT >= 26) {
                Compat.Api26.vibrate(v, dur, Math.max(1, (int) Math.round(amp * 255)));
            } else {
                legacyVibrate(v, dur);
            }
        } catch (Throwable t) {
            Log.w(TAG, "rumble failed", t);
        }
    }

    @SuppressWarnings("deprecation")
    private static void legacyVibrate(Vibrator v, long ms) {
        v.vibrate(ms);
    }

    /** Append v with up to 4 decimals, no allocation, no exponent notation. */
    private static void appendFixed4(StringBuilder out, float v) {
        if (v != v) v = 0f; // NaN
        int n = Math.round(Math.abs(v) * 10000f); // round the magnitude: +x and -x stay symmetric
        if (v < 0f && n != 0) out.append('-');
        out.append(n / 10000);
        int frac = n % 10000;
        if (frac == 0) return;
        out.append('.');
        if (frac < 1000) out.append('0');
        if (frac < 100) out.append('0');
        if (frac < 10) out.append('0');
        while (frac % 10 == 0) frac /= 10; // trim trailing zeros
        out.append(frac);
    }
}
