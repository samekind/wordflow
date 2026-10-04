package com.wordflow.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class WordflowStore extends SQLiteOpenHelper {
    private static final String KEY_ALIAS = "wordflow.ai.key.v1";
    private static final String EMPTY_STATE = "{\"version\":1,\"words\":[],\"reviews\":[],\"lessons\":[],\"goal\":20}";

    /** Stored document version as of the last read or write, so a save does not have to re-read and re-parse the whole state to check it. */
    private int knownVersion = -1;

    WordflowStore(Context context) { super(context, "wordflow.db", null, 1); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE documents (id TEXT PRIMARY KEY, body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("INSERT INTO documents(id,body) VALUES('state',?)", new Object[]{EMPTY_STATE});
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("Unsupported database version");
    }

    static final class StateText {
        final String body; final int revision;
        StateText(String body, int revision) { this.body = body; this.revision = revision; }
    }
    private static final Pattern VERSION_HEAD = Pattern.compile("^\\s*\\{\\s*\"version\"\\s*:\\s*(\\d+)");

    /** The stored document as text. The app parses it with the WebView's own JSON parser, which is far faster than
     * round-tripping megabytes through org.json on this side. */
    synchronized StateText readStateText() throws Exception {
        SQLiteDatabase db = getReadableDatabase();
        db.beginTransactionNonExclusive();
        try {
            int length;
            int revision;
            // Byte offsets: substr() on TEXT counts characters and rescans from the start for every chunk.
            try (Cursor row = db.rawQuery("SELECT length(CAST(body AS BLOB)),revision FROM documents WHERE id='state'", null)) {
                if (!row.moveToFirst()) throw new IllegalStateException("学习记录不存在");
                length = row.getInt(0);
                revision = row.getInt(1);
            }
            // Large wordbooks exceed Android's per-row CursorWindow limit, so read in chunks.
            ByteArrayOutputStream bytes = new ByteArrayOutputStream(length);
            final int chunk = 1024 * 1024;
            for (int start = 1; start <= length; start += chunk) {
                try (Cursor row = db.rawQuery("SELECT substr(CAST(body AS BLOB),?,?) FROM documents WHERE id='state'",
                        new String[]{String.valueOf(start), String.valueOf(chunk)})) {
                    if (!row.moveToFirst()) throw new IllegalStateException("学习记录不存在");
                    bytes.write(row.getBlob(0));
                }
            }
            String body = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
            knownVersion = versionOf(body);
            db.setTransactionSuccessful();
            return new StateText(body, revision);
        } finally { db.endTransaction(); }
    }

    /** Writes the stored document to `target` byte for byte and returns its revision. The app fetches the file through the
     * WebView's own loader, which avoids pushing megabytes through the plugin bridge (seconds on a phone). */
    synchronized int readStateToFile(File target) throws Exception {
        SQLiteDatabase db = getReadableDatabase();
        db.beginTransactionNonExclusive();
        try {
            int length;
            int revision;
            try (Cursor row = db.rawQuery("SELECT length(CAST(body AS BLOB)),revision FROM documents WHERE id='state'", null)) {
                if (!row.moveToFirst()) throw new IllegalStateException("学习记录不存在");
                length = row.getInt(0);
                revision = row.getInt(1);
            }
            final int chunk = 1024 * 1024;
            try (FileOutputStream out = new FileOutputStream(target)) {
                for (int start = 1; start <= length; start += chunk) {
                    try (Cursor row = db.rawQuery("SELECT substr(CAST(body AS BLOB),?,?) FROM documents WHERE id='state'",
                            new String[]{String.valueOf(start), String.valueOf(chunk)})) {
                        if (!row.moveToFirst()) throw new IllegalStateException("学习记录不存在");
                        byte[] part = row.getBlob(0);
                        if (start == 1) knownVersion = versionOf(new String(part, 0, Math.min(part.length, 96), StandardCharsets.UTF_8), part, length);
                        out.write(part);
                    }
                }
            }
            db.setTransactionSuccessful();
            return revision;
        } finally { db.endTransaction(); }
    }

    private int versionOf(String head, byte[] firstPart, int totalLength) throws Exception {
        Matcher match = VERSION_HEAD.matcher(head);
        if (match.find()) return Integer.parseInt(match.group(1));
        // Documents written by older builds do not start with the version key; read it the slow way once.
        return totalLength == firstPart.length ? versionOf(new String(firstPart, StandardCharsets.UTF_8)) : -1;
    }

    private static int versionOf(String body) throws Exception {
        Matcher head = VERSION_HEAD.matcher(body.length() > 96 ? body.substring(0, 96) : body);
        if (head.find()) return Integer.parseInt(head.group(1));
        return new JSONObject(body).optInt("version", -1);
    }

    synchronized JSONObject readState() throws Exception {
        StateText stored = readStateText();
        return new JSONObject().put("state", new JSONObject(stored.body)).put("revision", stored.revision).put("apiVersion", 7);
    }

    synchronized int saveState(JSONObject state, int revision) throws Exception {
        int version = state.getInt("version");
        if ((version < 1 || version > 3) || state.getJSONArray("words").length() > 30000 ||
            state.getJSONArray("reviews").length() > 500000 || state.getInt("goal") < 1 || state.getInt("goal") > 5000) {
            throw new IllegalArgumentException("学习记录格式无效");
        }
        if (version >= 2 && state.optJSONObject("learning") == null) throw new IllegalArgumentException("新版学习数据缺少草稿状态");
        if (version == 3 && (state.getJSONObject("learning").optJSONArray("parked") == null || state.optJSONArray("contextStories") == null)) throw new IllegalArgumentException("新版学习数据缺少单元或语境记录");
        return saveStateText(state.toString(), revision);
    }

    /** The app has already validated the document before sending it; this keeps only cheap structural guards. */
    synchronized int saveStateText(String text, int revision) throws Exception {
        if (text == null) throw new IllegalArgumentException("学习记录格式无效");
        if (text.length() > 12 * 1024 * 1024 || text.getBytes(StandardCharsets.UTF_8).length > 12 * 1024 * 1024) throw new IllegalArgumentException("学习记录超过 12 MB");
        int version = versionOf(text);
        if (version < 1 || version > 3) throw new IllegalArgumentException("学习记录格式无效");
        if (version >= 2 && !text.contains("\"learning\":{")) throw new IllegalArgumentException("新版学习数据缺少草稿状态");
        if (version == 3 && (!text.contains("\"parked\":[") || !text.contains("\"contextStories\":["))) throw new IllegalArgumentException("新版学习数据缺少单元或语境记录");
        if (knownVersion < 0) readStateText();
        if (knownVersion > version) {
            throw new IllegalArgumentException("学习记录已升级，请更新应用后重试，旧版本不能覆盖新版草稿。");
        }
        ContentValues values = new ContentValues();
        values.put("body", text);
        values.put("revision", revision + 1);
        int count = getWritableDatabase().update("documents", values, "id='state' AND revision=?", new String[]{String.valueOf(revision)});
        if (count != 1) throw new IllegalStateException("记录已在其他窗口更新，请重新打开应用后重试。本次操作尚未保存。");
        knownVersion = version;
        return revision + 1;
    }

    synchronized JSONObject readConfig() throws Exception {
        try (Cursor row = getReadableDatabase().rawQuery("SELECT body FROM documents WHERE id='ai'", null)) {
            if (row.moveToFirst()) return new JSONObject(row.getString(0));
        }
        return new JSONObject().put("provider", "deepseek").put("model", "deepseek-flash").put("secret", "");
    }

    synchronized void saveConfig(String provider, String model, String key) throws Exception {
        JSONObject value = new JSONObject().put("provider", provider).put("model", model)
            .put("secret", key.isEmpty() ? "" : encrypt(key));
        ContentValues values = new ContentValues();
        values.put("id", "ai");
        values.put("body", value.toString());
        getWritableDatabase().insertWithOnConflict("documents", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    String readKey(JSONObject config) throws Exception {
        String secret = config.optString("secret");
        if (secret.isEmpty()) return "";
        JSONObject payload = new JSONObject(secret);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(payload.getString("iv"), Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(payload.getString("data"), Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    private String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        return new JSONObject().put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
            .put("data", Base64.encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP)).toString();
    }

    private synchronized SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build());
            generator.generateKey();
        }
        return (SecretKey) store.getKey(KEY_ALIAS, null);
    }
}
