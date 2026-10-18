package com.nadir.dronesim;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Reader;
import java.io.Writer;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URL;
import java.nio.charset.Charset;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.PublicKey;
import java.security.Signature;
import java.security.cert.CertificateFactory;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Properties;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Pure-Java core of the self-updater (imports java.* only, so it also runs on the desktop JVM for tests).
 *
 * Protocol (see the OTA spec P1..P6):
 *  - A source is "lan" (UDP discovery on port 47800 + the remembered LAN URL) or a base URL ending in '/'.
 *  - base + "update.properties" (java.util.Properties, UTF-8) and base + "update.properties.sig" (lowercase hex of
 *    SHA256withRSA over the exact manifest bytes, made with the APK release key). Only manifests that verify with
 *    one of the app's own signing certificates are used; everything they point at is size + SHA-256 checked.
 *  - Web content is a zip of the web root (index.html, js/, lib/, native-shim.js, content-version.txt) that is
 *    extracted with zip-slip / size / entry-count guards into filesDir/updates/content/&lt;version&gt;/ and marked
 *    complete by a ".complete" file written last.
 *  - Versions only go up: content.version must be newer than the bundled one, the one being served, the
 *    installed one and every version ever installed; apk.versionCode must be newer than the running APK.
 *
 * Threading: Store methods are synchronized; check() runs on one background thread (never the UI thread).
 */
final class UpdateCore {
    private UpdateCore() {}

    /** Bump when web content starts to depend on new native behaviour (bridges, AssetClient...). */
    static final int NATIVE_API = 1;

    /**
     * SHA-256 of the release signing certificate (%USERPROFILE%\.dronesim\dronesim-release.keystore, alias dronesim).
     * Informational only (logged, NativeUpdate.info().releaseKey): trust always comes from the certificate the
     * running APK is really signed with (P2), and Android itself refuses an update signed with another key.
     */
    static final String RELEASE_CERT_SHA256 = "d3da701f35acb0cb67cdddd3a453dc0f886aa6c45cbf5c0bbd7486dad6b1cbd6";

    static final int FORMAT = 1;
    static final int DISCOVERY_PORT = 47800;
    static final int HTTP_PORT = 47801;
    static final String DISCOVERY_REQUEST = "DRONESIM?1";
    static final String DISCOVERY_REPLY_PREFIX = "DRONESIM!1 ";
    static final int DISCOVERY_WAIT_MS = 1500;
    static final String MANIFEST = "update.properties";
    static final String SIGNATURE = "update.properties.sig";
    static final String CONTENT_VERSION_FILE = "content-version.txt";
    static final String COMPLETE_MARKER = ".complete";
    static final String META_FILE = ".meta";
    static final String SOURCE_LAN = "lan";

    static final int MAX_MANIFEST_BYTES = 64 * 1024;
    static final int MAX_SIG_BYTES = 4096;
    static final long MAX_CONTENT_BYTES = 64L * 1024 * 1024;   // uncompressed total, also caps the zip download
    static final int MAX_CONTENT_ENTRIES = 4000;
    static final long MAX_APK_BYTES = 200L * 1024 * 1024;
    static final int MAX_SOURCES = 6;
    static final int MAX_BAD = 20;
    static final int MAX_GOOD = 10;
    /** P7 across restarts: installed content that took the whole app down this many starts in a row is bad. */
    static final int MAX_START_ATTEMPTS = 2;
    static final int LAN_CONNECT_TIMEOUT_MS = 2500;
    static final int NET_CONNECT_TIMEOUT_MS = 6000;
    static final int READ_TIMEOUT_MS = 15000;

    // state.properties keys
    static final String K_CURRENT = "current";
    static final String K_PREVIOUS = "previous";
    static final String K_BAD = "bad";
    static final String K_MAX = "maxContent";
    static final String K_LAST_CHECK = "lastCheck";
    static final String K_LAST_OK = "lastOk";            // last check that reached a verified manifest
    static final String K_LAN = "lanUrl";
    static final String K_SOURCES = "sources";
    static final String K_SNOOZE_CODE = "snoozeApk";
    static final String K_SNOOZE_UNTIL = "snoozeUntil";
    static final String K_SNOOZE_PUB = "snoozePublished"; // manifest 'published' the snooze was given for
    static final String K_APK_CODE = "apkCode";
    static final String K_APK_NAME = "apkName";
    static final String K_APK_SHA = "apkSha";
    static final String K_APK_SIZE = "apkSize";
    static final String K_APK_NOTES = "apkNotes";
    static final String K_APK_PUB = "apkPublished";      // 'published' of the newest manifest offering that APK
    static final String K_TRIAL = "trial";               // installed version on trial (has not passed P7 yet)
    static final String K_TRIAL_ATTEMPTS = "trialAttempts";
    static final String K_GOOD = "good";                 // installed versions that passed the P7 health check
    static final String K_INSTALL_TOKEN = "installToken";
    static final String K_INSTALL_SESSION = "installSession";

    static final Charset UTF8 = Charset.forName("UTF-8");
    static final Charset ASCII = Charset.forName("US-ASCII");

    private static final Pattern SAFE_NAME = Pattern.compile("[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}");
    private static final Pattern HEX64 = Pattern.compile("[0-9a-f]{64}");
    private static final Pattern IPV4 = Pattern.compile("(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})");
    private static final Pattern SAFE_PATH = Pattern.compile("/[A-Za-z0-9._~%+/-]*");
    private static final Pattern REPLY = Pattern.compile(
            "DRONESIM!1 http://(\\d{1,3}(?:\\.\\d{1,3}){3})(?::(\\d{1,5}))?/");

    // ------------------------------------------------------------------------------------------ logging

    interface Logger {
        void i(String msg);
        void w(String msg, Throwable t);
    }

    static volatile Logger log = new Logger() {
        @Override public void i(String msg) { System.err.println("UpdateCore: " + msg); }
        @Override public void w(String msg, Throwable t) { System.err.println("UpdateCore: " + msg + (t == null ? "" : " (" + t + ")")); }
    };

    // ------------------------------------------------------------------------------------------ manifest (P1)

    static final class ManifestException extends IOException {
        private static final long serialVersionUID = 1L;

        ManifestException(String m) { super(m); }
    }

    static final class Manifest {
        long published;
        boolean hasContent;
        long contentVersion;
        String contentFile;
        long contentSize;
        String contentSha256;
        int contentMinNative;
        boolean hasApk;
        long apkVersionCode;
        String apkVersionName = "";
        String apkFile;
        long apkSize;
        String apkSha256;
        String notes = "";
        List<String> sources = new ArrayList<String>();

