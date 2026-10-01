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
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class WordflowStore extends SQLiteOpenHelper {
    private static final String KEY_ALIAS = "wordflow.ai.key.v1";
    private static final String EMPTY_STATE = "{\"version\":1,\"words\":[],\"reviews\":[],\"lessons\":[],\"goal\":20}";

    WordflowStore(Context context) { super(context, "wordflow.db", null, 1); }

    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE documents (id TEXT PRIMARY KEY, body TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0)");
        db.execSQL("INSERT INTO documents(id,body) VALUES('state',?)", new Object[]{EMPTY_STATE});
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("Unsupported database version");
    }

    synchronized JSONObject readState() throws Exception {
        SQLiteDatabase db = getReadableDatabase();
        db.beginTransactionNonExclusive();
        try {
            int length;
            int revision;
            try (Cursor row = db.rawQuery("SELECT length(body),revision FROM documents WHERE id='state'", null)) {
                if (!row.moveToFirst()) throw new IllegalStateException("学习记录不存在");
                length = row.getInt(0);
                revision = row.getInt(1);
            }
            // Large wordbooks exceed Android's per-row CursorWindow limit.
            StringBuilder body = new StringBuilder(length);
            final int chunk = 128 * 1024;
            for (int start = 1; start <= length; start += chunk) {
                try (Cursor row = db.rawQuery("SELECT substr(body,?,?) FROM documents WHERE id='state'",
                        new String[]{String.valueOf(start), String.valueOf(chunk)})) {
                    if (!row.moveToFirst()) throw new IllegalStateException("学习记录不存在");
                    body.append(row.getString(0));
                }
            }
            JSONObject result = new JSONObject().put("state", new JSONObject(body.toString())).put("revision", revision).put("apiVersion", 7);
            db.setTransactionSuccessful();
            return result;
        } finally { db.endTransaction(); }
    }

    synchronized int saveState(JSONObject state, int revision) throws Exception {
        int version = state.getInt("version");
        if ((version < 1 || version > 3) || state.getJSONArray("words").length() > 30000 ||
            state.getJSONArray("reviews").length() > 500000 || state.getInt("goal") < 1 || state.getInt("goal") > 200) {
            throw new IllegalArgumentException("学习记录格式无效");
        }
        if (version >= 2 && state.optJSONObject("learning") == null) throw new IllegalArgumentException("新版学习数据缺少草稿状态");
        if (version == 3 && (state.getJSONObject("learning").optJSONArray("parked") == null || state.optJSONArray("contextStories") == null)) throw new IllegalArgumentException("新版学习数据缺少单元或语境记录");
        if (readState().getJSONObject("state").getInt("version") > version) {
            throw new IllegalArgumentException("学习记录已升级，请更新应用后重试，旧版本不能覆盖新版草稿。");
        }
        String text = state.toString();
        if (text.getBytes(StandardCharsets.UTF_8).length > 12 * 1024 * 1024) throw new IllegalArgumentException("学习记录超过 12 MB");
        ContentValues values = new ContentValues();
        values.put("body", text);
        values.put("revision", revision + 1);
        int count = getWritableDatabase().update("documents", values, "id='state' AND revision=?", new String[]{String.valueOf(revision)});
        if (count != 1) throw new IllegalStateException("记录已在其他窗口更新，请重新打开应用后重试。本次操作尚未保存。");
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
