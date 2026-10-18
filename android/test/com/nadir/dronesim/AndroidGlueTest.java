package com.nadir.dronesim;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Desktop checks of the Android glue that does not need a device: AssetClient's static guards (installed-folder
 * canonical-path check, release "https only" rule, MIME types) and the JavaScript MainActivity injects for
 * window.onNativeUpdate (run in node, if installed). Compile and run with android.jar on the class path:
 * the android.* classes are only stubs, so only code paths that never call into them are used here.
 */
public final class AndroidGlueTest {
    private static int pass, fail;
    private static final List<String> failed = new ArrayList<>();

    interface Body { void run() throws Exception; }

    public static void main(String[] args) throws Exception {
        File work = new File(System.getProperty("java.io.tmpdir"), "ds-glue-" + System.nanoTime());
        File root = new File(work, "content/1000");
        new File(root, "js").mkdirs();
        write(new File(root, "index.html"), "<!doctype html>");
        write(new File(root, "js/a.js"), "var a=1;");
        write(new File(work, "content/secret.txt"), "secret");

        test("AssetClient.openInstalled serves files inside the folder only", () -> {
            AssetClient.Root r = new AssetClient.Root(root);
            try (InputStream in = AssetClient.openInstalled(r, "index.html")) { ok(in != null, "index.html"); }
            try (InputStream in = AssetClient.openInstalled(r, "js/a.js")) { ok(in != null, "js/a.js"); }
            ok(AssetClient.openInstalled(r, "missing.js") == null, "missing -> null (404)");
            ok(AssetClient.openInstalled(r, "js") == null, "folder -> null");
            ok(AssetClient.openInstalled(r, "../secret.txt") == null, "../ -> null (canonical guard)");
            ok(AssetClient.openInstalled(r, "js/../../secret.txt") == null, "js/../../ -> null");
        });
        test("AssetClient release rule: https only (data/blob/about pass), http only when debuggable", () -> {
            ok(AssetClient.isAllowedExternal("https", false), "https");
            ok(!AssetClient.isAllowedExternal("http", false), "http refused in release");
            ok(AssetClient.isAllowedExternal("http", true), "http allowed in dev");
            ok(!AssetClient.isAllowedExternal("ws", false), "ws refused in release");
            ok(AssetClient.isAllowedExternal("data", false) && AssetClient.isAllowedExternal("blob", false)
                    && AssetClient.isAllowedExternal("about", false), "data/blob/about");
            ok(!AssetClient.isAllowedExternal("file", true) && !AssetClient.isAllowedExternal("content", true)
                    && !AssetClient.isAllowedExternal("ftp", true) && !AssetClient.isAllowedExternal("", true), "file/content/ftp/empty");
        });
        test("AssetClient MIME types", () -> {
            ok(AssetClient.mimeFor("js/a.js").equals("text/javascript") && AssetClient.mimeFor("INDEX.HTML").equals("text/html")
                    && AssetClient.mimeFor("x.wasm").equals("application/wasm") && AssetClient.mimeFor("noext").equals("application/octet-stream"), "mime");
        });
        test("Updater.message: every state/reason has short Arabic text", () -> {
            String[] states = {"checking", "downloading", "ready", "apk-available", "installing", "none"};
            for (String s : states) ok(Updater.message(s, "").length() > 0, s);
            String[] reasons = {"offline", "unreachable", "signature", "download", "install", "disk", "apk-invalid",
                    "aborted", "permission", "install-failed", "internal"};
            for (String r : reasons) ok(Updater.message("error", r).matches(".*[\\u0600-\\u06FF].*"), r);
        });

        test("MainActivity page-state rules: no dialog in flight / exam, content only at menu screens", () -> {
            for (String busy : new String[] {"fly:", "fly:pause", "fly:decision", "menu:thExam", "menu:thGrid", "menu:thSubmit",
                    "menu:thQuit", "menu:calib", "menu:remap", "pause:calib", "pause:remap"}) ok(MainActivity.isBusy(busy), "busy: " + busy);
            for (String free : new String[] {"menu:main", "pause:pause", "menu:thResult", "menu:thReview", "menu:thIntro",
                    "menu:settings", "menu:result", "menu:", "menu:thExamX", "", "calib", null}) ok(!MainActivity.isBusy(free), "not busy: " + free);
            for (String hub : new String[] {"menu:title", "menu:main", "menu:course", "menu:unit", "menu:pro",
                    "menu:proLevel", "menu:missions", "menu:theoryHome"}) ok(MainActivity.isHub(hub), hub);
            for (String no : new String[] {"fly:", "pause:pause", "menu:thExam", "menu:thPractice", "menu:result",
                    "menu:settings", "menu:", "", "main", null}) ok(!MainActivity.isHub(no), "not hub: " + no);
            ok(MainActivity.unquote("\"menu:main\"").equals("menu:main"), "unquote");
            ok(MainActivity.unquote("null").equals("") && MainActivity.unquote(null).equals("")
                    && MainActivity.unquote("\"").equals(""), "unquote non-strings");
        });

        String node = findNode();
        if (node == null) {
            System.out.println("SKIP onNativeUpdate JS glue (node not found)");
        } else {
            test("onNativeUpdate glue JS (MainActivity.HOOK_JS + UpdateCore.quote) in node: nohook / handled / seen", () -> {
                String hook = constant(MainActivity.class, "HOOK_JS");
                String health = constant(MainActivity.class, "HEALTH_JS");
                String json = new UpdateCore.Json().put("state", "apk-available").put("kind", "apk").put("version", 500)
                        .put("progress", -1.0).put("reason", "").put("message", Updater.message("apk-available", ""))
                        .put("manual", false).toString();
                String call = hook + UpdateCore.quote(json) + ")";
                String js = "var window=globalThis;var out=[];\n"
                        + "out.push(eval(" + UpdateCore.quote(call) + "));\n"
                        + "window.onNativeUpdate=function(j){var o=JSON.parse(j);return o.state==='apk-available'&&o.version===500&&o.message==="
                        + UpdateCore.quote(Updater.message("apk-available", "")) + ";};\n"
                        + "out.push(eval(" + UpdateCore.quote(call) + "));\n"
                        + "window.onNativeUpdate=function(){throw new Error('x');};\n"
                        + "out.push(eval(" + UpdateCore.quote(call) + "));\n"
                        + "window.onNativeUpdate=function(){};\n"
                        + "out.push(eval(" + UpdateCore.quote(call) + "));\n"
                        + "out.push(String(eval(" + UpdateCore.quote(health) + ")));\n"
                        + "window.DS={app:{}};out.push(String(eval(" + UpdateCore.quote(health) + ")));\n"            // content from before the ready flag
                        + "window.DS={app:{ready:false}};out.push(String(eval(" + UpdateCore.quote(health) + ")));\n" // init() failed
                        + "window.DS={app:{ready:true,no3d:true}};out.push(String(eval(" + UpdateCore.quote(health) + ")));\n" // started (WebGL off is ok)
                        + "console.log(out.join(','));\n";
                File f = new File(work, "glue.js");
                write(f, js);
                Process p = new ProcessBuilder(node, f.getPath()).redirectErrorStream(true).start();
                String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
                ok(p.waitFor() == 0, "node failed: " + out);
                ok(out.equals("nohook,handled,seen,seen,false,true,false,true"), "got " + out);
            });
            test("STATE_JS in node: '' without DS.app, 'state:screen' otherwise, never throws", () -> {
                String st = constant(MainActivity.class, "STATE_JS");
                String q = UpdateCore.quote(st);
                String js = "var window=globalThis;var out=[];\n"
                        + "out.push(JSON.stringify(eval(" + q + ")));\n"
                        + "window.DS={app:{state:'menu'},UI:{cur:{name:'main'}}};out.push(eval(" + q + "));\n"
                        + "window.DS.app.state='fly';window.DS.UI.cur=null;out.push(eval(" + q + "));\n"
                        + "window.DS.app.state='pause';window.DS.UI={cur:{name:'pause'}};out.push(eval(" + q + "));\n"
                        + "Object.defineProperty(window.DS,'UI',{get:function(){throw new Error('x');}});"
                        + "out.push(JSON.stringify(eval(" + q + ")));\n"
                        + "console.log(out.join(','));\n";
                File f = new File(work, "state.js");
                write(f, js);
                Process p = new ProcessBuilder(node, f.getPath()).redirectErrorStream(true).start();
                String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8).trim();
                ok(p.waitFor() == 0, "node failed: " + out);
                ok(out.equals("\"\",menu:main,fly:,pause:pause,\"\""), "got " + out);
            });
        }
        UpdateCore.deleteTree(work);
        System.out.println();
        System.out.println("RESULT: " + pass + " passed, " + fail + " failed" + (failed.isEmpty() ? "" : " " + failed));
        System.exit(fail == 0 ? 0 : 1);
    }

    static String constant(Class<?> c, String name) throws Exception {
        Field f = c.getDeclaredField(name);
        f.setAccessible(true);
        return (String) f.get(null);
    }

    static String findNode() {
        String path = System.getenv("PATH");
        if (path == null) return null;
        for (String d : path.split(File.pathSeparator)) {
            for (String n : new String[] {"node.exe", "node"}) {
                File f = new File(d.trim(), n);
                if (f.isFile()) return f.getPath();
            }
        }
        return null;
    }

    static void test(String name, Body b) {
        try {
            b.run();
            pass++;
            System.out.println("PASS " + name);
        } catch (Throwable t) {
            fail++;
            failed.add(name);
            System.out.println("FAIL " + name + ": " + t);
            t.printStackTrace(System.out);
        }
    }

    static void ok(boolean c, String what) {
        if (!c) throw new AssertionError(what);
    }

    static void write(File f, String s) throws Exception {
        f.getParentFile().mkdirs();
        try (OutputStream o = new FileOutputStream(f)) { o.write(s.getBytes(StandardCharsets.UTF_8)); }
    }
}