        static Manifest parse(byte[] bytes) throws ManifestException {
            if (bytes == null || bytes.length > MAX_MANIFEST_BYTES) throw new ManifestException("manifest size");
            Properties p = new Properties();
            try {
                p.load(new InputStreamReader(new ByteArrayInputStream(bytes), UTF8));
            } catch (IOException e) {
                throw new ManifestException("unreadable manifest");
            } catch (IllegalArgumentException e) { // malformed \\uXXXX escape
                throw new ManifestException("unreadable manifest");
            }
            Manifest m = new Manifest();
            if (!String.valueOf(FORMAT).equals(trim(p.getProperty("format")))) throw new ManifestException("format");
            m.published = parseLong(p.getProperty("published"), 0);
            if (p.getProperty("content.version") != null) {
                m.hasContent = true;
                m.contentVersion = reqLong(p, "content.version", 1, Long.MAX_VALUE);
                m.contentFile = reqName(p, "content.file");
                m.contentSize = reqLong(p, "content.size", 1, MAX_CONTENT_BYTES);
                m.contentSha256 = reqSha(p, "content.sha256");
                m.contentMinNative = p.getProperty("content.minNative") == null ? 1
                        : (int) reqLong(p, "content.minNative", 0, Integer.MAX_VALUE);
            }
            if (p.getProperty("apk.versionCode") != null) {
                m.hasApk = true;
                m.apkVersionCode = reqLong(p, "apk.versionCode", 1, Integer.MAX_VALUE);
                m.apkVersionName = clean(p.getProperty("apk.versionName"), 40);
                m.apkFile = reqName(p, "apk.file");
                m.apkSize = reqLong(p, "apk.size", 1, MAX_APK_BYTES);
                m.apkSha256 = reqSha(p, "apk.sha256");
            }
            m.notes = clean(p.getProperty("notes"), 600);
            m.sources = parseSources(p.getProperty("sources"));
            return m;
        }

        private static long reqLong(Properties p, String k, long min, long max) throws ManifestException {
            String v = trim(p.getProperty(k));
            long n;
            try {
                n = Long.parseLong(v);
            } catch (NumberFormatException e) {
                throw new ManifestException("bad " + k);
            }
            if (n < min || n > max) throw new ManifestException("out of range " + k);
            return n;
        }

        private static String reqName(Properties p, String k) throws ManifestException {
            String v = trim(p.getProperty(k));
            if (!isSafeName(v)) throw new ManifestException("bad " + k);
            return v;
        }

        private static String reqSha(Properties p, String k) throws ManifestException {
            String v = trim(p.getProperty(k)).toLowerCase(Locale.ROOT);
            if (!HEX64.matcher(v).matches()) throw new ManifestException("bad " + k);
            return v;
        }
    }

    /** File names inside a manifest: [A-Za-z0-9._-], not starting with '.', so base + name stays under base. */
    static boolean isSafeName(String s) {
        return s != null && SAFE_NAME.matcher(s).matches();
    }

    static String trim(String s) {
        return s == null ? "" : s.trim();
    }

