// SPDX-License-Identifier: GPL-3.0-or-later
package dev.lekis.youtube;
import com.grack.nanojson.*;
import java.net.*;
import java.io.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;

/** Real local parser -> search result -> AAC CDN test. Never prints signed media URLs. */
public final class LiveSmoke {
    private static JsonObject call(String operation, JsonObject payload) throws Exception {
        JsonObject response = JsonParser.object().from(YoutubeNativePlugin.invoke(operation, JsonWriter.string(payload)));
        if (!response.getBoolean("ok")) throw new IOException(JsonWriter.string(response.getObject("error")));
        return response.getObject("result");
    }
    public static void main(String[] args) throws Exception {
        JsonObject input = new JsonObject(); input.put("query", args.length > 0 ? args[0] : "Rick Astley"); input.put("limit", 3);
        JsonObject page = call("search", input); JsonArray items = page.getArray("items");
        if (items.isEmpty()) throw new IOException("Search returned no tracks");
        String id = items.getObject(0).getString("id");
        System.out.println("Search: " + items.size() + " tracks; mode=" + page.getString("searchMode") + "; first ID=" + id);
        input = new JsonObject(); input.put("id", id); input.put("quality", "high");
        JsonObject stream = call("stream", input);
        HttpURLConnection connection = (HttpURLConnection) new URL(stream.getString("url")).openConnection();
        connection.setConnectTimeout(8000); connection.setReadTimeout(8000); connection.setRequestProperty("Range", "bytes=0-262143");
        JsonObject headers = stream.getObject("headers");
        for (String name : headers.keySet()) connection.setRequestProperty(name, headers.getString(name));
        int status = connection.getResponseCode();
        if (status != 200 && status != 206) throw new IOException("Media HTTP status " + status);
        byte[] bytes;
        try (InputStream body = connection.getInputStream()) { bytes = body.readNBytes(262144); }
        finally { connection.disconnect(); }
        if (bytes.length < 8 || !new String(bytes, 4, 4, StandardCharsets.US_ASCII).equals("ftyp")) throw new IOException("Invalid AAC/M4A container");
        if (args.length > 1) Files.write(Path.of(args[1]), bytes);
        JsonObject report = new JsonObject(); report.put("passed", true); report.put("runtime", "JVM local NewPipe source build");
        report.put("searchMode", page.getString("searchMode")); report.put("tracks", items.size()); report.put("firstId", id);
        report.put("mediaStatus", status); report.put("mediaBytes", bytes.length); report.put("itag", stream.getInt("itag"));
        report.put("mimeType", stream.getString("mimeType")); report.put("headers", headers.size());
        if (args.length > 2) Files.writeString(Path.of(args[2]), JsonWriter.string(report));
        System.out.println("PASS " + JsonWriter.string(report));
    }
}
