var queue = [];
var currentIndex = -1;
var isPlaying = false;
var isShuffle = false;
var isRepeat = false;
var volume = 0.7;
var likedSongs = new Set();

var audio = document.getElementById("audio");
audio.volume = volume;

function pad(n) {
    return n < 10 ? "0" + n : n;
}

function formatTime(secs) {
    if (!secs || isNaN(secs)) return "0:00";
    var m = Math.floor(secs / 60);
    var s = Math.floor(secs % 60);
    return m + ":" + pad(s);
}

function moodGradient(mood) {
    var gradients = {
        chill: "#1e3c72",
        hype: "#c31432",
        focus: "#134e5e",
        sad: "#2c3e50"
    };
    return gradients[mood] || "#333";
}

async function playSong(idx) {
    if (!queue.length) return;

    idx = ((idx % queue.length) + queue.length) % queue.length;
    currentIndex = idx;

    var song = queue[idx];

    document.getElementById("nowTitle").textContent = song.title;
    document.getElementById("nowArtist").textContent = song.artist;
    document.getElementById("nowMood").textContent = song.mood || "";
    document.getElementById("timeTotal").textContent = song.duration_str || "0:00";
    document.getElementById("timeCurrent").textContent = "0:00";
    document.getElementById("progressBar").style.width = "0%";

    var artEl = document.getElementById("nowArt");
    if (song.thumbnail) {
        artEl.innerHTML = '<img src="' + song.thumbnail + '" alt="">';
    } else {
        artEl.innerHTML = "♪";
    }
    artEl.classList.add("spin");

    var heartBtn = document.getElementById("heartBtn");
    if (likedSongs.has(song.id)) {
        heartBtn.textContent = "♥";
        heartBtn.classList.add("liked");
    } else {
        heartBtn.textContent = "♡";
        heartBtn.classList.remove("liked");
    }

    document.querySelectorAll(".card").forEach(function(c) {
        c.classList.toggle("now-playing", c.dataset.id === song.id);
    });
    document.querySelectorAll(".song-row").forEach(function(r) {
        r.classList.toggle("now-playing", r.dataset.id === song.id);
    });

    setPlayButton(false);
    showToast("Loading...");

    try {
        var res = await fetch("/api/stream/" + song.id);
        var data = await res.json();

        if (data.error) throw new Error(data.error);

        if (data.thumbnail && !song.thumbnail) {
            artEl.innerHTML = '<img src="' + data.thumbnail + '" alt="">';
        }
        if (data.duration) {
            document.getElementById("timeTotal").textContent = data.duration;
        }

        audio.src = data.url;
        audio.volume = volume;
        await audio.play();

        isPlaying = true;
        setPlayButton(true);
        showToast(song.title);

        fetch("/api/play/" + song.id, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(song)
        });

    } catch (err) {
        showToast("Could not load song");
        setPlayButton(false);
        artEl.classList.remove("spin");
    }
}

function setPlayButton(playing) {
    isPlaying = playing;
    document.getElementById("playBtn").textContent = playing ? "⏸" : "▶";
    var art = document.getElementById("nowArt");
    if (playing) {
        art.classList.add("spin");
    } else {
        art.classList.remove("spin");
    }
}

function togglePlay() {
    if (currentIndex === -1) {
        if (queue.length) playSong(0);
        return;
    }
    if (audio.paused) {
        audio.play();
        setPlayButton(true);
    } else {
        audio.pause();
        setPlayButton(false);
    }
}

function nextSong() {
    if (!queue.length) return;
    var next = isShuffle
        ? Math.floor(Math.random() * queue.length)
        : currentIndex + 1;
    playSong(next);
}

function prevSong() {
    if (!queue.length) return;
    if (audio.currentTime > 3) {
        audio.currentTime = 0;
        return;
    }
    playSong(currentIndex - 1);
}

function toggleShuffle() {
    isShuffle = !isShuffle;
    document.getElementById("shuffleBtn").classList.toggle("active", isShuffle);
}