    /** Trims, drops control characters except new lines, caps the length. */
    static String clean(String s, int max) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(Math.min(s.length(), max));
        for (int i = 0; i < s.length() && b.length() < max; i++) {
            char c = s.charAt(i);
            if (c == '\n') b.append('\n');
            else if (c < 0x20 || c == 0x7f) b.append(' ');
            else b.append(c);
        }
        return b.toString().trim();
    }

    static long parseLong(String s, long def) {
        if (s == null) return def;
        try {
            return Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return def;
        }
    }

    // ------------------------------------------------------------------------------------------ sources / URLs

    static List<String> parseSources(String s) {
        List<String> out = new ArrayList<String>();
        if (s == null) return out;
        for (String part : s.split(";")) {
            String b = normalizeSource(part);
            if (b != null && !out.contains(b) && out.size() < MAX_SOURCES) out.add(b);
        }
        return out;
    }

    static String joinSources(List<String> list) {
        StringBuilder b = new StringBuilder();
        for (String s : list) {
            if (b.length() > 0) b.append(';');
            b.append(s);
        }
        return b.toString();
    }

    /** "lan", or a base URL accepted by normalizeBase; null if unusable. */
    static String normalizeSource(String s) {
        if (s == null) return null;
        s = s.trim();
        if (s.length() == 0 || s.length() > 300) return null;
        if (s.equalsIgnoreCase(SOURCE_LAN)) return SOURCE_LAN;
        return normalizeBase(s);
    }

    /**
     * "https://host[:port]/path/" or "http://&lt;LAN IPv4&gt;[:port]/path/", lower-case scheme/host, trailing '/' added,
     * no query / fragment / user info / "..". Returns null for anything else (plain http only inside the LAN).
     */
    static String normalizeBase(String s) {
        if (s == null) return null;
        s = s.trim();
        if (s.length() == 0 || s.length() > 300) return null;
        try {
            URI u = new URI(s);
            String scheme = u.getScheme(), host = u.getHost();
            if (scheme == null || host == null || u.getRawQuery() != null || u.getRawFragment() != null
                    || u.getRawUserInfo() != null) return null;
            scheme = scheme.toLowerCase(Locale.ROOT);
            host = host.toLowerCase(Locale.ROOT);
            if (scheme.equals("http")) {
                if (!isLanIpv4(host)) return null;
            } else if (!scheme.equals("https")) {
                return null;
            }
            int port = u.getPort();
            if (port == 0 || port > 65535) return null;
            String path = u.getRawPath();
            if (path == null || path.length() == 0) path = "/";
            if (!path.endsWith("/")) path = path + "/";
            if (!SAFE_PATH.matcher(path).matches() || path.contains("..") || path.contains("//")) return null;
            return scheme + "://" + host + (port == -1 ? "" : ":" + port) + path;
        } catch (URISyntaxException e) {
            return null;
        }
    }

    /** What a person types as "server": "192.168.1.5", "192.168.1.5:47801", "http://...", "https://...". */
    static String normalizeUserServer(String s) {
        if (s == null) return null;
        s = s.trim();
        if (s.length() == 0) return null;
        if (!s.contains("://")) {
            Matcher m = Pattern.compile("(\\d{1,3}(?:\\.\\d{1,3}){3})(?::(\\d{1,5}))?/?").matcher(s);
            if (!m.matches()) return null;
            s = "http://" + m.group(1) + ":" + (m.group(2) == null ? String.valueOf(HTTP_PORT) : m.group(2)) + "/";
        }
        return normalizeBase(s);
    }

    /** 10/8, 172.16/12, 192.168/16, 127/8, 169.254/16 as a dotted IPv4 literal. */
    static boolean isLanIpv4(String host) {
        if (host == null) return false;
        Matcher m = IPV4.matcher(host);
        if (!m.matches()) return false;
        int[] o = new int[4];
        for (int i = 0; i < 4; i++) {
            o[i] = Integer.parseInt(m.group(i + 1));
            if (o[i] > 255) return false;
        }
        return o[0] == 10 || o[0] == 127 || (o[0] == 192 && o[1] == 168) || (o[0] == 172 && o[1] >= 16 && o[1] <= 31)
                || (o[0] == 169 && o[1] == 254);
    }

    static boolean isLanUrl(String base) {
        try {
            URI u = new URI(base);
            return "http".equalsIgnoreCase(u.getScheme()) && isLanIpv4(u.getHost());
        } catch (URISyntaxException e) {
            return false;
        }
    }

    // ------------------------------------------------------------------------------------------ crypto (P2)

    static MessageDigest sha256Digest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    static String sha256Hex(byte[] data) {
        return hex(sha256Digest().digest(data));
    }

    static String sha256Hex(File f) throws IOException {
        MessageDigest md = sha256Digest();
        InputStream in = new FileInputStream(f);
        try {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) != -1) md.update(buf, 0, n);
        } finally {
            closeQuietly(in);
        }
        return hex(md.digest());
    }

    static String hex(byte[] b) {
        char[] d = "0123456789abcdef".toCharArray();
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(d[(x >> 4) & 15]).append(d[x & 15]);
        return sb.toString();
    }

    /** Hex (either case) to bytes; null when empty, odd or not hex. */
    static byte[] unhex(String s) {
        if (s == null) return null;
        s = s.trim();
        if (s.length() == 0 || (s.length() & 1) != 0) return null;
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) {
            int hi = Character.digit(s.charAt(2 * i), 16), lo = Character.digit(s.charAt(2 * i + 1), 16);
            if (hi < 0 || lo < 0) return null;
            out[i] = (byte) ((hi << 4) | lo);
        }
        return out;
    }

    /** X.509 certificates (DER, e.g. android.content.pm.Signature.toByteArray()) to public keys. */
    static List<PublicKey> keysFromCertificates(List<byte[]> certs) {
        List<PublicKey> out = new ArrayList<PublicKey>();
        if (certs == null) return out;
        for (byte[] c : certs) {
            try {
                out.add(CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(c)).getPublicKey());
            } catch (Exception e) {
                log.w("unreadable signing certificate", e);
            }
        }
        return out;
    }

    /** P2: the .sig file is hex of SHA256withRSA(data); valid if any trusted key verifies it. */
    static boolean verifySignature(byte[] data, byte[] sigFile, List<PublicKey> keys) {
        if (data == null || sigFile == null || keys == null || keys.isEmpty() || sigFile.length > MAX_SIG_BYTES) return false;
        byte[] sig = unhex(new String(sigFile, ASCII));
        if (sig == null) return false;
        for (PublicKey k : keys) {
            try {
                Signature s = Signature.getInstance("SHA256withRSA");
                s.initVerify(k);
                s.update(data);
                if (s.verify(sig)) return true;
            } catch (Exception e) {
                // wrong key type / malformed signature: try the next key
            }
        }
        return false;
    }

    // ------------------------------------------------------------------------------------------ JSON helpers

    /** JSON string literal with every non-ASCII / control / quote char escaped (also a valid JS literal). */
    static String quote(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder(s.length() + 16).append('"');
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') b.append('\\').append(c);
            else if (c == '\n') b.append("\\n");
            else if (c < 0x20 || c > 0x7e || c == '<' || c == '>' || c == '&' || c == '\'') {
                b.append("\\u");
                String h = Integer.toHexString(c);
                for (int k = h.length(); k < 4; k++) b.append('0');
                b.append(h);
            } else b.append(c);
        }
        return b.append('"').toString();
    }

    static final class Json {
        private final StringBuilder b = new StringBuilder("{");

        private Json key(String k) {
            if (b.length() > 1) b.append(',');
            b.append(quote(k)).append(':');
            return this;
        }

        Json put(String k, String v) { key(k).b.append(quote(v)); return this; }
        Json put(String k, long v) { key(k).b.append(v); return this; }
        Json put(String k, boolean v) { key(k).b.append(v); return this; }

        Json put(String k, double v) {
            key(k).b.append(v != v || Double.isInfinite(v) ? "null" : String.valueOf(Math.round(v * 1000) / 1000.0));
            return this;
        }

        Json raw(String k, String json) { key(k).b.append(json); return this; }

        @Override public String toString() { return b.toString() + "}"; }
    }

    // ------------------------------------------------------------------------------------------ HTTP

    interface Progress {
        void onProgress(long done, long total);
    }

    static HttpURLConnection open(String url) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(isLanUrl(url) ? LAN_CONNECT_TIMEOUT_MS : NET_CONNECT_TIMEOUT_MS);
        c.setReadTimeout(READ_TIMEOUT_MS);
        c.setUseCaches(false);
        c.setInstanceFollowRedirects(true); // same-protocol only (HttpURLConnection never switches http<->https)
        c.setRequestProperty("Cache-Control", "no-cache");
        c.setRequestProperty("Accept-Encoding", "identity");
        c.setRequestProperty("User-Agent", "DroneSimUpdater/" + NATIVE_API);
        return c;
    }

    /** Small GET (manifest, signature): HTTP 200 and at most max bytes, else IOException. */
    static byte[] fetch(String url, int max) throws IOException {
        HttpURLConnection c = open(url);
        try {
            int code = c.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code + " " + url);
            if (c.getContentLength() > max) throw new IOException("too big " + url);
            InputStream in = c.getInputStream();
            try {
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (bo.size() + n > max) throw new IOException("too big " + url);
                    bo.write(buf, 0, n);
                }
                return bo.toByteArray();
            } finally {
                closeQuietly(in);
            }
        } finally {
            c.disconnect();
        }
    }

    /**
     * Streams url to dest (via dest.part): exactly `size` bytes with SHA-256 `sha256`, else IOException and
     * nothing is left behind. Never reads more than `size` bytes.
     */
    static void download(String url, File dest, long size, String sha256, Progress p) throws IOException {
        File part = new File(dest.getPath() + ".part");
        deleteTree(part);
        HttpURLConnection c = open(url);
        boolean ok = false;
        try {
            int code = c.getResponseCode();
            if (code != 200) throw new IOException("HTTP " + code + " " + url);
            long len = c.getContentLengthLong();
            if (len >= 0 && len != size) throw new IOException("size " + len + " != " + size + " " + url);
            MessageDigest md = sha256Digest();
            InputStream in = c.getInputStream();
            FileOutputStream out = new FileOutputStream(part);
            long done = 0;
            try {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) != -1) {
                    done += n;
                    if (done > size) throw new IOException("more data than announced " + url);
                    md.update(buf, 0, n);
                    out.write(buf, 0, n);
                    if (p != null) p.onProgress(done, size);
                }
                out.flush();
                out.getFD().sync();
            } finally {
                closeQuietly(out);
                closeQuietly(in);
            }
            if (done != size) throw new IOException("short download " + done + "/" + size + " " + url);
            if (!hex(md.digest()).equals(sha256)) throw new IOException("sha256 mismatch " + url);
            if (dest.exists() && !dest.delete()) throw new IOException("cannot replace " + dest);
            if (!part.renameTo(dest)) throw new IOException("cannot rename " + part);
            ok = true;
        } finally {
            c.disconnect();
            if (!ok) deleteTree(part);
        }
    }

    // ------------------------------------------------------------------------------------------ LAN discovery (P5)

    /** 255.255.255.255 plus the IPv4 broadcast address of every interface that is up (no permission needed). */
    static List<InetAddress> broadcastTargets() {
        List<InetAddress> out = new ArrayList<InetAddress>();
        try {
            out.add(InetAddress.getByName("255.255.255.255"));
        } catch (IOException ignored) {
            // literal, cannot fail
        }
        try {
            Enumeration<NetworkInterface> en = NetworkInterface.getNetworkInterfaces();
            while (en != null && en.hasMoreElements()) {
                NetworkInterface ni = en.nextElement();
                try {
                    if (!ni.isUp() || ni.isLoopback()) continue;
                } catch (IOException e) {
                    continue;
                }
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    InetAddress b = ia == null ? null : ia.getBroadcast();
                    if (b instanceof Inet4Address && !out.contains(b)) out.add(b);
                }
            }
        } catch (Throwable t) { // SocketException, SecurityException on locked-down devices
            log.w("interface list", t);
        }
        return out;
    }

    /**
     * Sends "DRONESIM?1" to every target (once more after a third of the wait), returns the base URLs from the
     * first valid "DRONESIM!1 http://ip:port/" reply (sender address first if it differs), or an empty list.
     * bind: local address for the socket (null = any; tests use 127.0.0.1).
     */
    static List<String> discover(List<InetAddress> targets, int port, InetAddress bind, int waitMs) {
        DatagramSocket s = null;
        try {
            s = bind == null ? new DatagramSocket() : new DatagramSocket(0, bind);
            s.setBroadcast(true);
            byte[] q = DISCOVERY_REQUEST.getBytes(ASCII);
            long start = System.nanoTime();
            send(s, q, targets, port);
            boolean resent = false;
            byte[] buf = new byte[600];
            while (true) {
                long el = (System.nanoTime() - start) / 1000000L;
                long left = waitMs - el;
                if (left <= 0) break;
                if (!resent && el >= waitMs / 3) {
                    send(s, q, targets, port); // UDP broadcast on Wi-Fi gets lost now and then
                    resent = true;
                }
                long slice = resent ? left : Math.max(1, waitMs / 3 - el);
                s.setSoTimeout((int) Math.max(1, Math.min(left, slice)));
                DatagramPacket pk = new DatagramPacket(buf, buf.length);
                try {
                    s.receive(pk);
                } catch (SocketTimeoutException e) {
                    continue;
                } catch (java.net.PortUnreachableException e) {
                    continue; // ICMP from a target without a responder (Windows reports it on receive)
                }
                String msg = new String(pk.getData(), pk.getOffset(), pk.getLength(), ASCII).trim();
                List<String> urls = parseReply(msg, pk.getAddress());
                if (!urls.isEmpty()) return urls;
                log.i("ignored discovery reply from " + pk.getAddress());
            }
        } catch (IOException e) {
            log.w("discovery", e);
        } finally {
            if (s != null) s.close();
        }
        return new ArrayList<String>();
    }

    private static void send(DatagramSocket s, byte[] q, List<InetAddress> targets, int port) {
        for (InetAddress t : targets) {
            try {
                s.send(new DatagramPacket(q, q.length, t, port));
            } catch (IOException e) {
                log.w("discovery send " + t, e); // e.g. ENETUNREACH for an interface that just went down
            }
        }
    }

    /** "DRONESIM!1 http://a.b.c.d:port/" (LAN IPv4 only) -> [http://sender:port/ if different, http://a.b.c.d:port/]. */
    static List<String> parseReply(String msg, InetAddress from) {
        List<String> out = new ArrayList<String>();
        if (msg == null) return out;
        Matcher m = REPLY.matcher(msg.trim());
        if (!m.matches()) return out;
        String host = m.group(1);
        if (!isLanIpv4(host)) return out;
        String portPart = "";
        if (m.group(2) != null) {
            int p = Integer.parseInt(m.group(2));
            if (p < 1 || p > 65535) return out;
            portPart = ":" + p;
        }
        if (from instanceof Inet4Address) {
            String fh = from.getHostAddress();
            if (!fh.equals(host) && isLanIpv4(fh)) out.add("http://" + fh + portPart + "/");
        }
        out.add("http://" + host + portPart + "/");
        return out;
    }

    // ------------------------------------------------------------------------------------------ safe extraction (P3)

    /**
     * Extracts a content zip into the (empty) folder dest. Rejects absolute names, backslashes, ':' , "." / ".."
     * segments, empty segments, our marker names, anything that canonicalises outside dest, more than maxEntries
     * entries, more than maxBytes uncompressed (counted while copying, not trusted from the header), a missing
     * index.html and a content-version.txt that is not expectVersion.
     */
    static void extract(File zipFile, File dest, long maxBytes, int maxEntries, long expectVersion) throws IOException {
        ZipFile z = new ZipFile(zipFile);
        try {
            if (z.size() > maxEntries) throw new IOException("too many entries: " + z.size());
            String destCanon = dest.getCanonicalPath() + File.separator;
            boolean index = false;
            String versionText = null;
            long total = 0;
            int count = 0;
            Set<String> seen = new HashSet<String>();
            byte[] buf = new byte[64 * 1024];
            Enumeration<? extends ZipEntry> en = z.entries();
            while (en.hasMoreElements()) {
                ZipEntry e = en.nextElement();
                if (++count > maxEntries) throw new IOException("too many entries");
                String name = e.getName();
                checkEntryName(name);
                boolean dir = name.endsWith("/");
                String clean = dir ? name.substring(0, name.length() - 1) : name;
                if (!seen.add(clean.toLowerCase(Locale.ROOT))) throw new IOException("duplicate entry " + name);
                File out = new File(dest, clean.replace('/', File.separatorChar));
                String canon = out.getCanonicalPath();
                if (!canon.startsWith(destCanon)) throw new IOException("entry outside the target: " + name);
                if (dir || e.isDirectory()) {
                    if (!out.isDirectory() && !out.mkdirs()) throw new IOException("mkdir " + name);
                    continue;
                }
                File parent = out.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("mkdir " + parent);
                InputStream in = z.getInputStream(e);
                OutputStream os = new FileOutputStream(out);
                ByteArrayOutputStream keep = name.equals(CONTENT_VERSION_FILE) ? new ByteArrayOutputStream() : null;
                try {
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        total += n;
                        if (total > maxBytes) throw new IOException("content bigger than " + maxBytes + " bytes");
                        os.write(buf, 0, n);
                        if (keep != null && keep.size() < 64) keep.write(buf, 0, Math.min(n, 64));
                    }
                } finally {
                    closeQuietly(os);
                    closeQuietly(in);
                }
                if (name.equals("index.html")) index = true;
                if (keep != null) versionText = new String(keep.toByteArray(), ASCII).trim();
            }
            if (!index) throw new IOException("index.html missing");
            if (versionText == null || parseLong(versionText, -1) != expectVersion) {
                throw new IOException(CONTENT_VERSION_FILE + " is '" + versionText + "', expected " + expectVersion);
            }
        } finally {
            z.close();
        }
    }

    static void checkEntryName(String name) throws IOException {
        if (name == null || name.length() == 0 || name.length() > 240) throw new IOException("bad entry name");
        if (name.startsWith("/") || name.indexOf('\\') >= 0 || name.indexOf(':') >= 0 || name.indexOf('\0') >= 0) {
            throw new IOException("bad entry name " + name);
        }
        String body = name.endsWith("/") ? name.substring(0, name.length() - 1) : name;
        if (body.length() == 0) throw new IOException("bad entry name " + name);
        for (String seg : body.split("/", -1)) {
            if (seg.length() == 0 || seg.equals(".") || seg.equals("..")) throw new IOException("bad entry name " + name);
            for (int i = 0; i < seg.length(); i++) if (seg.charAt(i) < 0x20) throw new IOException("bad entry name " + name);
        }
        if (body.equals(COMPLETE_MARKER) || body.equals(META_FILE)) throw new IOException("reserved entry name " + name);
    }

    // ------------------------------------------------------------------------------------------ store (P6)

    /** What to serve: an installed version (dir != null) or the APK's bundled assets (dir == null). */
    static final class Selection {
        final long version;
        final File dir;

        Selection(long version, File dir) {
            this.version = version;
            this.dir = dir;
        }

        boolean installed() { return dir != null; }

        @Override public String toString() { return (dir == null ? "bundled " : "installed ") + version; }
    }

    /** filesDir/updates: content/&lt;ver&gt;/, tmp/, apk/, state.properties. */
    static final class Store {
        final File root, content, tmp, apk, stateFile;
        private final Properties state = new Properties();

        Store(File root) {
            this.root = root;
            content = new File(root, "content");
            tmp = new File(root, "tmp");
            apk = new File(root, "apk");
            stateFile = new File(root, "state.properties");
            content.mkdirs();
            tmp.mkdirs();
            apk.mkdirs();
            load();
        }

        private synchronized void load() {
            state.clear();
            Properties p = readProps(stateFile);
            state.putAll(p);
        }

        synchronized void save() {
            try {
                writeProps(stateFile, state);
            } catch (IOException e) {
                log.w("state save", e);
            }
        }

        synchronized String get(String k) { return state.getProperty(k); }

        synchronized long getLong(String k, long def) { return parseLong(state.getProperty(k), def); }

        /** null removes. Call save() afterwards. */
        synchronized void set(String k, String v) {
            if (v == null) state.remove(k); else state.setProperty(k, v);
        }

        synchronized void set(String k, long v) { state.setProperty(k, Long.toString(v)); }

        synchronized Set<Long> bad() { return longs(K_BAD); }

        synchronized boolean isBad(long v) { return bad().contains(v); }

        synchronized void markBad(long v) {
            if (v <= 0) return;
            addLong(K_BAD, v, MAX_BAD);
            if (getLong(K_TRIAL, 0) == v) clearTrialKeys();
            save();
            log.i("content " + v + " marked bad");
        }

        synchronized boolean isGood(long v) { return longs(K_GOOD).contains(v); }

        private Set<Long> longs(String key) {
            Set<Long> out = new LinkedHashSet<Long>();
            String s = state.getProperty(key);
            if (s == null) return out;
            for (String p : s.split(",")) {
                long v = parseLong(p, 0);
                if (v > 0) out.add(v);
            }
            return out;
        }

        private void addLong(String key, long v, int max) {
            List<Long> list = new ArrayList<Long>(longs(key));
            if (!list.contains(v)) list.add(v);
            while (list.size() > max) list.remove(0);
            StringBuilder b = new StringBuilder();
            for (Long x : list) {
                if (b.length() > 0) b.append(',');
                b.append(x);
            }
            state.setProperty(key, b.toString());
        }

        private void clearTrialKeys() {
            state.remove(K_TRIAL);
            state.remove(K_TRIAL_ATTEMPTS);
        }

        // ---- P7 across restarts (crash-loop guard). The Activity calls beginTrial() right before it loads an
        // installed version that has never passed the health check, cancelTrial() when it leaves the foreground
        // cleanly before the check, passTrial() when the check passes. A start that kills the whole process
        // (GPU driver crash, out of memory) leaves its attempt counted; selectForStart() then gives up on it.

        /** Counts one more start of installed version v that has not proved itself yet; saved at once. */
        synchronized void beginTrial(long v) {
            if (v <= 0) return;
            long n = getLong(K_TRIAL, 0) == v ? Math.max(0, getLong(K_TRIAL_ATTEMPTS, 0)) : 0;
            set(K_TRIAL, v);
            set(K_TRIAL_ATTEMPTS, n + 1);
            save();
        }

        /** That start ended cleanly (app went to the background / switched content) before the check. */
        synchronized void cancelTrial(long v) {
            if (v <= 0 || getLong(K_TRIAL, 0) != v) return;
            long n = getLong(K_TRIAL_ATTEMPTS, 0) - 1;
            if (n <= 0) clearTrialKeys(); else set(K_TRIAL_ATTEMPTS, n);
            save();
        }

        /** The health check passed: v is good from now on (no more trials for it). */
        synchronized void passTrial(long v) {
            if (v <= 0) return;
            boolean trial = getLong(K_TRIAL, 0) == v;
            if (!trial && isGood(v)) return;
            if (trial) clearTrialKeys();
            addLong(K_GOOD, v, MAX_GOOD);
            save();
        }

        /**
         * Cold start (P6 + P7): select(), except that an installed version which already failed to come up
         * maxAttempts starts in a row (the process died before its health check) is marked bad first.
         */
        synchronized Selection selectForStart(long bundled, int nativeApi, int maxAttempts) {
            for (int i = 0; i < MAX_BAD; i++) {
                Selection s = select(bundled, nativeApi);
                long attempts = getLong(K_TRIAL_ATTEMPTS, 0);
                if (!s.installed() || getLong(K_TRIAL, 0) != s.version || attempts < maxAttempts) return s;
                log.i("content " + s.version + " did not come up in " + attempts + " starts");
                markBad(s.version);
            }
            return new Selection(bundled, null);
        }

        /** "Later" on the APK dialog: that versionCode is not offered again until `until`, or a newer publish. */
        synchronized void snooze(long code, long until) {
            set(K_SNOOZE_CODE, code);
            set(K_SNOOZE_UNTIL, until);
            set(K_SNOOZE_PUB, getLong(K_APK_PUB, 0));
            save();
        }

        File dirFor(long v) { return new File(content, Long.toString(v)); }

        /** Complete (marker + index.html), meta matches, minNative ok, not bad. */
        synchronized boolean usable(long v, int nativeApi) {
            if (v <= 0 || isBad(v)) return false;
            File d = dirFor(v);
            if (!new File(d, COMPLETE_MARKER).isFile() || !new File(d, "index.html").isFile()) return false;
            Properties meta = readProps(new File(d, META_FILE));
            return parseLong(meta.getProperty("version"), -1) == v
                    && parseLong(meta.getProperty("minNative"), Long.MAX_VALUE) <= nativeApi;
        }

        /** P6: the highest of {bundled, current, previous} that is usable. */
        synchronized Selection select(long bundled, int nativeApi) {
            long best = 0;
            long cur = getLong(K_CURRENT, 0), prev = getLong(K_PREVIOUS, 0);
            if (usable(cur, nativeApi)) best = cur;
            if (prev > best && usable(prev, nativeApi)) best = prev;
            if (best > bundled) return new Selection(best, dirFor(best));
            return new Selection(bundled, null);
        }

        /** P7: mark the served installed version bad and pick what to serve instead. */
        synchronized Selection rollback(long version, long bundled, int nativeApi) {
            markBad(version);
            return select(bundled, nativeApi);
        }

        /** Highest content version that must never be applied again (anything <= is old or a replay). */
        synchronized long floor(long bundled, long served) {
            return Math.max(Math.max(bundled, served), Math.max(getLong(K_CURRENT, 0), getLong(K_MAX, 0)));
        }

        /**
         * Extracts a verified zip into tmp (outside the lock), then moves it to content/&lt;ver&gt;/, writes the
         * marker last and makes it "current" (the old current becomes "previous"). Applied on the next start.
         */
        long install(File zip, Manifest m) throws IOException {
            long v = m.contentVersion;
            File x = new File(tmp, "x-" + v);
            deleteTree(x);
            if (!x.mkdirs()) throw new IOException("mkdir " + x);
            try {
                extract(zip, x, MAX_CONTENT_BYTES, MAX_CONTENT_ENTRIES, v);
                Properties meta = new Properties();
                meta.setProperty("version", Long.toString(v));
                meta.setProperty("minNative", Integer.toString(m.contentMinNative));
                meta.setProperty("sha256", m.contentSha256);
                meta.setProperty("published", Long.toString(m.published));
                writeProps(new File(x, META_FILE), meta);
                synchronized (this) {
                    File d = dirFor(v);
                    deleteTree(d);
                    if (!x.renameTo(d)) throw new IOException("cannot move " + x + " -> " + d);
                    writeMarker(new File(d, COMPLETE_MARKER));
                    long cur = getLong(K_CURRENT, 0);
                    if (cur > 0 && cur != v && usable(cur, Integer.MAX_VALUE)) set(K_PREVIOUS, cur);
                    set(K_CURRENT, v);
                    set(K_MAX, Math.max(getLong(K_MAX, 0), v));
                    save();
                }
                log.i("content " + v + " installed");
                return v;
            } finally {
                deleteTree(x);
            }
        }

        /**
         * Startup clean-up (updater thread): forget installed versions that the APK's bundled content already
         * replaces, delete every content folder except current / previous / served, empty tmp/.
         */
        void gc(long served, long bundled) {
            List<File> drop = new ArrayList<File>();
            synchronized (this) {
                long cur = getLong(K_CURRENT, 0), prev = getLong(K_PREVIOUS, 0);
                boolean changed = false;
                if (cur != 0 && cur <= bundled && cur != served) { set(K_CURRENT, null); cur = 0; changed = true; }
                if (prev != 0 && prev <= bundled && prev != served) { set(K_PREVIOUS, null); prev = 0; changed = true; }
                if (changed) save();
                File[] list = content.listFiles();
                if (list != null) {
                    for (File f : list) {
                        long v = parseLong(f.getName(), -1);
                        if (v <= 0 || (v != cur && v != prev && v != served)) drop.add(f);
                    }
                }
                File[] t = tmp.listFiles();
                if (t != null) Collections.addAll(drop, t);
            }
            for (File f : drop) deleteTree(f); // nothing references these any more
        }

        File apkFile(long code) { return new File(apk, "DroneSim-" + code + ".apk"); }

        synchronized void clearApk() {
            File[] list = apk.listFiles();
            if (list != null) for (File f : list) deleteTree(f);
            for (String k : new String[] {K_APK_CODE, K_APK_NAME, K_APK_SHA, K_APK_SIZE, K_APK_NOTES, K_APK_PUB}) state.remove(k);
            save();
        }
    }

    // ------------------------------------------------------------------------------------------ decisions (P4)

    static boolean contentWanted(Manifest m, long floor, Set<Long> bad, int nativeApi) {
        return m != null && m.hasContent && m.contentVersion > floor && !bad.contains(m.contentVersion)
                && m.contentMinNative <= nativeApi && m.contentSize <= MAX_CONTENT_BYTES;
    }

    static boolean apkWanted(Manifest m, long ownCode) {
        return m != null && m.hasApk && m.apkVersionCode > ownCode;
    }

    /** P9: "later" snoozes that versionCode for 24 h; a manual check always asks. */
    static boolean apkPromptAllowed(long code, long snoozeCode, long snoozeUntil, long now, boolean manual) {
        return manual || code != snoozeCode || now >= snoozeUntil;
    }

    /**
     * Automatic check on resume: the last check is older than `interval`, or it failed (lastOk &lt; last: e.g. the PC
     * was not serving yet) and is at least `retryMs` old, or the clock went back.
     */
    static boolean checkDue(long last, long lastOk, long now, long interval, long retryMs) {
        if (now < last) return true;
        if (now - last > interval) return true;
        return lastOk < last && now - last >= retryMs;
    }

    // ------------------------------------------------------------------------------------------ check (engine)

    interface Events {
        /** state: checking | downloading | ready | none | error; kind: content | apk | ""; progress -1 = n/a. */
        void event(String state, String kind, long version, double progress, String reason);
    }

    static final class Env {
        List<PublicKey> keys = new ArrayList<PublicKey>();
        long ownApkCode;
        long bundledContent;
        long servedContent;
        int nativeApi = NATIVE_API;
        List<String> configSources = new ArrayList<String>();
        InetAddress discoveryBind;           // null = any address (device); tests: 127.0.0.1
        List<InetAddress> discoveryTargets;  // null = broadcastTargets()
        int discoveryPort = DISCOVERY_PORT;
        int discoveryWaitMs = DISCOVERY_WAIT_MS;
        long now = System.currentTimeMillis();
    }

    static final class Probe {
        final String base;
        final Manifest manifest;

        Probe(String base, Manifest manifest) {
            this.base = base;
            this.manifest = manifest;
        }
    }

    static final class Result {
        boolean reached;        // at least one manifest verified
        String reason = "";     // unreachable | signature | download | install | disk | ""
        long contentInstalled;  // version installed by this check, 0 = none
        Manifest apk;           // newer APK (apkFile downloaded and SHA-256 checked), else null
        File apkFile;
        String apkBase;
        String lanUrl;          // working LAN base URL, if any
    }

    /** Fetch + verify base/update.properties; null when unreachable, unsigned or invalid (flags[0] = bad sig). */
    static Probe probe(String base, List<PublicKey> keys, boolean[] badSig) {
        try {
            byte[] man = fetch(base + MANIFEST, MAX_MANIFEST_BYTES);
            byte[] sig = fetch(base + SIGNATURE, MAX_SIG_BYTES);
            if (!verifySignature(man, sig, keys)) {
                log.w("signature does not verify: " + base, null);
                badSig[0] = true;
                return null;
            }
            return new Probe(base, Manifest.parse(man));
        } catch (IOException e) {
            log.i("no update source at " + base + ": " + e.getMessage());
            return null;
        }
    }

    /** One complete check: sources -> verified manifests -> content install and/or APK download. */
    static Result check(Store store, Env env, Events ev) {
        Result r = new Result();
        ev.event("checking", "", 0, -1, "");
        List<String> sources = new ArrayList<String>(env.configSources);
        for (String s : parseSources(store.get(K_SOURCES))) if (!sources.contains(s)) sources.add(s);
        String lanUrl = normalizeBase(store.get(K_LAN));
        boolean[] badSig = new boolean[1];
        List<Probe> found = new ArrayList<Probe>();

        if (sources.contains(SOURCE_LAN) || lanUrl != null) {
            List<String> tried = new ArrayList<String>();
            Probe p = null;
            if (lanUrl != null) {
                tried.add(lanUrl);
                p = probe(lanUrl, env.keys, badSig);
            }
            if (p == null && sources.contains(SOURCE_LAN)) {
                List<InetAddress> targets = env.discoveryTargets != null ? env.discoveryTargets : broadcastTargets();
                for (String u : discover(targets, env.discoveryPort, env.discoveryBind, env.discoveryWaitMs)) {
                    if (tried.contains(u)) continue;
                    tried.add(u);
                    p = probe(u, env.keys, badSig);
                    if (p != null) break;
                }
            }
            if (p != null) {
                found.add(p);
                r.lanUrl = p.base;
                if (!p.base.equals(lanUrl)) {
                    store.set(K_LAN, p.base);
                    store.save();
                }
            }
        }
        for (String s : sources) {
            if (SOURCE_LAN.equals(s) || s.equals(r.lanUrl)) continue;
            Probe p = probe(s, env.keys, badSig);
            if (p != null) found.add(p);
        }

        store.set(K_LAST_CHECK, env.now);
        if (found.isEmpty()) {
            store.save();
            r.reason = badSig[0] ? "signature" : "unreachable";
            ev.event("error", "", 0, -1, r.reason);
            return r;
        }
        r.reached = true;
        store.set(K_LAST_OK, env.now);

        // remember extra sources announced by verified manifests
        List<String> remembered = parseSources(store.get(K_SOURCES));
        for (Probe p : found) {
            for (String s : p.manifest.sources) {
                if (!remembered.contains(s) && !env.configSources.contains(s) && remembered.size() < MAX_SOURCES) remembered.add(s);
            }
        }
        store.set(K_SOURCES, remembered.isEmpty() ? null : joinSources(remembered));
        store.save();

        long floor = store.floor(env.bundledContent, env.servedContent);
        Set<Long> bad = store.bad();
        Probe bestC = null, bestA = null;
        for (Probe p : found) {
            Manifest m = p.manifest;
            if (contentWanted(m, floor, bad, env.nativeApi)
                    && (bestC == null || m.contentVersion > bestC.manifest.contentVersion)) bestC = p;
            if (apkWanted(m, env.ownApkCode) && (bestA == null || m.apkVersionCode > bestA.manifest.apkVersionCode)) bestA = p;
        }

        String failure = "";
        if (bestC != null) {
            final Manifest m = bestC.manifest;
            File zip = new File(store.tmp, m.contentFile);
            try {
                long usable = store.tmp.getUsableSpace();
                if (usable > 0 && usable < m.contentSize * 3 + (16L << 20)) {
                    failure = "disk";
                    throw new IOException("not enough free space");
                }
                download(bestC.base + m.contentFile, zip, m.contentSize, m.contentSha256, throttled(ev, "content", m.contentVersion));
                failure = "install";
                r.contentInstalled = store.install(zip, m);
                failure = "";
                ev.event("ready", "content", m.contentVersion, 1, "");
            } catch (IOException e) {
                if (failure.length() == 0) failure = "download";
                log.w("content " + m.contentVersion + " failed", e);
            } finally {
                deleteTree(zip);
            }
        }
        if (bestA != null) {
            Manifest m = bestA.manifest;
            try {
                File f = store.apkFile(m.apkVersionCode);
                boolean have = f.isFile() && f.length() == m.apkSize && sha256Hex(f).equals(m.apkSha256);
                if (!have) {
                    store.clearApk();
                    long usable = store.apk.getUsableSpace();
                    if (usable > 0 && usable < m.apkSize * 3 + (16L << 20)) throw new IOException("not enough free space");
                    download(bestA.base + m.apkFile, f, m.apkSize, m.apkSha256, throttled(ev, "apk", m.apkVersionCode));
                }
                store.set(K_APK_CODE, m.apkVersionCode);
                store.set(K_APK_NAME, m.apkVersionName);
                store.set(K_APK_SHA, m.apkSha256);
                store.set(K_APK_SIZE, m.apkSize);
                store.set(K_APK_NOTES, m.notes);
                store.set(K_APK_PUB, m.published);
                // "later" holds only until the PC publishes again (a new double-click = the user wants it now)
                if (store.getLong(K_SNOOZE_CODE, 0) == m.apkVersionCode && m.published > store.getLong(K_SNOOZE_PUB, 0)) {
                    store.set(K_SNOOZE_CODE, null);
                    store.set(K_SNOOZE_UNTIL, null);
                    store.set(K_SNOOZE_PUB, null);
                }
                store.save();
                r.apk = m;
                r.apkFile = f;
                r.apkBase = bestA.base;
            } catch (IOException e) {
                if (failure.length() == 0) failure = "download";
                log.w("apk " + m.apkVersionCode + " failed", e);
            }
        }
        r.reason = failure;
        if (failure.length() > 0) ev.event("error", "", 0, -1, failure);
        else if (bestC == null && bestA == null) ev.event("none", "", 0, -1, "");
        return r;
    }

    /** Progress events at most every 2 % or 500 ms. */
    static Progress throttled(final Events ev, final String kind, final long version) {
        return new Progress() {
            private long lastMs;
            private int lastPct = -1;

            @Override
            public void onProgress(long done, long total) {
                int pct = total <= 0 ? 0 : (int) (done * 100 / total);
                long now = System.currentTimeMillis();
                if (lastPct < 0 || pct >= lastPct + 2 || now - lastMs >= 500 || done == total) {
                    if (pct == lastPct && done != total) return;
                    lastPct = pct;
                    lastMs = now;
                    ev.event("downloading", kind, version, total <= 0 ? 0 : (double) done / total, "");
                }
            }
        };
    }

    // ------------------------------------------------------------------------------------------ file helpers

    static Properties readProps(File f) {
        Properties p = new Properties();
        if (!f.isFile()) return p;
        Reader r = null;
        try {
            r = new InputStreamReader(new FileInputStream(f), UTF8);
            p.load(r);
        } catch (Exception e) {
            log.w("unreadable " + f, e);
            p.clear();
        } finally {
            closeQuietly(r);
        }
        return p;
    }

    /** Atomic: write f.tmp, fsync, rename over f. */
    static void writeProps(File f, Properties p) throws IOException {
        File t = new File(f.getPath() + ".tmp");
        FileOutputStream fo = new FileOutputStream(t);
        try {
            Writer w = new OutputStreamWriter(fo, UTF8);
            p.store(w, null);
            w.flush();
            fo.getFD().sync();
        } finally {
            closeQuietly(fo);
        }
        if (!t.renameTo(f)) { // Windows (tests) cannot rename over an existing file
            if (f.exists() && !f.delete()) throw new IOException("cannot replace " + f);
            if (!t.renameTo(f)) throw new IOException("cannot write " + f);
        }
    }

    static void writeMarker(File f) throws IOException {
        FileOutputStream fo = new FileOutputStream(f);
        try {
            fo.write("ok\n".getBytes(ASCII));
            fo.getFD().sync();
        } finally {
            closeQuietly(fo);
        }
    }

    /** Reads a small text file such as content-version.txt; 0 when missing or not a number. */
    static long readVersion(InputStream in) {
        if (in == null) return 0;
        try {
            byte[] b = new byte[64];
            int n = 0, k;
            while (n < b.length && (k = in.read(b, n, b.length - n)) != -1) n += k;
            return Math.max(0, parseLong(new String(b, 0, n, ASCII).trim(), 0));
        } catch (IOException e) {
            return 0;
        } finally {
            closeQuietly(in);
        }
    }

    /** Recursive delete that never follows a symlinked folder out of the tree. */
    static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        if (f.isDirectory() && !isSymlink(f)) {
            File[] list = f.listFiles();
            if (list != null) for (File c : list) deleteTree(c);
        }
        if (!f.delete() && f.exists()) log.w("cannot delete " + f, null);
    }

    private static boolean isSymlink(File f) {
        try {
            File parent = f.getParentFile();
            File canonParent = parent == null ? null : parent.getCanonicalFile();
            File same = canonParent == null ? f : new File(canonParent, f.getName());
            return !same.getCanonicalFile().equals(same.getAbsoluteFile());
        } catch (IOException e) {
            return true; // be safe: do not descend
        }
    }

    static void closeQuietly(java.io.Closeable c) {
        if (c == null) return;
        try {
            c.close();
        } catch (IOException ignored) {
            // nothing useful to do
        }
    }
}
