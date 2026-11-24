// SPDX-License-Identifier: GPL-3.0-or-later
package dev.lekis.youtube;

import com.grack.nanojson.JsonArray;
import com.grack.nanojson.JsonObject;
import com.grack.nanojson.JsonParser;
import com.grack.nanojson.JsonWriter;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.regex.*;
import org.schabi.newpipe.extractor.*;
import org.schabi.newpipe.extractor.downloader.*;
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException;
import org.schabi.newpipe.extractor.localization.Localization;
import org.schabi.newpipe.extractor.search.SearchExtractor;
import org.schabi.newpipe.extractor.services.youtube.YoutubeParsingHelper;
import org.schabi.newpipe.extractor.services.youtube.linkHandler.YoutubeSearchQueryHandlerFactory;
import org.schabi.newpipe.extractor.stream.*;

/** In-process Android/JVM implementation. No Context, subprocess or remote parsing service. */
public final class YoutubeNativePlugin {
    private static final String UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
    private static final Localization LOCALE = new Localization("en", "US");
    private static final Pattern ID = Pattern.compile("[A-Za-z0-9_-]{11}");
    private static final Pattern EXPIRY = Pattern.compile("[?&]expire=(\\d+)(?:&|$)");
    private static long deadline;
    private static int requestCount;
    private static boolean initialized;

    private YoutubeNativePlugin() { }

    /** ABI consumed by Lekis's isolated plugin loader. Errors never contain signed URLs. */
    public static synchronized String invoke(String operation, String payloadJson) {
        try {
            deadline = System.nanoTime() + 25_000_000_000L;
            requestCount = 0;
            if (!initialized) {
                NewPipe.init(new BoundedDownloader(), LOCALE);
                initialized = true;
            }
            if (payloadJson == null || payloadJson.length() > 32768) throw new Failure("setup", "Invalid native request");
            JsonObject input = JsonParser.object().from(payloadJson);
            JsonObject result;
            if ("search".equals(operation)) result = search(input);
            else if ("stream".equals(operation)) result = stream(input);
            else throw new Failure("unsupported", "Unsupported YouTube operation");
            JsonObject envelope = new JsonObject();
            envelope.put("ok", true); envelope.put("result", result);
            return JsonWriter.string(envelope);
        } catch (Exception | LinkageError error) {
            String code = "unavailable";
            String message = "YouTube 本地解析失败，请稍后重试或更新插件。";
            if (error instanceof Failure) { code = ((Failure) error).code; message = error.getMessage(); }
            else if (error instanceof SocketTimeoutException || error instanceof InterruptedIOException) message = "YouTube 请求超时，请检查网络。";
            else {
                String name = error.getClass().getSimpleName();
                if (name.contains("AgeRestricted") || name.contains("PrivateContent") || name.contains("SignIn") || name.contains("Premium") || name.contains("PaidContent")) {
                    code = "signIn"; message = "该内容需要登录或购买，插件仅播放可公开访问的音频。";
                } else if (name.contains("ReCaptcha")) { code = "rateLimited"; message = "YouTube 暂时限制此网络的请求，请稍后再试。"; }
            }
            // Diagnostic class is useful for parser breakages, without upstream payload or URLs.
            JsonObject detail = new JsonObject(); detail.put("code", code); detail.put("message", message);
            detail.put("kind", error.getClass().getSimpleName());
            JsonObject envelope = new JsonObject(); envelope.put("ok", false); envelope.put("error", detail);
            return JsonWriter.string(envelope);
        }
    }

    private static JsonObject search(JsonObject input) throws Exception {
        String query = input.getString("query", "").trim();
        JsonArray items = new JsonArray();
        if (query.isEmpty()) return page(items);
        if (query.length() > 1000) throw new Failure("setup", "搜索词过长。");
        String id = directId(query);
        if (id != null) {
            StreamExtractor extractor = extractor(id);
            if (recording(extractor.getStreamType())) items.add(track(id, extractor.getName(), extractor.getUploaderName(), extractor.getLength()));
        } else {
            int limit = Math.max(1, Math.min(50, input.getInt("limit", 25)));
            SearchExtractor extractor = ServiceList.YouTube.getSearchExtractor(query,
                    Collections.singletonList(YoutubeSearchQueryHandlerFactory.MUSIC_SONGS), "");
            String mode = "youtube-music-songs";
            try { addSearchItems(extractor, items, limit); }
            catch (Exception error) {
                // Catalog restrictions must not block the explicit, local audio-search fallback.
                if (error instanceof InterruptedIOException || System.nanoTime() >= deadline) throw error;
            }
            if (items.isEmpty()) {
                extractor = ServiceList.YouTube.getSearchExtractor(query,
                        Collections.singletonList(YoutubeSearchQueryHandlerFactory.VIDEOS), "");
                addSearchItems(extractor, items, limit);
                mode = "youtube-audio-fallback";
            }
            JsonObject result = page(items); result.put("searchMode", mode); return result;
        }
        JsonObject result = page(items); result.put("searchMode", "direct-id"); return result;
    }