function toggleRepeat() {
    isRepeat = !isRepeat;
    document.getElementById("repeatBtn").classList.toggle("active", isRepeat);
}

async function toggleLike() {
    if (currentIndex === -1) return;
    var song = queue[currentIndex];
    var res = await fetch("/api/like/" + song.id, { method: "POST" });
    var data = await res.json();
    var btn = document.getElementById("heartBtn");
    if (data.liked) {
        likedSongs.add(song.id);
        btn.textContent = "♥";
        btn.classList.add("liked");
        showToast("Saved to library");
    } else {
        likedSongs.delete(song.id);
        btn.textContent = "♡";
        btn.classList.remove("liked");
    }
}

audio.addEventListener("ended", function() {
    if (isRepeat) {
        audio.currentTime = 0;
        audio.play();
    } else {
        nextSong();
    }
});

audio.addEventListener("timeupdate", function() {
    if (!audio.duration) return;
    var pct = (audio.currentTime / audio.duration) * 100;
    document.getElementById("progressBar").style.width = pct + "%";
    document.getElementById("timeCurrent").textContent = formatTime(audio.currentTime);
    document.getElementById("timeTotal").textContent = formatTime(audio.duration);
});

document.getElementById("progressTrack").addEventListener("click", function(e) {
    if (!audio.duration) return;
    var rect = this.getBoundingClientRect();
    var frac = (e.clientX - rect.left) / rect.width;
    audio.currentTime = frac * audio.duration;
});

document.getElementById("volumeTrack").addEventListener("click", function(e) {
    var rect = this.getBoundingClientRect();
    var frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    volume = frac;
    audio.volume = frac;
    document.getElementById("volumeBar").style.width = (frac * 100) + "%";
});

var vizEls = document.querySelectorAll(".viz span");
setInterval(function() {
    vizEls.forEach(function(el) {
        var h = isPlaying && !audio.paused
            ? Math.floor(3 + Math.random() * 13) + "px"
            : "3px";
        el.style.height = h;
    });
}, 110);

document.querySelectorAll(".mood-pill").forEach(function(btn) {
    btn.addEventListener("click", async function() {
        var mood = this.dataset.mood;
        document.querySelectorAll(".mood-pill").forEach(function(b) {
            b.classList.remove("active");
        });
        this.classList.add("active");
        showToast("Loading " + mood + " songs...");
        try {
            var res = await fetch("/api/mood/" + mood);
            var songs = await res.json();
            if (songs.length) {
                queue = songs;
                playSong(0);
            }
        } catch (e) {}
    });
});

var sleepInterval = null;
document.getElementById("sleepSelect").addEventListener("change", function() {
    clearInterval(sleepInterval);
    document.getElementById("sleepDisplay").textContent = "";
    if (!this.value) return;

    var endTime = Date.now() + parseInt(this.value) * 60000;
    showToast("Sleep timer: " + this.value + " min");

    sleepInterval = setInterval(function() {
        var left = endTime - Date.now();
        if (left <= 0) {
            audio.pause();
            setPlayButton(false);
            clearInterval(sleepInterval);
            document.getElementById("sleepDisplay").textContent = "stopped";
            document.getElementById("sleepSelect").value = "";
            return;
        }
        var m = Math.floor(left / 60000);
        var s = Math.floor((left % 60000) / 1000);
        document.getElementById("sleepDisplay").textContent = m + ":" + pad(s);
    }, 1000);
});

var toastTimer = null;
function showToast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function() {
        el.classList.remove("show");
    }, 2500);
}

window.playFromCard = function(song) {
    var exists = queue.findIndex(function(s) { return s.id === song.id; });
    if (exists !== -1) {
        playSong(exists);
        return;
    }
    queue.push(song);
    playSong(queue.length - 1);
};

document.addEventListener("keydown", function(e) {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
    }
    if (e.code === "ArrowRight") nextSong();
    if (e.code === "ArrowLeft") prevSong();
});
