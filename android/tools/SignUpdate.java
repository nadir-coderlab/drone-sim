import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.Signature;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Locale;

/**
 * Signs the update manifest (update.properties) with the APK release key, so the app on the TV can check it
 * with its own signing certificate (protocol P2: lowercase hex of SHA256withRSA over the exact file bytes).
 *
 * Run it straight from the source file (JDK 11+), from an ASCII-only folder:
 *   java SignUpdate.java sign   <keystore> <alias> <in-file> <out.sig>
 *   java SignUpdate.java cert   <keystore> <alias>                 prints the certificate SHA-256 (lowercase hex)
 *   java SignUpdate.java verify <keystore> <alias> <in-file> <sig>    exit 0 = signature good
 *   java SignUpdate.java verify-cert <cert.der|cert.pem> <in-file> <sig>   same check with a certificate file
 *                                                                    (no password needed: what the app does)
 * The keystore password comes from the environment variable DS_KS_PASS (never from the command line).
 * Exit codes: 0 ok, 1 bad signature / failure, 2 usage or missing password.
 */
public class SignUpdate {

    public static void main(String[] args) {
        try {
            System.exit(run(args));
        } catch (Exception e) {
            System.err.println("SignUpdate: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            System.exit(1);
        }
    }

    static int run(String[] a) throws Exception {
        if (a.length == 0) return usage();
        String cmd = a[0].toLowerCase(Locale.ROOT);
        if (cmd.equals("sign") && a.length == 5) {
            KeyStore ks = load(a[1]);
            char[] pass = password();
            PrivateKey key = (PrivateKey) ks.getKey(a[2], pass);
            Certificate cert = ks.getCertificate(a[2]);
            if (key == null || cert == null) throw new IllegalArgumentException("alias '" + a[2] + "' not found in " + a[1]);
            byte[] data = readAll(new File(a[3]));
            Signature s = Signature.getInstance("SHA256withRSA");
            s.initSign(key);
            s.update(data);
            byte[] sig = s.sign();
            // self-check with the public key of the same certificate before anything is written
            if (!verify(cert.getPublicKey(), data, sig)) throw new IllegalStateException("fresh signature does not verify");
            File out = new File(a[4]);
            File tmp = new File(out.getPath() + ".tmp");
            OutputStream os = new FileOutputStream(tmp);
            try { os.write(hex(sig).getBytes(StandardCharsets.US_ASCII)); } finally { os.close(); }
            if (out.exists() && !out.delete()) throw new IOException("cannot replace " + out);
            if (!tmp.renameTo(out)) throw new IOException("cannot write " + out);
            System.out.println("signed " + a[3] + " (" + data.length + " bytes) -> " + a[4]);
            System.out.println("cert sha256 " + hex(sha256(cert.getEncoded())));
            return 0;
        }
        if (cmd.equals("cert") && a.length == 3) {
            KeyStore ks = load(a[1]);
            Certificate cert = ks.getCertificate(a[2]);
            if (cert == null) throw new IllegalArgumentException("alias '" + a[2] + "' not found in " + a[1]);
            System.out.println(hex(sha256(cert.getEncoded())));
            return 0;
        }
        if (cmd.equals("verify") && a.length == 5) {
            KeyStore ks = load(a[1]);
            Certificate cert = ks.getCertificate(a[2]);
            if (cert == null) throw new IllegalArgumentException("alias '" + a[2] + "' not found in " + a[1]);
            return report(verify(cert.getPublicKey(), readAll(new File(a[3])), readSig(new File(a[4]))));
        }
        if (cmd.equals("verify-cert") && a.length == 4) {
            X509Certificate cert = (X509Certificate) CertificateFactory.getInstance("X.509")
                    .generateCertificate(new FileInputStream(a[1]));
            System.out.println("cert sha256 " + hex(sha256(cert.getEncoded())));
            return report(verify(cert.getPublicKey(), readAll(new File(a[2])), readSig(new File(a[3]))));
        }
        return usage();
    }

    static int report(boolean ok) {
        System.out.println(ok ? "signature OK" : "signature BAD");
        return ok ? 0 : 1;
    }

    static int usage() {
        System.err.println("usage:\n  java SignUpdate.java sign <keystore> <alias> <in> <out.sig>\n"
                + "  java SignUpdate.java cert <keystore> <alias>\n"
                + "  java SignUpdate.java verify <keystore> <alias> <in> <sig>\n"
                + "  java SignUpdate.java verify-cert <cert.der|pem> <in> <sig>\n"
                + "keystore password: environment variable DS_KS_PASS");
        return 2;
    }

    static char[] password() {
        String p = System.getenv("DS_KS_PASS");
        if (p == null || p.isEmpty()) {
            System.err.println("SignUpdate: DS_KS_PASS is not set (keystore password)");
            System.exit(2);
        }
        return p.toCharArray();
    }

    static KeyStore load(String path) throws Exception {
        char[] pass = password();
        KeyStore ks = KeyStore.getInstance("PKCS12");
        InputStream in = new FileInputStream(path);
        try { ks.load(in, pass); } finally { in.close(); }
        return ks;
    }

    static boolean verify(PublicKey pub, byte[] data, byte[] sig) throws Exception {
        if (sig == null) return false;
        Signature s = Signature.getInstance("SHA256withRSA");
        s.initVerify(pub);
        s.update(data);
        try { return s.verify(sig); } catch (java.security.SignatureException e) { return false; }
    }

    /** The .sig file: hex, whitespace around it ignored. Returns null when it is not valid hex. */
    static byte[] readSig(File f) throws IOException {
        String t = new String(readAll(f), StandardCharsets.US_ASCII).trim();
        if (t.length() == 0 || (t.length() & 1) != 0) return null;
        byte[] out = new byte[t.length() / 2];
        for (int i = 0; i < out.length; i++) {
            int hi = Character.digit(t.charAt(2 * i), 16), lo = Character.digit(t.charAt(2 * i + 1), 16);
            if (hi < 0 || lo < 0) return null;
            out[i] = (byte) ((hi << 4) | lo);
        }
        return out;
    }

    static byte[] readAll(File f) throws IOException {
        InputStream in = new FileInputStream(f);
        try {
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            int n;
            while ((n = in.read(b)) > 0) bo.write(b, 0, n);
            return bo.toByteArray();
        } finally { in.close(); }
    }

    static byte[] sha256(byte[] b) throws Exception {
        return MessageDigest.getInstance("SHA-256").digest(b);
    }

    static String hex(byte[] b) {
        char[] d = "0123456789abcdef".toCharArray();
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(d[(x >> 4) & 15]).append(d[x & 15]);
        return sb.toString();
    }
}
