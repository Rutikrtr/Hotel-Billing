// Signs the Android app with the private release key (APK Signature Scheme v2; the app needs Android 7+).
// Usage: java -cp apksig.jar:. SignApk <keystore.p12> <alias> <password> <in.apk> <out.apk>
import com.android.apksig.ApkSigner;
import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.List;

public class SignApk {
    public static void main(String[] args) throws Exception {
        if (args.length != 5) {
            System.err.println("Usage: SignApk <keystore> <alias> <password> <in.apk> <out.apk>");
            System.exit(2);
        }
        char[] password = args[2].toCharArray();
        KeyStore ks = KeyStore.getInstance("PKCS12");
        try (FileInputStream in = new FileInputStream(args[0])) { ks.load(in, password); }
        PrivateKey key = (PrivateKey) ks.getKey(args[1], password);
        X509Certificate cert = (X509Certificate) ks.getCertificate(args[1]);
        ApkSigner.SignerConfig signer = new ApkSigner.SignerConfig.Builder("hotelbilling", key, List.of(cert)).build();
        new ApkSigner.Builder(List.of(signer))
                .setInputApk(new File(args[3]))
                .setOutputApk(new File(args[4]))
                .setMinSdkVersion(24)
                .setV1SigningEnabled(false)
                .setV2SigningEnabled(true)
                .build()
                .sign();
        System.out.println("Signed " + args[4]);
    }
}
