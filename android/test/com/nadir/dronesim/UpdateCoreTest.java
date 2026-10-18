package com.nadir.dronesim;

import com.sun.net.httpserver.HttpServer;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.cert.Certificate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

/**
 * Desktop tests of UpdateCore (pure Java). No JUnit needed: run main(); exit code 0 = all passed.
 * Every socket binds to 127.0.0.1 only (no Windows Firewall prompt). Keys are throwaway, made here.
 *
 *   javac -d out src/com/nadir/dronesim/UpdateCore.java test/com/nadir/dronesim/UpdateCoreTest.java
 *   java -cp out [-Dsignupdate=path/to/SignUpdate.java] com.nadir.dronesim.UpdateCoreTest
 */
public final class UpdateCoreTest {
    private static int pass, fail;
    private static final List<String> failed = new ArrayList<>();
    private static File work;
    private static KeyPair kp, other;
    private static InetAddress LOOP;

    interface Body { void run() throws Exception; }

    public static void main(String[] args) throws Exception {
        LOOP = InetAddress.getByName("127.0.0.1");
        work = new File(System.getProperty("java.io.tmpdir"), "ds-ota-test-" + System.nanoTime());
        if (!work.mkdirs()) throw new IOException("mkdir " + work);
        KeyPairGenerator g = KeyPairGenerator.getInstance("RSA");
        g.initialize(2048);
        kp = g.generateKeyPair();
        other = g.generateKeyPair();
        UpdateCore.log = new UpdateCore.Logger() { // keep the output readable
            @Override public void i(String msg) { }
            @Override public void w(String msg, Throwable t) { }
        };

        hexAndJson();
        manifestParsing();
        signatures();
        keytoolAndSignUpdateInterop();
        urls();
        discoveryReplies();
        discoveryLoopback();
        extraction();
        store();
        decisions();
        engine();

        UpdateCore.deleteTree(work);
        System.out.println();
        System.out.println("RESULT: " + pass + " passed, " + fail + " failed" + (failed.isEmpty() ? "" : " " + failed));
        System.exit(fail == 0 ? 0 : 1);
    }

    // ------------------------------------------------------------------------------------------ helpers

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

    static void eq(Object got, Object want, String what) {
        if (got == null ? want != null : !got.equals(want)) throw new AssertionError(what + ": expected <" + want + "> got <" + got + ">");
    }

    static void fails(Body b, String contains, String what) {
        try {
            b.run();
        } catch (IOException e) {
            if (contains != null && !String.valueOf(e.getMessage()).contains(contains)) {
                throw new AssertionError(what + ": wrong error '" + e.getMessage() + "' (wanted '" + contains + "')");
            }
            return;
        } catch (Exception e) {
            throw new AssertionError(what + ": unexpected " + e);
        }
        throw new AssertionError(what + ": no error");
    }

    static File dir(String name) {
        File d = new File(work, name + "-" + System.nanoTime());
        if (!d.mkdirs()) throw new IllegalStateException("mkdir " + d);
        return d;
    }

    static byte[] utf8(String s) { return s.getBytes(StandardCharsets.UTF_8); }

    static String sign(byte[] data, PrivateKey k) throws Exception {
        Signature s = Signature.getInstance("SHA256withRSA");
        s.initSign(k);
        s.update(data);
        return UpdateCore.hex(s.sign());
    }

