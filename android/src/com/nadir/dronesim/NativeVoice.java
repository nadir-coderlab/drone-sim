package com.nadir.dronesim;

import android.content.Context;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;
import android.webkit.JavascriptInterface;
import java.util.Locale;

/**
 * Android TextToSpeech exposed as window.NativeVoice. Android System WebView has no window.speechSynthesis,
 * so web/native-shim.js (injected into index.html by build.ps1) builds a small speechSynthesis polyfill on top
 * of this object; DS.Voice then works unchanged. Arabic (ar-SA, else any "ar") is the default language.
 *
 * Events go back to the page through Sink -> window.__dsVoiceEvt(type, id) with type start|end|error|voices.
 */
public final class NativeVoice implements TextToSpeech.OnInitListener {
    private static final String TAG = "DroneSim";

    interface Sink {
        /** Called on any thread; type and id contain only [A-Za-z0-9_-]. */
        void voiceEvent(String type, String id);
    }

    private final Sink sink;
    private TextToSpeech tts;
    private volatile boolean ready;
    private Locale arabic;   // null = no Arabic voice data on this box
    private Locale english;
    private Locale current;
    private volatile String voicesJson = "[]";

    NativeVoice(Context context, Sink sink) {
        this.sink = sink;
        try {
            tts = new TextToSpeech(context.getApplicationContext(), this);
        } catch (Throwable t) {
            Log.w(TAG, "TextToSpeech unavailable", t);
            tts = null;
        }
    }

    @Override
    public void onInit(int status) {
        synchronized (this) {
            if (status != TextToSpeech.SUCCESS || tts == null) {
                Log.w(TAG, "TextToSpeech init failed: " + status);
                return;
            }
            arabic = pick(new Locale("ar", "SA"), new Locale("ar"));
            english = pick(Locale.US, Locale.UK, Locale.ENGLISH);
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { sink.voiceEvent("start", safeId(id)); }
                @Override public void onDone(String id) { sink.voiceEvent("end", safeId(id)); }
                @Override @Deprecated public void onError(String id) { sink.voiceEvent("error", safeId(id)); }
                @Override public void onError(String id, int code) { sink.voiceEvent("error", safeId(id)); }
                @Override public void onStop(String id, boolean interrupted) { sink.voiceEvent("end", safeId(id)); }
            });
            StringBuilder j = new StringBuilder("[");
            if (arabic != null) j.append("{\"lang\":\"ar-SA\",\"name\":\"Android Arabic\",\"default\":true}");
            if (english != null) {
                if (arabic != null) j.append(',');
                j.append("{\"lang\":\"en-US\",\"name\":\"Android English\",\"default\":").append(arabic == null).append('}');
            }
            voicesJson = j.append(']').toString();
            ready = true;
            Log.i(TAG, "TTS ready, arabic=" + arabic + " english=" + english);
        }
        sink.voiceEvent("voices", "");
    }

    private Locale pick(Locale... options) {
        for (Locale l : options) {
            try {
                if (tts.isLanguageAvailable(l) >= TextToSpeech.LANG_AVAILABLE) return l;
            } catch (Throwable ignored) {
                // some engines throw for unknown locales
            }
        }
        return null;
    }

    /** True once the engine is up and has Arabic voice data. */
    @JavascriptInterface
    public boolean available() {
        return ready && arabic != null;
    }

    /** JSON array of {lang, name, default}; "[]" until ready. */
    @JavascriptInterface
    public String voices() {
        return voicesJson;
    }

    /**
     * Queue one utterance. lang "ar..."/"" = Arabic, "en..." = English. rate/pitch like the Web Speech API
     * (1 = normal), volume 0..1. Returns false when it cannot be spoken (no engine / no voice data).
     */
    @JavascriptInterface
    public synchronized boolean say(String text, String lang, double rate, double pitch, double volume, String id) {
        if (!ready || tts == null || text == null || text.length() == 0) return false;
        boolean en = lang != null && lang.toLowerCase(Locale.ROOT).startsWith("en");
        Locale want = en ? english : arabic;
        if (want == null) return false;
        try {
            if (!want.equals(current)) {
                if (tts.setLanguage(want) < TextToSpeech.LANG_AVAILABLE) return false;
                current = want;
            }
            tts.setSpeechRate((float) clamp(rate, 0.3, 3.0));
            tts.setPitch((float) clamp(pitch, 0.5, 2.0));
            Bundle params = new Bundle();
            params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, (float) clamp(volume, 0.0, 1.0));
            int max = TextToSpeech.getMaxSpeechInputLength();
            String t = text.length() > max ? text.substring(0, max) : text;
            return tts.speak(t, TextToSpeech.QUEUE_ADD, params, safeId(id)) == TextToSpeech.SUCCESS;
        } catch (Throwable e) {
            Log.w(TAG, "speak failed", e);
            return false;
        }
    }

    /** Stop speaking and drop the queue. */
    @JavascriptInterface
    public void stop() {
        TextToSpeech t = tts;
        if (t == null) return;
        try {
            t.stop();
        } catch (Throwable ignored) {
            // engine died; nothing to stop
        }
    }

    synchronized void shutdown() {
        ready = false;
        if (tts != null) {
            try {
                tts.stop();
                tts.shutdown();
            } catch (Throwable ignored) {
                // already gone
            }
            tts = null;
        }
    }

    private static double clamp(double v, double lo, double hi) {
        if (v != v) return lo; // NaN
        return v < lo ? lo : (v > hi ? hi : v);
    }

    /** Keep ids safe to paste into a JS string literal. */
    static String safeId(String id) {
        if (id == null || id.length() == 0) return "u";
        int n = Math.min(id.length(), 32);
        StringBuilder b = new StringBuilder(n);
        for (int i = 0; i < n; i++) {
            char c = id.charAt(i);
            if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-') b.append(c);
        }
        return b.length() == 0 ? "u" : b.toString();
    }
}
