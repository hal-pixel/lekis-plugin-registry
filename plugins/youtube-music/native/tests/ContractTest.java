// SPDX-License-Identifier: GPL-3.0-or-later
package dev.lekis.youtube;
import com.grack.nanojson.*;

/** Offline boundary tests; performs no network requests. */
public final class ContractTest {
    private static void check(boolean value) { if (!value) throw new AssertionError(); }
    public static void main(String[] args) throws Exception {
        String id = "dQw4w9WgXcQ";
        for (String value : new String[]{id, "https://music.youtube.com/watch?v="+id+"&list=test", "https://youtu.be/"+id+"?si=x"})
            check(id.equals(YoutubeNativePlugin.directId(value)));
        for (String value : new String[]{"https://evil.youtube.com/watch?v="+id, "https://youtube.com@evil.example/watch?v="+id, "https://music.youtube.com:4430/watch?v="+id, "--exec=bad"})
            check(YoutubeNativePlugin.directId(value) == null);
        check(YoutubeNativePlugin.cdn("https://rr1.googlevideo.com/videoplayback?expire=123"));
        for (String value : new String[]{"http://rr1.googlevideo.com/x", "https://googlevideo.com.evil.test/x", "https://rr1.googlevideo.com@evil.test/x", "https://rr1.googlevideo.com:8443/x"})
            check(!YoutubeNativePlugin.cdn(value));
        for (String[] call : new String[][]{{"unknown","{}","unsupported"},{"stream","{\"id\":\"--exec=bad\"}","unavailable"},{"search","{\"query\":\"\"}",null}}) {
            JsonObject response = JsonParser.object().from(YoutubeNativePlugin.invoke(call[0],call[1]));
            if (call[2] == null) check(response.getBoolean("ok") && response.getObject("result").getArray("items").isEmpty());
            else check(!response.getBoolean("ok") && call[2].equals(response.getObject("error").getString("code")));
        }
        System.out.println("PASS native URL, CDN and ABI boundaries (offline)");
    }
}