    static byte[] zip(Object... nameData) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        try (ZipOutputStream z = new ZipOutputStream(bo)) {
            for (int i = 0; i < nameData.length; i += 2) {
                z.putNextEntry(new ZipEntry((String) nameData[i]));
                Object d = nameData[i + 1];
                if (d != null) z.write(d instanceof byte[] ? (byte[]) d : utf8(String.valueOf(d)));
                z.closeEntry();
            }
        }
        return bo.toByteArray();
    }

    static byte[] content(long version) throws IOException {
        return zip("index.html", "<!doctype html><script src=\"native-shim.js\"></script>",
                "native-shim.js", "//shim", "js/", null, "js/main.js", "window.DS={app:{}};",
                UpdateCore.CONTENT_VERSION_FILE, version + "\n");
    }

    static File write(File f, byte[] b) throws IOException {
        f.getParentFile().mkdirs();
        try (OutputStream o = new FileOutputStream(f)) { o.write(b); }
        return f;
    }

    static byte[] read(File f) throws IOException {
        try (InputStream in = new FileInputStream(f)) {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) != -1) bo.write(b, 0, n);
            return bo.toByteArray();
        }
    }

    static UpdateCore.Manifest contentManifest(long v, byte[] zip, int minNative) {
        UpdateCore.Manifest m = new UpdateCore.Manifest();
        m.hasContent = true;
        m.contentVersion = v;
        m.contentFile = "content-" + v + ".zip";
        m.contentSize = zip.length;
        m.contentSha256 = UpdateCore.sha256Hex(zip);
        m.contentMinNative = minNative;
        return m;
    }

    static int freePort() throws IOException {
        try (ServerSocket s = new ServerSocket(0, 1, LOOP)) { return s.getLocalPort(); }
    }

    /** Static HTTP server on 127.0.0.1 with a request log; files listed in `chunked` are sent without length. */
    static final class Srv implements AutoCloseable {
        final HttpServer s;
        final Map<String, byte[]> files = new ConcurrentHashMap<>();
        final Set<String> chunked = Collections.newSetFromMap(new ConcurrentHashMap<>());
        final List<String> hits = Collections.synchronizedList(new ArrayList<>());

        Srv() throws IOException {
            s = HttpServer.create(new InetSocketAddress(LOOP, 0), 0);
            s.createContext("/", ex -> {
                String path = ex.getRequestURI().getPath();
                String name = path.startsWith("/") ? path.substring(1) : path;
                hits.add(name);
                byte[] b = files.get(name);
                if (b == null) {
                    ex.sendResponseHeaders(404, -1);
                    ex.close();
                    return;
                }
                ex.sendResponseHeaders(200, chunked.contains(name) ? 0 : b.length);
                try (OutputStream os = ex.getResponseBody()) { os.write(b); }
            });
            s.start();
        }

        String base() { return "http://127.0.0.1:" + s.getAddress().getPort() + "/"; }

        long count(String name) { synchronized (hits) { return hits.stream().filter(name::equals).count(); } }

        /** Publish: manifest text (UTF-8) + its signature with `key`. */
        void publish(String manifest, PrivateKey key) throws Exception {
            byte[] m = utf8(manifest);
            files.put(UpdateCore.MANIFEST, m);
            files.put(UpdateCore.SIGNATURE, utf8(sign(m, key) + "\n"));
        }

        @Override public void close() { s.stop(0); }
    }

    /** UDP responder on 127.0.0.1 (the PC side of P5). */
    static final class Responder implements AutoCloseable {
        final DatagramSocket sock;
        volatile String reply;
        volatile int requests;
        final Thread t;

        Responder(String reply) throws IOException {
            this.reply = reply;
            sock = new DatagramSocket(0, LOOP);
            t = new Thread(() -> {
                byte[] buf = new byte[256];
                while (!sock.isClosed()) {
                    try {
                        DatagramPacket p = new DatagramPacket(buf, buf.length);
                        sock.receive(p);
                        String msg = new String(p.getData(), 0, p.getLength(), StandardCharsets.US_ASCII);
                        if (!msg.equals(UpdateCore.DISCOVERY_REQUEST)) continue;
                        requests++;
                        String r = this.reply;
                        if (r == null) continue;
                        for (String part : r.split("\\|")) { // several replies in a row: "garbage|good"
                            byte[] b = part.getBytes(StandardCharsets.US_ASCII);
                            sock.send(new DatagramPacket(b, b.length, p.getAddress(), p.getPort()));
                        }
                    } catch (IOException e) {
                        return;
                    }
                }
            }, "responder");
            t.setDaemon(true);
            t.start();
        }

        int port() { return sock.getLocalPort(); }

        @Override public void close() { sock.close(); }
    }

    static final class Rec implements UpdateCore.Events {
        final List<String> ev = Collections.synchronizedList(new ArrayList<>());

        @Override
        public void event(String state, String kind, long version, double progress, String reason) {
            if (state.equals("downloading")) {
                if (ev.isEmpty() || !ev.get(ev.size() - 1).startsWith("downloading:" + kind)) ev.add("downloading:" + kind + ":" + version);
                return;
            }
            ev.add(state + ":" + kind + ":" + version + ":" + reason);
        }

        String last() { return ev.isEmpty() ? "" : ev.get(ev.size() - 1); }

        boolean has(String prefix) { synchronized (ev) { return ev.stream().anyMatch(s -> s.startsWith(prefix)); } }

        @Override public String toString() { return ev.toString(); }
    }

    static UpdateCore.Env env(List<String> sources, long ownApk, long bundled) {
        UpdateCore.Env e = new UpdateCore.Env();
        e.keys = Collections.singletonList(kp.getPublic());
        e.ownApkCode = ownApk;
        e.bundledContent = bundled;
        e.servedContent = bundled;
        e.configSources = new ArrayList<>(sources);
        e.discoveryBind = LOOP;
        e.discoveryTargets = Collections.singletonList(LOOP);
        e.discoveryWaitMs = 600;
        try { e.discoveryPort = freePort(); } catch (IOException x) { throw new IllegalStateException(x); }
        return e;
    }

    static String manifestText(long cv, byte[] zip, int minNative, long apkCode, byte[] apk, String extra) {
        StringBuilder b = new StringBuilder("# test manifest\nformat=1\npublished=1760000000000\n");
        if (zip != null) {
            b.append("content.version=").append(cv).append('\n')
                    .append("content.file=content-").append(cv).append(".zip\n")
                    .append("content.size=").append(zip.length).append('\n')
                    .append("content.sha256=").append(UpdateCore.sha256Hex(zip)).append('\n')
                    .append("content.minNative=").append(minNative).append('\n');
        }
        if (apk != null) {
            b.append("apk.versionCode=").append(apkCode).append('\n')
                    .append("apk.versionName=2.").append(apkCode).append('\n')
                    .append("apk.file=DroneSim-").append(apkCode).append(".apk\n")
                    .append("apk.size=").append(apk.length).append('\n')
                    .append("apk.sha256=").append(UpdateCore.sha256Hex(apk)).append('\n');
        }
        b.append("notes=تحسينات في الطيران، وتقدّمك ما يضيع\n");
        if (extra != null) b.append(extra);
        return b.toString();
    }

    // ------------------------------------------------------------------------------------------ tests

    static void hexAndJson() {
        test("hex round trip + invalid hex", () -> {
            byte[] b = {0, 1, (byte) 0xab, (byte) 0xff, 0x7f};
            eq(UpdateCore.hex(b), "0001abff7f", "hex");
            ok(Arrays.equals(UpdateCore.unhex("0001ABff7f"), b), "unhex mixed case");
            ok(UpdateCore.unhex("abc") == null, "odd length");
            ok(UpdateCore.unhex("zz") == null, "not hex");
            ok(UpdateCore.unhex("") == null, "empty");
            eq(UpdateCore.sha256Hex(new byte[0]), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "sha256('')");
        });
        test("JSON/JS string quoting escapes quotes, controls, non-ASCII, U+2028, <", () -> {
            eq(UpdateCore.quote("a\"b\\c\n\u2028\u0639<'"), "\"a\\\"b\\\\c\\n\\u2028\\u0639\\u003c\\u0027\"", "quote");
            eq(UpdateCore.quote(null), "null", "null");
            String j = new UpdateCore.Json().put("s", "x").put("n", 5).put("b", true).put("p", 0.4567).raw("o", "{}").toString();
            eq(j, "{\"s\":\"x\",\"n\":5,\"b\":true,\"p\":0.457,\"o\":{}}", "json");
        });
    }

    static void manifestParsing() {
        test("manifest: full valid manifest incl. Arabic notes and sources", () -> {
            byte[] zip = content(1000);
            byte[] apk = utf8("fake apk");
            String t = manifestText(1000, zip, 1, 500, apk, "sources=lan;https://Example.github.io/ds;ftp://x/;http://8.8.8.8/\n");
            UpdateCore.Manifest m = UpdateCore.Manifest.parse(utf8(t));
            ok(m.hasContent && m.hasApk, "both groups");
            eq(m.contentVersion, 1000L, "content.version");
            eq(m.contentFile, "content-1000.zip", "content.file");
            eq(m.contentSize, (long) zip.length, "content.size");
            eq(m.contentMinNative, 1, "minNative");
            eq(m.apkVersionCode, 500L, "apk code");
            eq(m.apkVersionName, "2.500", "apk name");
            eq(m.notes, "تحسينات في الطيران، وتقدّمك ما يضيع", "Arabic notes (UTF-8)");
            eq(m.sources, Arrays.asList("lan", "https://example.github.io/ds/"), "sources (ftp + public http dropped)");
        });
        test("manifest: content-only and apk-only manifests", () -> {
            UpdateCore.Manifest c = UpdateCore.Manifest.parse(utf8(manifestText(7, content(7), 1, 0, null, null)));
            ok(c.hasContent && !c.hasApk, "content only");
            UpdateCore.Manifest a = UpdateCore.Manifest.parse(utf8(manifestText(0, null, 1, 9, utf8("x"), null)));
            ok(!a.hasContent && a.hasApk, "apk only");
        });
        String sha = UpdateCore.sha256Hex(new byte[1]);
        String[][] bad = {
            {"format=2\n", "format"},
            {"published=1\n", "format"},
            {"format=1\ncontent.version=5\ncontent.file=../x.zip\ncontent.size=1\ncontent.sha256=" + sha + "\n", "content.file"},
            {"format=1\ncontent.version=5\ncontent.file=a/b.zip\ncontent.size=1\ncontent.sha256=" + sha + "\n", "content.file"},
            {"format=1\ncontent.version=5\ncontent.file=.hidden\ncontent.size=1\ncontent.sha256=" + sha + "\n", "content.file"},
            {"format=1\ncontent.version=5\ncontent.file=a b.zip\ncontent.size=1\ncontent.sha256=" + sha + "\n", "content.file"},
            {"format=1\ncontent.version=5\ncontent.file=c.zip\ncontent.size=1\ncontent.sha256=abc\n", "content.sha256"},
            {"format=1\ncontent.version=5\ncontent.file=c.zip\ncontent.size=999999999999\ncontent.sha256=" + sha + "\n", "content.size"},
            {"format=1\ncontent.version=5\ncontent.file=c.zip\ncontent.sha256=" + sha + "\n", "content.size"},
            {"format=1\ncontent.version=x\n", "content.version"},
            {"format=1\napk.versionCode=3\napk.file=..\napk.size=1\napk.sha256=" + sha + "\n", "apk.file"},
            {"format=1\napk.versionCode=3\napk.file=a.apk\napk.size=0\napk.sha256=" + sha + "\n", "apk.size"},
            {"format=1\nnotes=\\uZZZZ\n", "unreadable"},
        };
        for (String[] b : bad) {
            String shown = b[0].replace("\n", "\\n");
            test("manifest rejected: " + b[1] + " <- " + shown.substring(0, Math.min(60, shown.length())), () ->
                    fails(() -> UpdateCore.Manifest.parse(utf8(b[0])), b[1], "parse"));
        }
        test("manifest rejected: bigger than 64 KB", () -> {
            byte[] big = new byte[UpdateCore.MAX_MANIFEST_BYTES + 1];
            Arrays.fill(big, (byte) '#');
            fails(() -> UpdateCore.Manifest.parse(big), "size", "big");
        });
    }

    static void signatures() {
        test("signature: good / tampered data / wrong key / garbage / empty / uppercase+newline", () -> {
            byte[] data = utf8(manifestText(5, content(5), 1, 0, null, null));
            String sig = sign(data, kp.getPrivate());
            List<PublicKey> keys = Collections.singletonList(kp.getPublic());
            ok(UpdateCore.verifySignature(data, utf8(sig), keys), "good signature");
            byte[] tampered = data.clone();
            tampered[tampered.length - 2] ^= 1;
            ok(!UpdateCore.verifySignature(tampered, utf8(sig), keys), "tampered data");
            ok(!UpdateCore.verifySignature(data, utf8(sign(data, other.getPrivate())), keys), "other key");
            ok(!UpdateCore.verifySignature(data, utf8("zz"), keys), "garbage");
            ok(!UpdateCore.verifySignature(data, new byte[0], keys), "empty");
            ok(!UpdateCore.verifySignature(data, null, keys), "missing");
            ok(!UpdateCore.verifySignature(data, utf8(sig), Collections.<PublicKey>emptyList()), "no trusted keys");
            ok(UpdateCore.verifySignature(data, utf8(sig.toUpperCase() + "\r\n"), keys), "uppercase + CRLF");
            ok(UpdateCore.verifySignature(data, utf8(sig), Arrays.asList(other.getPublic(), kp.getPublic())), "second of two keys");
        });
    }

    /** keytool-made throwaway PKCS12 -> cert DER -> keysFromCertificates; plus PC tool SignUpdate.java if present. */
    static void keytoolAndSignUpdateInterop() {
        String home = System.getProperty("java.home");
        File keytool = new File(home, "bin/keytool" + (File.separatorChar == '\\' ? ".exe" : ""));
        File java = new File(home, "bin/java" + (File.separatorChar == '\\' ? ".exe" : ""));
        if (!keytool.isFile()) {
            System.out.println("SKIP keytool interop (no keytool in " + home + ")");
            return;
        }
        final File d = dir("ks");
        final File ks = new File(d, "throwaway.p12");
        final String pass = "throwaway-" + System.nanoTime(); // test-only keystore, deleted afterwards
        test("keytool throwaway keystore -> certificate -> keysFromCertificates verifies", () -> {
            ProcessBuilder pb = new ProcessBuilder(keytool.getPath(), "-genkeypair", "-keystore", ks.getPath(), "-storetype", "PKCS12",
                    "-alias", "t", "-keyalg", "RSA", "-keysize", "2048", "-validity", "2", "-dname", "CN=OTA test",
                    "-storepass:env", "DS_KS_PASS", "-keypass:env", "DS_KS_PASS");
            pb.environment().put("DS_KS_PASS", pass);
            pb.redirectErrorStream(true);
            Process p = pb.start();
            String out = new String(readAll(p.getInputStream()), StandardCharsets.UTF_8);
            ok(p.waitFor() == 0, "keytool failed: " + out);
            KeyStore k = KeyStore.getInstance("PKCS12");
            try (InputStream in = new FileInputStream(ks)) { k.load(in, pass.toCharArray()); }
            Certificate cert = k.getCertificate("t");
            PrivateKey pk = (PrivateKey) k.getKey("t", pass.toCharArray());
            byte[] data = utf8("format=1\n");
            List<PublicKey> keys = UpdateCore.keysFromCertificates(Collections.singletonList(cert.getEncoded()));
            eq(keys.size(), 1, "one key from the certificate");
            ok(UpdateCore.verifySignature(data, utf8(sign(data, pk)), keys), "signature with cert key");
            ok(UpdateCore.keysFromCertificates(Collections.singletonList(new byte[] {1, 2, 3})).isEmpty(), "garbage cert ignored");
        });
        String su = System.getProperty("signupdate");
        if (su == null || !new File(su).isFile()) {
            System.out.println("SKIP SignUpdate.java interop (-Dsignupdate not given)");
            UpdateCore.deleteTree(d);
            return;
        }
        test("PC tool SignUpdate.java sign/cert output verifies in UpdateCore (P2 interop)", () -> {
            File in = write(new File(d, "update.properties"), utf8(manifestText(42, content(42), 1, 0, null, null)));
            File sig = new File(d, "update.properties.sig");
            ProcessBuilder pb = new ProcessBuilder(java.getPath(), su, "sign", ks.getPath(), "t", in.getPath(), sig.getPath());
            pb.environment().put("DS_KS_PASS", pass);
            pb.redirectErrorStream(true);
            Process p = pb.start();
            String out = new String(readAll(p.getInputStream()), StandardCharsets.UTF_8);
            ok(p.waitFor() == 0, "SignUpdate sign failed: " + out);
            KeyStore k = KeyStore.getInstance("PKCS12");
            try (InputStream is = new FileInputStream(ks)) { k.load(is, pass.toCharArray()); }
            byte[] der = k.getCertificate("t").getEncoded();
            ok(UpdateCore.verifySignature(read(in), read(sig), UpdateCore.keysFromCertificates(Collections.singletonList(der))), "sig verifies");
            ok(new String(read(sig), StandardCharsets.US_ASCII).matches("[0-9a-f]+"), "lowercase hex, no newline");
            pb = new ProcessBuilder(java.getPath(), su, "cert", ks.getPath(), "t");
            pb.environment().put("DS_KS_PASS", pass);
            pb.redirectErrorStream(true);
            p = pb.start();
            out = new String(readAll(p.getInputStream()), StandardCharsets.UTF_8).trim();
            ok(p.waitFor() == 0, "SignUpdate cert failed: " + out);
            eq(out, UpdateCore.sha256Hex(der), "cert SHA-256 printed by SignUpdate == SHA-256 of the DER the app sees");
        });
        UpdateCore.deleteTree(d);
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] b = new byte[4096];
        int n;
        while ((n = in.read(b)) != -1) bo.write(b, 0, n);
        return bo.toByteArray();
    }

    static void urls() {
        test("normalizeBase / normalizeSource / normalizeUserServer / isLanIpv4", () -> {
            eq(UpdateCore.normalizeBase("https://User.GitHub.io/ds"), "https://user.github.io/ds/", "https + slash");
            eq(UpdateCore.normalizeBase("https://h.example/a/b/"), "https://h.example/a/b/", "https path");
            eq(UpdateCore.normalizeBase("http://192.168.1.5:47801"), "http://192.168.1.5:47801/", "LAN http");
            eq(UpdateCore.normalizeBase("http://8.8.8.8/"), null, "public http refused");
            eq(UpdateCore.normalizeBase("http://example.com/"), null, "http hostname refused");
            eq(UpdateCore.normalizeBase("ftp://192.168.1.5/"), null, "ftp");
            eq(UpdateCore.normalizeBase("https://h/p?q=1"), null, "query");
            eq(UpdateCore.normalizeBase("https://h/p#f"), null, "fragment");
            eq(UpdateCore.normalizeBase("https://u:p@h/"), null, "user info");
            eq(UpdateCore.normalizeBase("https://h/a/../b/"), null, "dot-dot");
            eq(UpdateCore.normalizeBase("https://h:0/"), null, "port 0");
            eq(UpdateCore.normalizeSource(" LAN "), "lan", "lan keyword");
            eq(UpdateCore.normalizeUserServer("192.168.1.9"), "http://192.168.1.9:47801/", "bare IP gets default port");
            eq(UpdateCore.normalizeUserServer("10.0.0.2:8080"), "http://10.0.0.2:8080/", "IP:port");
            eq(UpdateCore.normalizeUserServer("https://x.github.io/u"), "https://x.github.io/u/", "https");
            eq(UpdateCore.normalizeUserServer("hello"), null, "junk");
            ok(UpdateCore.isLanIpv4("10.1.2.3") && UpdateCore.isLanIpv4("172.16.0.1") && UpdateCore.isLanIpv4("172.31.255.1")
                    && UpdateCore.isLanIpv4("192.168.0.1") && UpdateCore.isLanIpv4("127.0.0.1") && UpdateCore.isLanIpv4("169.254.3.4"), "LAN");
            ok(!UpdateCore.isLanIpv4("172.32.0.1") && !UpdateCore.isLanIpv4("8.8.8.8") && !UpdateCore.isLanIpv4("192.168.1.256")
                    && !UpdateCore.isLanIpv4("192.168.1") && !UpdateCore.isLanIpv4("x.y.z.w"), "not LAN");
            eq(UpdateCore.parseSources("lan;;https://a.b/c;lan;http://1.1.1.1/"), Arrays.asList("lan", "https://a.b/c/"), "parseSources");
        });
    }

    static void discoveryReplies() {
        test("discovery reply parsing", () -> {
            InetAddress pc = InetAddress.getByName("192.168.1.20");
            eq(UpdateCore.parseReply("DRONESIM!1 http://192.168.1.20:47801/", pc), Arrays.asList("http://192.168.1.20:47801/"), "same host");
            eq(UpdateCore.parseReply("DRONESIM!1 http://192.168.56.1:47801/\n", pc),
                    Arrays.asList("http://192.168.1.20:47801/", "http://192.168.56.1:47801/"), "sender address first when it differs");
            ok(UpdateCore.parseReply("DRONESIM!1 http://8.8.8.8:47801/", pc).isEmpty(), "public IP");
            ok(UpdateCore.parseReply("DRONESIM!2 http://192.168.1.20:47801/", pc).isEmpty(), "other protocol version");
            ok(UpdateCore.parseReply("DRONESIM!1 https://192.168.1.20:47801/", pc).isEmpty(), "https not part of P5");
            ok(UpdateCore.parseReply("DRONESIM!1 http://192.168.1.20:99999/", pc).isEmpty(), "bad port");
            ok(UpdateCore.parseReply("DRONESIM!1 http://192.168.1.20:47801/x", pc).isEmpty(), "path");
            ok(UpdateCore.parseReply("hello", pc).isEmpty(), "garbage");
            ok(UpdateCore.broadcastTargets().contains(InetAddress.getByName("255.255.255.255")), "broadcastTargets has 255.255.255.255");
        });
    }

    static void discoveryLoopback() {
        test("UDP discovery over loopback finds the responder", () -> {
            try (Responder r = new Responder("DRONESIM!1 http://127.0.0.1:47801/")) {
                long t0 = System.nanoTime();
                List<String> got = UpdateCore.discover(Collections.singletonList(LOOP), r.port(), LOOP, 1500);
                long ms = (System.nanoTime() - t0) / 1000000;
                eq(got, Arrays.asList("http://127.0.0.1:47801/"), "url");
                ok(ms < 1000, "returns at the first good reply (" + ms + " ms)");
                ok(r.requests >= 1, "request seen");
            }
        });
        test("UDP discovery skips a garbage reply and takes the next good one", () -> {
            try (Responder r = new Responder("NOPE|DRONESIM!1 http://8.8.8.8:1/|DRONESIM!1 http://127.0.0.1:5000/")) {
                eq(UpdateCore.discover(Collections.singletonList(LOOP), r.port(), LOOP, 1500),
                        Arrays.asList("http://127.0.0.1:5000/"), "url");
            }
        });
        test("UDP discovery: silent responder -> empty after ~1.5 s, request resent once", () -> {
            try (Responder r = new Responder(null)) {
                long t0 = System.nanoTime();
                List<String> got = UpdateCore.discover(Collections.singletonList(LOOP), r.port(), LOOP, 1500);
                long ms = (System.nanoTime() - t0) / 1000000;
                ok(got.isEmpty(), "nothing found");
                ok(ms >= 1400 && ms < 2500, "waited " + ms + " ms");
                Thread.sleep(50);
                eq(r.requests, 2, "requests (initial + one resend)");
            }
        });
        test("UDP discovery: nobody listening -> empty, no exception", () -> {
            ok(UpdateCore.discover(Collections.singletonList(LOOP), freePort(), LOOP, 500).isEmpty(), "empty");
        });
    }

    static void extraction() {
        test("extract: good zip (dirs, nested files, version file)", () -> {
            File d = dir("x-good");
            File z = write(new File(work, "good.zip"), content(77));
            UpdateCore.extract(z, d, 1 << 20, 100, 77);
            ok(new File(d, "index.html").isFile() && new File(d, "js/main.js").isFile() && new File(d, "native-shim.js").isFile(), "files");
            eq(new String(read(new File(d, "js/main.js")), StandardCharsets.UTF_8), "window.DS={app:{}};", "content");
        });
        Object[][] slip = {
            {"../evil.txt", "bad entry name"},
            {"js/../../evil.txt", "bad entry name"},
            {"/abs.txt", "bad entry name"},
            {"js\\evil.txt", "bad entry name"},
            {"C:/evil.txt", "bad entry name"},
            {"js//x.js", "bad entry name"},
            {"./index2.html", "bad entry name"},
            {".complete", "reserved"},
            {".meta", "reserved"},
        };
        for (Object[] s : slip) {
            test("extract rejects zip-slip / bad name: " + s[0], () -> {
                File d = dir("x-slip");
                File z = write(new File(work, "slip-" + System.nanoTime() + ".zip"),
                        zip("index.html", "x", UpdateCore.CONTENT_VERSION_FILE, "1", (String) s[0], "pwned"));
                fails(() -> UpdateCore.extract(z, d, 1 << 20, 100, 1), (String) s[1], "extract");
                ok(!new File(work, "evil.txt").exists() && !new File(d.getParentFile(), "evil.txt").exists(), "nothing written outside");
            });
        }
        test("extract rejects more uncompressed bytes than the limit (zip bomb style)", () -> {
            File d = dir("x-big");
            byte[] zeros = new byte[3 << 20]; // compresses to a few KB
            File z = write(new File(work, "big.zip"), zip("index.html", "x", UpdateCore.CONTENT_VERSION_FILE, "1", "lib/big.bin", zeros));
            ok(z.length() < 100_000, "small on disk");
            fails(() -> UpdateCore.extract(z, d, 1 << 20, 100, 1), "bigger than", "limit");
        });
        test("extract rejects more than the entry limit", () -> {
            File d = dir("x-many");
            List<Object> parts = new ArrayList<>(Arrays.asList("index.html", "x", UpdateCore.CONTENT_VERSION_FILE, "1"));
            for (int i = 0; i < 20; i++) { parts.add("f" + i + ".txt"); parts.add("x"); }
            File z = write(new File(work, "many.zip"), zip(parts.toArray()));
            fails(() -> UpdateCore.extract(z, d, 1 << 20, 10, 1), "too many entries", "entries");
        });
        test("extract rejects a zip without index.html", () -> {
            File z = write(new File(work, "noindex.zip"), zip("main.html", "x", UpdateCore.CONTENT_VERSION_FILE, "1"));
            fails(() -> UpdateCore.extract(z, dir("x-noindex"), 1 << 20, 100, 1), "index.html missing", "index");
        });
        test("extract rejects content-version.txt that differs from content.version (or is missing)", () -> {
            File z = write(new File(work, "ver.zip"), content(5));
            fails(() -> UpdateCore.extract(z, dir("x-ver"), 1 << 20, 100, 6), "expected 6", "mismatch");
            File z2 = write(new File(work, "nover.zip"), zip("index.html", "x"));
            fails(() -> UpdateCore.extract(z2, dir("x-nover"), 1 << 20, 100, 6), "expected 6", "missing");
        });
        test("extract rejects duplicate names (case-insensitive)", () -> {
            File z = write(new File(work, "dup.zip"), zip("index.html", "x", "INDEX.HTML", "y", UpdateCore.CONTENT_VERSION_FILE, "1"));
            fails(() -> UpdateCore.extract(z, dir("x-dup"), 1 << 20, 100, 1), "duplicate", "dup");
        });
        test("extract rejects a file that is not a zip", () -> {
            File z = write(new File(work, "notzip.zip"), utf8("hello"));
            fails(() -> UpdateCore.extract(z, dir("x-nz"), 1 << 20, 100, 1), null, "not a zip");
        });
    }

    static void store() {
        test("store: nothing installed -> bundled", () -> {
            UpdateCore.Store s = new UpdateCore.Store(dir("st-empty"));
            UpdateCore.Selection sel = s.select(100, 1);
            ok(!sel.installed() && sel.version == 100, "bundled " + sel);
        });
        test("store: install -> selected next start; previous kept; rollback chain; state persists", () -> {
            File root = dir("st-chain");
            UpdateCore.Store s = new UpdateCore.Store(root);
            byte[] z1 = content(200), z2 = content(300);
            File f1 = write(new File(s.tmp, "content-200.zip"), z1), f2 = write(new File(s.tmp, "content-300.zip"), z2);
            eq(s.install(f1, contentManifest(200, z1, 1)), 200L, "install 200");
            ok(new File(s.dirFor(200), UpdateCore.COMPLETE_MARKER).isFile(), "marker written");
            eq(s.select(100, 1).version, 200L, "200 wins over bundled 100");
            ok(s.select(100, 1).installed(), "installed");
            s.install(f2, contentManifest(300, z2, 1));
            eq(s.getLong(UpdateCore.K_CURRENT, 0), 300L, "current");
            eq(s.getLong(UpdateCore.K_PREVIOUS, 0), 200L, "previous");
            eq(s.getLong(UpdateCore.K_MAX, 0), 300L, "max");
            eq(s.floor(100, 100), 300L, "floor");
            UpdateCore.Store again = new UpdateCore.Store(root); // fresh process
            eq(again.select(100, 1).version, 300L, "persisted");
            eq(again.rollback(300, 100, 1).version, 200L, "300 bad -> previous 200");
            ok(again.isBad(300), "300 marked bad");
            UpdateCore.Selection last = again.rollback(200, 100, 1);
            ok(!last.installed() && last.version == 100, "both bad -> bundled");
            eq(new UpdateCore.Store(root).bad(), new HashSet<>(Arrays.asList(300L, 200L)), "bad list persisted");
            ok(s.tmp.list().length == 2, "install leaves no extraction folder in tmp (only the 2 zips we put there)");
        });
        test("store: bundled newer than installed -> bundled; gc forgets + deletes old folders and tmp", () -> {
            UpdateCore.Store s = new UpdateCore.Store(dir("st-gc"));
            byte[] z = content(500);
            s.install(write(new File(s.tmp, "c.zip"), z), contentManifest(500, z, 1));
            ok(!s.select(600, 1).installed(), "bundled 600 > installed 500");
            new File(s.content, "123").mkdirs();
            new File(s.content, "junk").mkdirs();
            write(new File(s.tmp, "leftover.part"), utf8("x"));
            s.gc(600, 600);
            eq(s.getLong(UpdateCore.K_CURRENT, 0), 0L, "current forgotten");
            ok(s.content.list().length == 0, "content folders deleted: " + Arrays.toString(s.content.list()));
            ok(s.tmp.list().length == 0, "tmp emptied");
        });
        test("store: gc keeps served/current/previous", () -> {
            UpdateCore.Store s = new UpdateCore.Store(dir("st-gc2"));
            for (long v : new long[] {700, 800, 900}) {
                byte[] z = content(v);
                s.install(write(new File(s.tmp, "c" + v + ".zip"), z), contentManifest(v, z, 1));
            }
            s.gc(700, 100); // still serving 700 this session; current 900, previous 800
            eq(new HashSet<>(Arrays.asList(s.content.list())), new HashSet<>(Arrays.asList("700", "800", "900")), "kept");
            s.gc(900, 100);
            eq(new HashSet<>(Arrays.asList(s.content.list())), new HashSet<>(Arrays.asList("800", "900")), "700 dropped");
        });
        test("store: incomplete folder (no marker) / minNative too high / bad meta are never served", () -> {
            UpdateCore.Store s = new UpdateCore.Store(dir("st-incomplete"));
            byte[] z = content(1000);
            s.install(write(new File(s.tmp, "c.zip"), z), contentManifest(1000, z, 1));
            ok(new File(s.dirFor(1000), UpdateCore.COMPLETE_MARKER).delete(), "remove marker");
            ok(!s.select(1, 1).installed(), "no marker -> bundled");
            UpdateCore.writeMarker(new File(s.dirFor(1000), UpdateCore.COMPLETE_MARKER));
            ok(s.select(1, 1).installed(), "marker back -> installed");
            ok(!s.select(1, 0).installed(), "NATIVE_API 0 < minNative 1 -> bundled");
            byte[] z2 = content(1100);
            s.install(write(new File(s.tmp, "c2.zip"), z2), contentManifest(1100, z2, UpdateCore.NATIVE_API + 1));
            eq(s.select(1, UpdateCore.NATIVE_API).version, 1000L, "1100 needs a newer APK -> previous 1000");
        });
        test("store: state.properties survives Arabic text and atomic rewrite", () -> {
            File root = dir("st-arabic");
            UpdateCore.Store s = new UpdateCore.Store(root);
            s.set(UpdateCore.K_APK_NOTES, "تحديث جديد\nسطر ثاني");
            s.set(UpdateCore.K_LAN, "http://192.168.1.5:47801/");
            s.save();
            s.save();
            UpdateCore.Store t = new UpdateCore.Store(root);
            eq(t.get(UpdateCore.K_APK_NOTES), "تحديث جديد\nسطر ثاني", "notes");
            eq(t.get(UpdateCore.K_LAN), "http://192.168.1.5:47801/", "lan");
            ok(!new File(root, "state.properties.tmp").exists(), "no tmp left");
        });
        test("store: crash loop across restarts -> marked bad after 2 starts that never passed the check (F2)", () -> {
            File root = dir("st-trial");
            UpdateCore.Store s = new UpdateCore.Store(root);
            byte[] z1 = content(200), z2 = content(300);
            s.install(write(new File(s.tmp, "a.zip"), z1), contentManifest(200, z1, 1));
            s.install(write(new File(s.tmp, "b.zip"), z2), contentManifest(300, z2, 1));
            int max = UpdateCore.MAX_START_ATTEMPTS;
            eq(max, 2, "2 attempts");
            // start 1: 300 runs, the process dies before its health check (no cancel / pass)
            UpdateCore.Selection a = new UpdateCore.Store(root).selectForStart(100, 1, max);
            eq(a.version, 300L, "start 1 serves 300");
            new UpdateCore.Store(root).beginTrial(300);
            // start 2: still served (1 failed start), dies again
            UpdateCore.Store t2 = new UpdateCore.Store(root);
            eq(t2.selectForStart(100, 1, max).version, 300L, "start 2 serves 300");
            t2.beginTrial(300);
            eq(new UpdateCore.Store(root).getLong(UpdateCore.K_TRIAL_ATTEMPTS, 0), 2L, "2 attempts persisted");
            // start 3: 300 is given up, previous 200 is served, trial keys gone
            UpdateCore.Store t3 = new UpdateCore.Store(root);
            UpdateCore.Selection c = t3.selectForStart(100, 1, max);
            eq(c.version, 200L, "start 3 falls back to 200");
            ok(c.installed(), "installed 200");
            ok(t3.isBad(300), "300 bad (persisted floor keeps it from coming back)");
            ok(t3.get(UpdateCore.K_TRIAL) == null && t3.get(UpdateCore.K_TRIAL_ATTEMPTS) == null, "trial cleared");
            // 200 fails twice as well -> bundled
            t3.beginTrial(200);
            t3.beginTrial(200);
            UpdateCore.Selection d = new UpdateCore.Store(root).selectForStart(100, 1, max);
            ok(!d.installed() && d.version == 100, "both bad -> bundled " + d);
        });
        test("store: trial balance - clean exits and a passed check never mark good content bad (F2)", () -> {
            File root = dir("st-trial2");
            UpdateCore.Store s = new UpdateCore.Store(root);
            byte[] z = content(400);
            s.install(write(new File(s.tmp, "a.zip"), z), contentManifest(400, z, 1));
            for (int i = 0; i < 5; i++) { // user opens and leaves (Home / double BACK) before 15 s, five times
                UpdateCore.Store t = new UpdateCore.Store(root);
                eq(t.selectForStart(100, 1, 2).version, 400L, "start " + i);
                t.beginTrial(400);
                t.cancelTrial(400);
            }
            UpdateCore.Store t = new UpdateCore.Store(root);
            ok(t.get(UpdateCore.K_TRIAL) == null, "balanced: no trial left");
            t.beginTrial(400);   // crashed once
            t = new UpdateCore.Store(root);
            t.beginTrial(400);   // second start: in front again ...
            t.cancelTrial(400);  // ... and left cleanly
            eq(new UpdateCore.Store(root).getLong(UpdateCore.K_TRIAL_ATTEMPTS, 0), 1L, "one failed start counted");
            eq(new UpdateCore.Store(root).selectForStart(100, 1, 2).version, 400L, "1 failed start: still served");
            t = new UpdateCore.Store(root);
            t.beginTrial(400);
            t.passTrial(400);
            UpdateCore.Store u = new UpdateCore.Store(root);
            ok(u.isGood(400), "good after the check passed");
            ok(u.get(UpdateCore.K_TRIAL) == null, "trial cleared by pass");
            eq(u.selectForStart(100, 1, 2).version, 400L, "served");
            u.cancelTrial(400);                   // no-op
            u.passTrial(400);                     // idempotent
            u.markBad(999);                       // unrelated bad version does not touch the trial / good keys
            ok(new UpdateCore.Store(root).isGood(400), "still good");
            u.beginTrial(400);
            u.markBad(400);                       // P7 in-process rollback clears its trial
            ok(new UpdateCore.Store(root).get(UpdateCore.K_TRIAL) == null, "markBad clears the trial");
        });
        test("store: explicit 'later' snooze remembers the manifest it was given for", () -> {
            UpdateCore.Store s = new UpdateCore.Store(dir("st-snooze"));
            s.set(UpdateCore.K_APK_PUB, 1234L);
            s.snooze(77, 5000);
            eq(s.getLong(UpdateCore.K_SNOOZE_CODE, 0), 77L, "code");
            eq(s.getLong(UpdateCore.K_SNOOZE_UNTIL, 0), 5000L, "until");
            eq(s.getLong(UpdateCore.K_SNOOZE_PUB, 0), 1234L, "published");
            s.clearApk();
            ok(s.get(UpdateCore.K_APK_PUB) == null, "clearApk forgets apkPublished");
        });
        test("readVersion", () -> {
            eq(UpdateCore.readVersion(new java.io.ByteArrayInputStream(utf8(" 4242\r\n"))), 4242L, "number");
            eq(UpdateCore.readVersion(new java.io.ByteArrayInputStream(utf8("x"))), 0L, "junk");
            eq(UpdateCore.readVersion(null), 0L, "missing");
        });
    }

    static void decisions() {
        test("decisions: only strictly newer, not bad, minNative ok; apk newer; snooze 24 h", () -> {
            UpdateCore.Manifest m = new UpdateCore.Manifest();
            m.hasContent = true;
            m.contentVersion = 50;
            m.contentMinNative = 1;
            m.contentSize = 10;
            Set<Long> none = Collections.emptySet();
            ok(UpdateCore.contentWanted(m, 49, none, 1), "newer");
            ok(!UpdateCore.contentWanted(m, 50, none, 1), "same = replay");
            ok(!UpdateCore.contentWanted(m, 60, none, 1), "older = downgrade");
            ok(!UpdateCore.contentWanted(m, 49, Collections.singleton(50L), 1), "bad version");
            m.contentMinNative = 2;
            ok(!UpdateCore.contentWanted(m, 49, none, 1), "minNative too high");
            m.hasApk = true;
            m.apkVersionCode = 10;
            ok(UpdateCore.apkWanted(m, 9) && !UpdateCore.apkWanted(m, 10) && !UpdateCore.apkWanted(m, 11), "apk newer only");
            long now = 1_000_000;
            ok(UpdateCore.apkPromptAllowed(10, 0, 0, now, false), "never snoozed");
            ok(!UpdateCore.apkPromptAllowed(10, 10, now + 1, now, false), "snoozed");
            ok(UpdateCore.apkPromptAllowed(10, 10, now + 1, now, true), "manual ignores snooze");
            ok(UpdateCore.apkPromptAllowed(11, 10, now + 1, now, false), "other versionCode");
            ok(UpdateCore.apkPromptAllowed(10, 10, now, now, false), "snooze over");
        });
        test("decisions: resume check due after 30 min, or 15 s after a failed check (F3)", () -> {
            long min = 60_000, iv = 30 * min, retry = 15_000, t0 = 10_000_000;
            ok(!UpdateCore.checkDue(t0, t0, t0 + 10 * min, iv, retry), "ok 10 min ago -> not due");
            ok(UpdateCore.checkDue(t0, t0, t0 + 31 * min, iv, retry), "ok 31 min ago -> due");
            ok(!UpdateCore.checkDue(t0, t0 - 5, t0 + 5_000, iv, retry), "failed 5 s ago -> not yet");
            ok(UpdateCore.checkDue(t0, t0 - 5, t0 + 20_000, iv, retry), "failed 20 s ago -> due again");
            ok(UpdateCore.checkDue(t0, 0, t0 + 20_000, iv, retry), "never reached anything -> due");
            ok(UpdateCore.checkDue(t0, t0, t0 - 1, iv, retry), "clock went back -> due");
            ok(UpdateCore.checkDue(0, 0, t0, iv, retry), "never checked -> due");
        });
    }

    @SuppressWarnings("try") // a responder is closed inside its try block on purpose
    static void engine() {
        test("download: never reads/writes more than the announced size (chunked, oversized body)", () -> {
            try (Srv srv = new Srv()) {
                byte[] body = new byte[2 << 20];
                Arrays.fill(body, (byte) 7);
                srv.files.put("big.bin", body);
                srv.chunked.add("big.bin");
                long size = 100_000;
                long[] max = {0};
                File dest = new File(dir("dl-cap"), "big.bin");
                fails(() -> UpdateCore.download(srv.base() + "big.bin", dest, size,
                        UpdateCore.sha256Hex(Arrays.copyOf(body, (int) size)), (done, total) -> max[0] = Math.max(max[0], done)),
                        "more data than announced", "oversized body");
                ok(max[0] <= size, "read at most " + size + " bytes, got " + max[0]);
                ok(!dest.exists() && !new File(dest.getPath() + ".part").exists(), "nothing left on disk");
            }
        });
        test("download: exact size + right SHA-256 -> file in place, no .part", () -> {
            try (Srv srv = new Srv()) {
                byte[] body = utf8("hello update");
                srv.files.put("ok.bin", body);
                File dest = new File(dir("dl-ok"), "ok.bin");
                UpdateCore.download(srv.base() + "ok.bin", dest, body.length, UpdateCore.sha256Hex(body), null);
                ok(Arrays.equals(read(dest), body) && !new File(dest.getPath() + ".part").exists(), "downloaded");
                fails(() -> UpdateCore.download(srv.base() + "missing.bin", dest, 1, UpdateCore.sha256Hex(body), null), "HTTP 404", "404");
            }
        });
        test("engine: verified manifest -> content installed + APK downloaded; 2nd check downloads nothing", () -> {
            try (Srv srv = new Srv()) {
                byte[] zip = content(1000), apk = utf8("PK fake apk bytes");
                srv.files.put("content-1000.zip", zip);
                srv.files.put("DroneSim-500.apk", apk);
                srv.publish(manifestText(1000, zip, UpdateCore.NATIVE_API, 500, apk, null), kp.getPrivate());
                UpdateCore.Store st = new UpdateCore.Store(dir("eng-ok"));
                Rec rec = new Rec();
                UpdateCore.Env e = env(Collections.singletonList(srv.base()), 400, 900);
                UpdateCore.Result r = UpdateCore.check(st, e, rec);
                ok(r.reached, "reached");
                eq(r.contentInstalled, 1000L, "content installed");
                ok(rec.has("checking") && rec.has("downloading:content:1000") && rec.has("ready:content:1000"), "events " + rec);
                ok(r.apk != null && r.apk.apkVersionCode == 500, "apk offered");
                ok(Arrays.equals(read(r.apkFile), apk), "apk bytes");
                eq(st.getLong(UpdateCore.K_APK_CODE, 0), 500L, "apk remembered");
                eq(st.get(UpdateCore.K_APK_NOTES), "تحسينات في الطيران، وتقدّمك ما يضيع", "notes remembered");
                UpdateCore.Selection sel = st.select(900, UpdateCore.NATIVE_API);
                ok(sel.installed() && sel.version == 1000, "next start serves 1000: " + sel);
                ok(st.tmp.list().length == 0, "tmp clean: " + Arrays.toString(st.tmp.list()));
                ok(st.getLong(UpdateCore.K_LAST_CHECK, 0) == e.now, "lastCheck");

                Rec rec2 = new Rec();
                UpdateCore.Result r2 = UpdateCore.check(st, env(Collections.singletonList(srv.base()), 400, 900), rec2);
                eq(srv.count("content-1000.zip"), 1L, "zip downloaded once");
                eq(srv.count("DroneSim-500.apk"), 1L, "apk downloaded once (reused, SHA re-checked)");
                eq(r2.contentInstalled, 0L, "nothing re-installed");
                ok(r2.apk != null, "apk still offered");
                ok(!rec2.has("error"), "no error " + rec2);
            }
        });
        test("engine: signature by another key -> error 'signature', nothing downloaded", () -> {
            try (Srv srv = new Srv()) {
                byte[] zip = content(1000);
                srv.files.put("content-1000.zip", zip);
                srv.publish(manifestText(1000, zip, 1, 0, null, null), other.getPrivate());
                UpdateCore.Store st = new UpdateCore.Store(dir("eng-sig"));
                Rec rec = new Rec();
                UpdateCore.Result r = UpdateCore.check(st, env(Collections.singletonList(srv.base()), 1, 1), rec);
                ok(!r.reached, "not reached");
                eq(r.reason, "signature", "reason");
                eq(rec.last(), "error::0:signature", "event");
                eq(srv.count("content-1000.zip"), 0L, "zip never fetched");
                ok(!st.select(1, 1).installed(), "nothing installed");
            }
        });
        test("engine: missing signature file -> ignored (unreachable)", () -> {
            try (Srv srv = new Srv()) {
                byte[] zip = content(1000);
                srv.files.put("content-1000.zip", zip);
                srv.publish(manifestText(1000, zip, 1, 0, null, null), kp.getPrivate());
                srv.files.remove(UpdateCore.SIGNATURE);
                Rec rec = new Rec();
                UpdateCore.Result r = UpdateCore.check(new UpdateCore.Store(dir("eng-nosig")), env(Collections.singletonList(srv.base()), 1, 1), rec);
                ok(!r.reached && r.reason.equals("unreachable"), "reason " + r.reason);
                eq(srv.count("content-1000.zip"), 0L, "zip never fetched");
            }
        });
        test("engine: SHA-256 mismatch -> error 'download', nothing installed, no partial file", () -> {
            try (Srv srv = new Srv()) {
                byte[] zip = content(1000), evil = content(1000);
                evil[evil.length - 30] ^= 1; // same size, other bytes
                srv.files.put("content-1000.zip", evil);
                srv.publish(manifestText(1000, zip, 1, 0, null, null), kp.getPrivate());
                UpdateCore.Store st = new UpdateCore.Store(dir("eng-sha"));
                Rec rec = new Rec();
                UpdateCore.Result r = UpdateCore.check(st, env(Collections.singletonList(srv.base()), 1, 1), rec);
                eq(r.reason, "download", "reason " + rec);
                eq(r.contentInstalled, 0L, "nothing installed");
                ok(st.content.list().length == 0 && st.tmp.list().length == 0, "no leftovers");
            }
        });
        test("engine: server sends more than content.size (with and without Content-Length) -> refused", () -> {
            try (Srv srv = new Srv()) {
                byte[] zip = content(1000);
                byte[] longer = Arrays.copyOf(zip, zip.length + 1000);
                srv.files.put("content-1000.zip", longer);
                srv.publish(manifestText(1000, zip, 1, 0, null, null), kp.getPrivate());
                UpdateCore.Store st = new UpdateCore.Store(dir("eng-size"));
                UpdateCore.Result r = UpdateCore.check(st, env(Collections.singletonList(srv.base()), 1, 1), new Rec());
                eq(r.reason, "download", "Content-Length mismatch");
                srv.chunked.add("content-1000.zip");
                UpdateCore.Result r2 = UpdateCore.check(st, env(Collections.singletonList(srv.base()), 1, 1), new Rec());
                eq(r2.reason, "download", "chunked: stops after content.size bytes");
                ok(st.content.list().length == 0 && st.tmp.list().length == 0, "no leftovers");
            }
        });
        test("engine: zip-slip inside a correctly signed zip -> error 'install', nothing outside", () -> {
            try (Srv srv = new Srv()) {
                byte[] zip = zip("index.html", "x", UpdateCore.CONTENT_VERSION_FILE, "1000", "../../evil.js", "pwned");
                srv.files.put("content-1000.zip", zip);
                srv.publish(manifestText(1000, zip, 1, 0, null, null), kp.getPrivate());
                File root = dir("eng-slip");
                UpdateCore.Store st = new UpdateCore.Store(root);
                UpdateCore.Result r = UpdateCore.check(st, env(Collections.singletonList(srv.base()), 1, 1), new Rec());
                eq(r.reason, "install", "reason");
                ok(!new File(root, "evil.js").exists() && !new File(st.root.getParentFile(), "evil.js").exists(), "no escape");
                ok(!st.select(1, 1).installed(), "not installed");
            }
        });
        test("engine: content.minNative > NATIVE_API -> skipped ('none', never downloaded)", () -> {
            try (Srv srv = new Srv()) {
                byte[] zip = content(1000);
                srv.files.put("content-1000.zip", zip);
                srv.publish(manifestText(1000, zip, UpdateCore.NATIVE_API + 1, 0, null, null), kp.getPrivate());
                Rec rec = new Rec();
                UpdateCore.check(new UpdateCore.Store(dir("eng-native")), env(Collections.singletonList(srv.base()), 1, 1), rec);
                eq(rec.last(), "none::0:", "event " + rec);
                eq(srv.count("content-1000.zip"), 0L, "not fetched");
            }
        });
        test("engine: older / same / bad / replayed versions are ignored", () -> {
            try (Srv srv = new Srv()) {
                byte[] zip = content(800);
                srv.files.put("content-800.zip", zip);
                srv.publish(manifestText(800, zip, 1, 0, null, null), kp.getPrivate());
                UpdateCore.Store st = new UpdateCore.Store(dir("eng-old"));
                Rec rec = new Rec();
                UpdateCore.check(st, env(Collections.singletonList(srv.base()), 1, 900), rec); // bundled 900 > 800
                eq(rec.last(), "none::0:", "older than bundled");
                UpdateCore.Env e = env(Collections.singletonList(srv.base()), 1, 700);
                e.servedContent = 800;
                Rec rec2 = new Rec();
                UpdateCore.check(st, e, rec2);
                eq(rec2.last(), "none::0:", "same as served");
                st.markBad(800);
                Rec rec3 = new Rec();
                UpdateCore.check(st, env(Collections.singletonList(srv.base()), 1, 700), rec3);
                eq(rec3.last(), "none::0:", "bad");
                UpdateCore.Store st2 = new UpdateCore.Store(dir("eng-replay"));
                st2.set(UpdateCore.K_MAX, 850);
                st2.save();
                Rec rec4 = new Rec();
                UpdateCore.check(st2, env(Collections.singletonList(srv.base()), 1, 700), rec4);
                eq(rec4.last(), "none::0:", "older than the newest ever installed (replay)");
                eq(srv.count("content-800.zip"), 0L, "never fetched");
            }
        });
        test("engine: APK not newer than the running one -> not downloaded", () -> {
            try (Srv srv = new Srv()) {
                byte[] apk = utf8("apk");
                srv.files.put("DroneSim-500.apk", apk);
                srv.publish(manifestText(0, null, 1, 500, apk, null), kp.getPrivate());
                Rec rec = new Rec();
                UpdateCore.Result r = UpdateCore.check(new UpdateCore.Store(dir("eng-apk-old")), env(Collections.singletonList(srv.base()), 500, 1), rec);
                ok(r.apk == null, "no apk");
                eq(rec.last(), "none::0:", "none");
                eq(srv.count("DroneSim-500.apk"), 0L, "not fetched");
            }
        });
        test("engine: APK SHA-256 mismatch -> error, no APK kept", () -> {
            try (Srv srv = new Srv()) {
                byte[] apk = utf8("good apk"), evil = utf8("evil apk");
                srv.files.put("DroneSim-500.apk", evil);
                srv.publish(manifestText(0, null, 1, 500, apk, null), kp.getPrivate());
                UpdateCore.Store st = new UpdateCore.Store(dir("eng-apk-sha"));
                UpdateCore.Result r = UpdateCore.check(st, env(Collections.singletonList(srv.base()), 400, 1), new Rec());
                ok(r.apk == null && r.reason.equals("download"), "refused: " + r.reason);
                ok(st.apk.list().length == 0, "no apk file: " + Arrays.toString(st.apk.list()));
                eq(st.getLong(UpdateCore.K_APK_CODE, 0), 0L, "not remembered");
            }
        });
        test("engine: 'lan' source -> UDP discovery -> lanUrl remembered -> used without discovery next time", () -> {
            try (Srv srv = new Srv(); Responder resp = new Responder(null)) {
                resp.reply = "DRONESIM!1 " + srv.base();
                byte[] zip = content(1000);
                srv.files.put("content-1000.zip", zip);
                srv.publish(manifestText(1000, zip, 1, 0, null, null), kp.getPrivate());
                UpdateCore.Store st = new UpdateCore.Store(dir("eng-lan"));
                UpdateCore.Env e = env(Collections.singletonList("lan"), 1, 1);
                e.discoveryPort = resp.port();
                UpdateCore.Result r = UpdateCore.check(st, e, new Rec());
                eq(r.contentInstalled, 1000L, "installed via discovery");
                eq(st.get(UpdateCore.K_LAN), srv.base(), "lanUrl remembered");
                int before = resp.requests;
                resp.close();
                byte[] zip2 = content(1100);
                srv.files.put("content-1100.zip", zip2);
                srv.publish(manifestText(1100, zip2, 1, 0, null, null), kp.getPrivate());
                UpdateCore.Env e2 = env(Collections.singletonList("lan"), 1, 1);
                e2.servedContent = 1000;
                UpdateCore.Result r2 = UpdateCore.check(st, e2, new Rec());
                eq(r2.contentInstalled, 1100L, "installed via remembered lanUrl");
                eq(resp.requests, before, "no discovery needed");
                eq(st.getLong(UpdateCore.K_PREVIOUS, 0), 1000L, "previous = 1000");
            }
        });
        test("engine: dead remembered lanUrl -> falls back to discovery", () -> {
            try (Srv srv = new Srv(); Responder resp = new Responder(null)) {
                resp.reply = "DRONESIM!1 " + srv.base();
                byte[] zip = content(1000);
                srv.files.put("content-1000.zip", zip);
                srv.publish(manifestText(1000, zip, 1, 0, null, null), kp.getPrivate());
                UpdateCore.Store st = new UpdateCore.Store(dir("eng-lan2"));
                st.set(UpdateCore.K_LAN, "http://127.0.0.1:" + freePort() + "/");
                st.save();
                UpdateCore.Env e = env(Collections.singletonList("lan"), 1, 1);
                e.discoveryPort = resp.port();
                UpdateCore.Result r = UpdateCore.check(st, e, new Rec());
                eq(r.contentInstalled, 1000L, "installed");
                eq(st.get(UpdateCore.K_LAN), srv.base(), "lanUrl updated");
            }
        });
        test("engine: nothing reachable -> error 'unreachable', lastCheck still saved", () -> {
            UpdateCore.Store st = new UpdateCore.Store(dir("eng-down"));
            Rec rec = new Rec();
            UpdateCore.Env e = env(Arrays.asList("lan", "http://127.0.0.1:" + freePort() + "/"), 1, 1);
            UpdateCore.Result r = UpdateCore.check(st, e, rec);
            eq(r.reason, "unreachable", "reason");
            eq(rec.last(), "error::0:unreachable", "event");
            eq(st.getLong(UpdateCore.K_LAST_CHECK, 0), e.now, "lastCheck");
            eq(st.getLong(UpdateCore.K_LAST_OK, 0), 0L, "lastOk not set by a failed check");
            ok(UpdateCore.checkDue(e.now, st.getLong(UpdateCore.K_LAST_OK, 0), e.now + 20_000,
                    30L * 60 * 1000, 15_000), "so the next resume checks again");
        });
        test("engine: 'later' holds for the same publish, a new publish (new 'published') asks again (F2)", () -> {
            try (Srv srv = new Srv()) {
                byte[] apk = utf8("fake apk bytes for snooze");
                srv.files.put("DroneSim-700.apk", apk);
                String man1 = manifestText(0, null, 1, 700, apk, null);
                srv.publish(man1, kp.getPrivate());
                UpdateCore.Store st = new UpdateCore.Store(dir("eng-snooze"));
                UpdateCore.Env e = env(Collections.singletonList(srv.base()), 600, 1);
                UpdateCore.Result r = UpdateCore.check(st, e, new Rec());
                ok(r.apk != null, "apk offered");
                eq(st.getLong(UpdateCore.K_LAST_OK, 0), e.now, "lastOk set by a check that reached a manifest");
                eq(st.getLong(UpdateCore.K_APK_PUB, 0), 1760000000000L, "published remembered");
                long now = e.now;
                st.snooze(700, now + 24L * 3600 * 1000); // the user pressed "later"
                UpdateCore.check(st, env(Collections.singletonList(srv.base()), 600, 1), new Rec());
                ok(!UpdateCore.apkPromptAllowed(700, st.getLong(UpdateCore.K_SNOOZE_CODE, 0),
                        st.getLong(UpdateCore.K_SNOOZE_UNTIL, 0), now + 1000, false), "same manifest: still snoozed");
                srv.publish(man1.replace("published=1760000000000", "published=1760000099999"), kp.getPrivate());
                UpdateCore.check(st, env(Collections.singletonList(srv.base()), 600, 1), new Rec());
                ok(st.get(UpdateCore.K_SNOOZE_CODE) == null && st.get(UpdateCore.K_SNOOZE_PUB) == null, "snooze cleared");
                ok(UpdateCore.apkPromptAllowed(700, st.getLong(UpdateCore.K_SNOOZE_CODE, 0),
                        st.getLong(UpdateCore.K_SNOOZE_UNTIL, 0), now + 1000, false), "new publish: asks again");
                eq(srv.count("DroneSim-700.apk"), 1L, "APK downloaded once only");
            }
        });
        test("engine: manifest 'sources' are remembered (validated)", () -> {
            try (Srv srv = new Srv()) {
                srv.publish(manifestText(0, null, 1, 0, null, "sources=lan;https://nadir.example/ds-updates;http://8.8.8.8/\n"), kp.getPrivate());
                UpdateCore.Store st = new UpdateCore.Store(dir("eng-src"));
                UpdateCore.check(st, env(Collections.singletonList(srv.base()), 1, 1), new Rec());
                eq(st.get(UpdateCore.K_SOURCES), "lan;https://nadir.example/ds-updates/", "remembered");
            }
        });
        test("engine: two sources -> the newest content wins", () -> {
            try (Srv a = new Srv(); Srv b = new Srv()) {
                byte[] za = content(1000), zb = content(1200);
                a.files.put("content-1000.zip", za);
                b.files.put("content-1200.zip", zb);
                a.publish(manifestText(1000, za, 1, 0, null, null), kp.getPrivate());
                b.publish(manifestText(1200, zb, 1, 0, null, null), kp.getPrivate());
                UpdateCore.Store st = new UpdateCore.Store(dir("eng-two"));
                UpdateCore.Result r = UpdateCore.check(st, env(Arrays.asList(a.base(), b.base()), 1, 1), new Rec());
                eq(r.contentInstalled, 1200L, "newest");
                eq(a.count("content-1000.zip"), 0L, "older one not fetched");
            }
        });
    }
}