    private static void addSearchItems(SearchExtractor extractor, JsonArray items, int limit) throws Exception {
        extractor.fetchPage();
        Set<String> seen = new HashSet<>();
        org.schabi.newpipe.extractor.ListExtractor.InfoItemsPage<InfoItem> results = extractor.getInitialPage();
        if (results.getItems().isEmpty() && !results.getErrors().isEmpty()) throw new IOException("Search parser returned errors");
        for (InfoItem info : results.getItems()) {
                if (!(info instanceof StreamInfoItem)) continue;
                StreamInfoItem song = (StreamInfoItem) info;
                String songId = ServiceList.YouTube.getStreamLHFactory().getId(song.getUrl());
                if (!ID.matcher(songId).matches() || !recording(song.getStreamType()) || !seen.add(songId)) continue;
                items.add(track(songId, song.getName(), song.getUploaderName(), song.getDuration()));
                if (items.size() >= limit) break;
        }
    }

    private static JsonObject page(JsonArray items) { JsonObject out = new JsonObject(); out.put("items", items); return out; }
    private static JsonObject track(String id, String title, String artist, long seconds) {
        JsonObject out = new JsonObject(); out.put("id", id); out.put("title", title);
        JsonArray artists = new JsonArray(); artists.add(artist == null || artist.isEmpty() ? "YouTube Music" : artist);
        out.put("artists", artists); out.put("durationMs", Math.max(0, seconds) * 1000L);
        out.put("artworkUrl", "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg"); return out;
    }

    static String directId(String value) throws Exception {
        if (ID.matcher(value).matches()) return value;
        if (!value.startsWith("https://")) return null;
        URI uri = new URI(value);
        String host = uri.getHost();
        if (host == null || uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) return null;
        String id = null;
        if (host.equals("youtu.be")) id = uri.getPath().replaceFirst("^/", "");
        else if (Arrays.asList("youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com").contains(host) && "/watch".equals(uri.getPath())) {
            for (String pair : Objects.toString(uri.getRawQuery(), "").split("&")) {
                if (pair.startsWith("v=")) { id = URLDecoder.decode(pair.substring(2), "UTF-8"); break; }
            }
        }
        return id != null && ID.matcher(id).matches() ? id : null;
    }

    private static StreamExtractor extractor(String id) throws Exception {
        StreamExtractor extractor = ServiceList.YouTube.getStreamExtractor("https://www.youtube.com/watch?v=" + id);
        extractor.fetchPage(); return extractor;
    }
    private static boolean recording(StreamType type) { return type == StreamType.VIDEO_STREAM || type == StreamType.AUDIO_STREAM; }

    private static JsonObject stream(JsonObject input) throws Exception {
        String id = input.getString("id", "");
        if (!ID.matcher(id).matches()) throw new Failure("unavailable", "无效的歌曲 ID。");
        StreamExtractor extractor = extractor(id);
        if (!recording(extractor.getStreamType())) throw new Failure("unavailable", "当前插件不支持直播音频。");
        List<AudioStream> audio = new ArrayList<>();
        for (AudioStream candidate : extractor.getAudioStreams()) {
            // AudioStream excludes video muxes. Accept only clear, progressive formats decoded by Lekis.
            if (!candidate.isUrl() || candidate.getDeliveryMethod() != DeliveryMethod.PROGRESSIVE_HTTP || !cdn(candidate.getContent())) continue;
            if (candidate.getFormat() == MediaFormat.M4A || candidate.getFormat() == MediaFormat.MP3) audio.add(candidate);
        }
        if (audio.isEmpty()) throw new Failure("unavailable", "没有可播放的公开 AAC/M4A 音频。");
        String quality = input.getString("quality", "high");
        int ceiling = "low".equals(quality) ? 64 : "normal".equals(quality) ? 128 : Integer.MAX_VALUE;
        audio.sort((a, b) -> {
            int format = Boolean.compare(b.getFormat() == MediaFormat.M4A, a.getFormat() == MediaFormat.M4A);
            if (format != 0) return format;
            boolean aFit = a.getAverageBitrate() <= ceiling, bFit = b.getAverageBitrate() <= ceiling;
            if (aFit != bFit) return aFit ? -1 : 1;
            return aFit ? Integer.compare(b.getAverageBitrate(), a.getAverageBitrate()) : Integer.compare(a.getAverageBitrate(), b.getAverageBitrate());
        });
        AudioStream chosen = audio.get(0); String url = chosen.getContent();
        JsonObject headers = new JsonObject(); headers.put("User-Agent", mediaUserAgent(url));
        headers.put("Referer", "https://www.youtube.com/");
        JsonObject out = new JsonObject(); out.put("url", url); out.put("headers", headers);
        out.put("mimeType", chosen.getFormat().getMimeType()); out.put("bitrateKbps", chosen.getAverageBitrate());
        out.put("codec", chosen.getCodec()); out.put("itag", chosen.getItag());
        Matcher expiry = EXPIRY.matcher(url); if (expiry.find()) out.put("expiresAt", Long.parseLong(expiry.group(1)) * 1000L);
        return out;
    }
    private static String mediaUserAgent(String url) {
        if (YoutubeParsingHelper.isAndroidStreamingUrl(url)) return YoutubeParsingHelper.getAndroidUserAgent(LOCALE);
        if (YoutubeParsingHelper.isIosStreamingUrl(url)) return YoutubeParsingHelper.getIosUserAgent(LOCALE);
        if (YoutubeParsingHelper.isVisionOsStreamingUrl(url)) return YoutubeParsingHelper.getVisionOsUserAgent(LOCALE);
        return UA;
    }
    static boolean cdn(String value) {
        try { URI uri = new URI(value); return "https".equals(uri.getScheme()) && uri.getUserInfo() == null && uri.getHost() != null && uri.getHost().endsWith(".googlevideo.com") && (uri.getPort() == -1 || uri.getPort() == 443); }
        catch (Exception error) { return false; }
    }

