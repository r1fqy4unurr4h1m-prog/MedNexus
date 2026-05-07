-- ============================================================
-- NoteShare — Supabase Database Setup
-- Jalankan script ini di Supabase SQL Editor
-- ============================================================

-- Enable pgcrypto for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── TABLES ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notes (
    id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    original_name TEXT NOT NULL,
    stored_name   TEXT NOT NULL,
    file_size     INTEGER NOT NULL,
    file_type     TEXT NOT NULL,
    mime_type     TEXT NOT NULL,
    title         TEXT NOT NULL,
    description   TEXT DEFAULT '',
    uploader_name TEXT NOT NULL,
    angkatan      TEXT NOT NULL DEFAULT '23',
    upload_date   TIMESTAMPTZ DEFAULT NOW(),
    likes         INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS likes (
    id         SERIAL PRIMARY KEY,
    note_id    UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    user_token TEXT NOT NULL,
    UNIQUE(note_id, user_token)
);

CREATE TABLE IF NOT EXISTS users (
    id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── RPC FUNCTIONS ────────────────────────────────────────────

-- Register user (password di-hash dengan bcrypt)
CREATE OR REPLACE FUNCTION register_user(p_username TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    IF EXISTS (SELECT 1 FROM users WHERE username = p_username) THEN
        RETURN json_build_object('error', 'Username sudah digunakan');
    END IF;

    v_user_id := gen_random_uuid();
    INSERT INTO users (id, username, password, created_at)
    VALUES (v_user_id, p_username, crypt(p_password, gen_salt('bf')), NOW());

    RETURN json_build_object('id', v_user_id, 'username', p_username, 'token', v_user_id);
END;
$$;

-- Login user
CREATE OR REPLACE FUNCTION login_user(p_username TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user RECORD;
BEGIN
    SELECT * INTO v_user
    FROM users
    WHERE username = p_username
      AND password = crypt(p_password, password);

    IF NOT FOUND THEN
        RETURN json_build_object('error', 'Username atau password salah');
    END IF;

    RETURN json_build_object('id', v_user.id, 'username', v_user.username, 'token', v_user.id);
END;
$$;

-- Toggle like (like/unlike)
CREATE OR REPLACE FUNCTION toggle_like(p_note_id UUID, p_user_token TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_liked BOOLEAN;
    v_likes INTEGER;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM notes WHERE id = p_note_id) THEN
        RETURN json_build_object('error', 'Catatan tidak ditemukan');
    END IF;

    IF EXISTS (SELECT 1 FROM likes WHERE note_id = p_note_id AND user_token = p_user_token) THEN
        DELETE FROM likes WHERE note_id = p_note_id AND user_token = p_user_token;
        UPDATE notes SET likes = GREATEST(likes - 1, 0) WHERE id = p_note_id;
        v_liked := FALSE;
    ELSE
        INSERT INTO likes (note_id, user_token) VALUES (p_note_id, p_user_token);
        UPDATE notes SET likes = likes + 1 WHERE id = p_note_id;
        v_liked := TRUE;
    END IF;

    SELECT likes INTO v_likes FROM notes WHERE id = p_note_id;
    RETURN json_build_object('liked', v_liked, 'likes', v_likes);
END;
$$;

-- ── ROW LEVEL SECURITY ──────────────────────────────────────

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE likes ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Notes: public read, public insert, public delete
CREATE POLICY "notes_select" ON notes FOR SELECT TO anon USING (true);
CREATE POLICY "notes_insert" ON notes FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "notes_delete" ON notes FOR DELETE TO anon USING (true);

-- Likes: public read, public insert, public delete
CREATE POLICY "likes_select" ON likes FOR SELECT TO anon USING (true);
CREATE POLICY "likes_insert" ON likes FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "likes_delete" ON likes FOR DELETE TO anon USING (true);

-- Users: no direct access (semua via RPC functions yang SECURITY DEFINER)
-- Tidak perlu policy karena akses hanya lewat function
