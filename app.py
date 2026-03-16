from flask import Flask, render_template, jsonify, request
import sqlite3
import os
import time
import yt_dlp

app = Flask(__name__)
db_path = os.path.join(os.path.dirname(__file__), "data.db")


def connect():
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def setup():
    conn = connect()
    conn.execute("""
        create table if not exists songs (
            id text primary key,
            title text,
            artist text,
            duration integer,
            mood text,
            thumbnail text,
            plays integer default 0
        )
    """)
    conn.execute("""
        create table if not exists liked (
            song_id text primary key
        )
    """)
    conn.commit()
    conn.close()


def duration_str(seconds):
    if not seconds:
        return "0:00"
    m = int(seconds) // 60
    s = int(seconds) % 60
    return f"{m}:{s:02d}"


def get_mood(title):
    title = title.lower()
    sad_words = ["cry", "sad", "lonely", "miss", "pain", "hurt", "tears", "heartbreak"]
    hype_words = ["fire", "hype", "beast", "party", "club", "lit", "bang", "energy"]
    focus_words = ["study", "lofi", "focus", "calm", "ambient", "peace", "rain"]

    for w in sad_words:
        if w in title:
            return "sad"
    for w in hype_words:
        if w in title:
            return "hype"
    for w in focus_words:
        if w in title:
            return "focus"
    return "chill"


def search_youtube(query, limit=8):
    options = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "default_search": "ytsearch",
    }
    results = []
    with yt_dlp.YoutubeDL(options) as ydl:
        data = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
        for entry in data.get("entries") or []:
            if not entry:
                continue
            results.append({
                "id": entry.get("id", ""),
                "title": entry.get("title", "Unknown"),
                "artist": entry.get("uploader", "Unknown"),
                "duration": entry.get("duration", 0),
                "duration_str": duration_str(entry.get("duration", 0)),
                "mood": get_mood(entry.get("title", "")),
                "thumbnail": entry.get("thumbnail", ""),
                "plays": 0,
            })
    return results


def get_stream(video_id):
    options = {
        "quiet": True,
        "no_warnings": True,
        "format": "bestaudio/best",
    }
    url = f"https://www.youtube.com/watch?v={video_id}"
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(url, download=False)
        formats = [
            f for f in info.get("formats", [])
            if f.get("acodec") != "none" and f.get("vcodec") == "none"
        ]
        if formats:
            formats.sort(key=lambda x: x.get("abr") or 0, reverse=True)
            stream_url = formats[0]["url"]
        else:
            stream_url = info.get("url", "")
        thumb = info.get("thumbnail", "")
        dur = duration_str(info.get("duration", 0))
        return stream_url, thumb, dur


@app.route("/")
def home():
    trending = search_youtube("top songs 2025", 8)
    recent = search_youtube("new music 2025", 6)
    featured = trending[0] if trending else {}
    return render_template("home.html", trending=trending, recent=recent,
                           featured=featured, page="home")


@app.route("/search")
def search():
    return render_template("search.html", page="search")


@app.route("/library")
def library():
    conn = connect()
    ids = [r[0] for r in conn.execute("select song_id from liked").fetchall()]
    songs = []
    if ids:
        placeholders = ",".join("?" * len(ids))
        rows = conn.execute(
            f"select * from songs where id in ({placeholders})", ids
        ).fetchall()
        for r in rows:
            s = dict(r)
            s["duration_str"] = duration_str(s["duration"])
            songs.append(s)
    conn.close()
    return render_template("library.html", songs=songs, page="library")


@app.route("/stats")
def stats():
    conn = connect()
    rows = conn.execute(
        "select * from songs order by plays desc limit 5"
    ).fetchall()
    top = []
    for r in rows:
        s = dict(r)
        s["duration_str"] = duration_str(s["duration"])
        top.append(s)
    total = conn.execute("select sum(plays) from songs").fetchone()[0] or 0
    conn.close()
    max_plays = top[0]["plays"] if top else 1
    return render_template("stats.html", top=top, total=total,
                           max_plays=max_plays, page="stats")


@app.route("/api/search")
def api_search():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify([])
    try:
        return jsonify(search_youtube(q, 10))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/stream/<video_id>")
def api_stream(video_id):
    try:
        url, thumb, dur = get_stream(video_id)
        return jsonify({"url": url, "thumbnail": thumb, "duration": dur})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/mood/<mood>")
def api_mood(mood):
    queries = {
        "chill": "chill songs playlist",
        "hype": "hype songs workout",
        "focus": "lofi focus study music",
        "sad": "sad songs emotional",
    }
    try:
        return jsonify(search_youtube(queries.get(mood, mood + " music"), 8))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/like/<song_id>", methods=["POST"])
def api_like(song_id):
    conn = connect()
    exists = conn.execute(
        "select 1 from liked where song_id=?", (song_id,)
    ).fetchone()
    if exists:
        conn.execute("delete from liked where song_id=?", (song_id,))
        liked = False
    else:
        conn.execute("insert or ignore into liked values (?)", (song_id,))
        liked = True
    conn.commit()
    conn.close()
    return jsonify({"liked": liked})


@app.route("/api/play/<song_id>", methods=["POST"])
def api_play(song_id):
    data = request.json or {}
    conn = connect()
    conn.execute("""
        insert into songs (id, title, artist, duration, mood, thumbnail, plays)
        values (?, ?, ?, ?, ?, ?, 1)
        on conflict(id) do update set plays = plays + 1
    """, (
        song_id,
        data.get("title", "Unknown"),
        data.get("artist", "Unknown"),
        data.get("duration", 0),
        data.get("mood", "chill"),
        data.get("thumbnail", ""),
    ))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


if __name__ == "__main__":
    setup()
    print("\nMelo running at http://localhost:5000\n")
    app.run(debug=True, port=5000)
