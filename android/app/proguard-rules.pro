# JavaScript calls these methods by name in the minified release build.
-keepclassmembers class com.houseofkiran.SecureSessionBridge {
    @android.webkit.JavascriptInterface <methods>;
}