    private static final class Failure extends IOException {
        final String code;
        Failure(String code, String message) { super(message); this.code = code; }
    }

    private static final class BoundedDownloader extends Downloader {
        @Override public Response execute(Request request) throws IOException, ReCaptchaException {
            if (++requestCount > 24) throw new Failure("unavailable", "YouTube 请求次数超出限制。");
            String target = request.url();
            for (int redirects = 0; redirects < 6; redirects++) {
                long remaining = (deadline - System.nanoTime()) / 1_000_000L;
                if (remaining <= 0 || Thread.currentThread().isInterrupted()) throw new SocketTimeoutException("Extraction deadline reached");
                URL url = new URL(target); String host = url.getHost().toLowerCase(Locale.ROOT);
                if (!url.getProtocol().equals("https") || url.getUserInfo() != null || (url.getPort() != -1 && url.getPort() != 443)
                        || !(host.equals("youtube.com") || host.endsWith(".youtube.com") || host.equals("youtubei.googleapis.com") || host.endsWith(".googlevideo.com")))
                    throw new Failure("unavailable", "解析器返回了未授权的网络地址。");
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout((int) Math.min(8000, remaining)); connection.setReadTimeout((int) Math.min(8000, remaining));
                connection.setRequestMethod(request.httpMethod()); connection.setRequestProperty("User-Agent", UA);
                connection.setRequestProperty("Accept-Encoding", "identity");
                for (Map.Entry<String, List<String>> header : request.headers().entrySet()) {
                    if (!header.getKey().equalsIgnoreCase("Accept-Encoding")) connection.setRequestProperty(header.getKey(), String.join(", ", header.getValue()));
                }
                try {
                    byte[] data = request.dataToSend();
                    if (data != null && data.length > 0) {
                        if (data.length > 1_048_576) throw new Failure("setup", "Request body too large");
                        connection.setDoOutput(true); connection.setFixedLengthStreamingMode(data.length);
                        try (OutputStream output = connection.getOutputStream()) { output.write(data); }
                    }
                    int status = connection.getResponseCode();
                    if (status >= 300 && status <= 399) {
                        String location = connection.getHeaderField("Location");
                        if (location == null) throw new IOException("Missing redirect");
                        target = new URL(url, location).toString(); continue;
                    }
                    if (status == 429) throw new Failure("rateLimited", "YouTube 请求过多，请稍后再试。");
                    InputStream body = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                    String text = "";
                    if (body != null) try (InputStream input = body; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                        byte[] buffer = new byte[16384]; int count;
                        while ((count = input.read(buffer)) != -1) {
                            if (bytes.size() + count > 16_777_216) throw new Failure("unavailable", "Response body too large");
                            if (System.nanoTime() > deadline) throw new SocketTimeoutException("Extraction deadline reached");
                            bytes.write(buffer, 0, count);
                        }
                        text = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
                    }
                    return new Response(status, connection.getResponseMessage(), connection.getHeaderFields(), text, target);
                } finally { connection.disconnect(); }
            }
            throw new IOException("Too many redirects");
        }
    }
}
